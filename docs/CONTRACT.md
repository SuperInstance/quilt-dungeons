# CONTRACT v1.1.0 — the socket

Every lane, script, and model that plays quilt-dungeons codes against this document.
The contract is the socket: implement exactly this and your agent plugs in, forever.

Versioning: breaking changes bump the major version in this header. Additive fields
never break the socket (consumers must ignore unknown fields).

Changelog: v1.1.0 — ADDITIVE only: §6.5 the legality mask (`legalActions`,
`isLegalAction`). No prior section changed; existing scripts byte-reproduce.

---

## 0. The quilt view

An array of characters is simply a quilt with every cell getting its own character;
the code is the relational understanding of what's happening between the cells.

- **glyph = cell.** `'#'`, `'.'`, `'@'`, `'m'`, `'r'`, `'$'`, `'+'`, `'>'` — each is one
  stitched square of the quilt. A grid is just rows of them.
- **code = relational understanding.** `step()` is nothing but the rules of adjacency:
  who may sit next to whom, what happens when two cells meet, what a cell becomes.
- **scripts = player-logic.** A script is a strip of player-logic stitched over the quilt;
  it sees only the patch under the lamp (`percepts`), never the whole blanket.
- **trajectories = receipt chains.** A run leaves a byte-identical replayable trail, and
  results are hash-chained into `scores.jsonl`. Same seed + same script ⇒ byte-identical
  trajectory. This is the DETERMINISM LAW (§9).

---

## 1. Runtime

- Node **>= 20**, ESM (`"type": "module"`), **standard library only, zero dependencies**.
- Everything is synchronous and JSON-serializable. No clocks, no randomness outside the
  seeded RNG, no I/O inside engine functions.

## 2. RNG — `mulberry32(seed)`

The platonic-randomness convention. Exact reference implementation:

```js
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; // [0, 1)
  };
}
```

The engine wraps this as a cursor: `rngState` is the single uint32 `a`, stored in the game
state so any state can be resumed byte-exactly. Derived helpers (all consuming `next()`):

- `int(n)` = `Math.floor(next() * n)` — uniform integer in `[0, n)`.
- `roll(lo, hi)` = `lo + int(hi - lo + 1)` — inclusive.
- `chance(p)` = `next() < p`.

The RNG cursor is consumed **in engine order only** (documented per rule below). Scripts
never touch the RNG — they receive percepts, and their determinism comes from the
determinism of the percept stream.

## 3. Glyphs (the quilt squares)

| glyph | meaning |
|-------|---------|
| `'#'` | wall |
| `'.'` | floor |
| `'@'` | player |
| `'m'` | melee monster |
| `'r'` | ranged monster |
| `'$'` | loot |
| `'+'` | potion |
| `'>'` | exit stairs |

`grid` is an array of `h` strings, each `w` chars long (row-major). The grid is the **full
quilt render**: terrain, items, the player (`@`), and monsters (`m`/`r`) are all painted
in their cells. When an entity leaves a cell the engine restores the under-tile (item
glyph, `>`, or `.`), so a cell never hides two things. Entities never share a cell.

## 4. `createGame(seed, options)` → state

```js
createGame(seed, { w = 48, h = 24, monsters = 8, loot = 10, potions = 3, maxTurns = 200 } = {})
```

State (a plain JSON object; field order is fixed so JSON is byte-stable):

```js
{
  seed,               // number, as passed
  turn: 0,            // completed actions
  w, h,               // grid dims
  grid,               // array of h strings
  player: { x, y, hp: 20, maxHp: 20 },
  monsters: [ { id, x, y, hp, kind } ],   // id: 0-based int; kind: 'm' | 'r'
  items:    [ { id, x, y, kind } ],       // id: 0-based int; kind: '$' | '+'
  log:      [ { turn, type, detail } ],   // full event history, append-only
  rngState,           // uint32 cursor for mulberry32
  status: 'active',   // 'active' | 'won' | 'lost' | 'timeout'
  maxTurns,
  loot: 0,            // loot picked up so far
  exit: { x, y }      // exit stairs position ('>' when unoccupied)
}
```

Monster stats: melee `m` hp **5**, ranged `r` hp **3**. Player hp **20 / maxHp 20**.

### Generation (deterministic from seed)

1. Fill `w×h` with `'#'`.
2. **BSP rooms**: recursively split the interior rect `[1,1]..[w-2,h-2]` along its longer
   axis at a seeded position until depth 4 or too small (w<12 && h<8). Each leaf carves one
   room of seeded size/position (≥3 wide, ≥2 tall), fully inside the leaf, not touching the
   border.
3. **Corridors**: leaf rooms are chained in creation order — each room center connects to
   the next with an L-corridor (horizontal-first), carving `'.'` (never through the border).
4. Player spawns at the **first** room's center; exit `>` at the **last** room's center.
5. Monsters: `monsters` of them, placed by seeded rejection sampling on distinct floor
   cells (never the player's, the exit's, or an occupied cell). Kind: `chance(0.3)` → `'r'`,
   else `'m'`. Ranged are placed only in the last half of the draw order.
6. Items: `loot` copies of `'$'` and `potions` copies of `'+'`, seeded rejection sampling on
   distinct free floor cells.

All of `exit`, every monster, and every item is flood-fill reachable from the player.

## 5. `step(state, action)` → `{ state, events }`

`step` is **pure**: it never mutates the input state; it returns a fresh state object.
`events` is an array of `{ type, detail }` (the same records appended to `state.log`,
without `turn`).

Actions: `'up' | 'down' | 'left' | 'right' | 'wait'` (cardinal, no diagonals).
Any other value is coerced to `'wait'` and emits `invalid-action`.

**Distances are Chebyshev** (king-move: `max(|dx|,|dy|)`) throughout the engine, matching
the square percept window.

### Player turn (order matters)

1. Resolve movement delta from `action`.
2. Target cell is:
   - a wall or out of bounds → `bump` event, stay.
   - occupied by a monster → **bump-attack**: `dmg = roll(2,5)` (RNG), monster `hp -= dmg`,
     `attack` event; if `hp <= 0` remove monster and emit `kill`. Player does not move.
   - an item → auto-pickup: `'$'` → `state.loot += 1`; `'+'` → `hp = min(maxHp, hp+5)`;
     `pickup` event, item removed. Player moves onto the cell.
   - `'>'` → player moves on, `exit` event, `status = 'won'` (monster turns are then
     skipped — the game is over).
   - otherwise → move, `move` event.

### Monster turns (after the player, in ascending `id` order)

Melee `'m'` and ranged `'r'` both use the same **greedy chase** (no pathfinding):
if Chebyshev distance to player ≤ **6** (aggro), try steps toward the player —
primary axis is the one with the larger |delta| (tie → horizontal first); a candidate step
is invalid if it leaves the interior, is `'#'`, or is occupied by another monster.

- **Melee**: if a greedy step would enter the player's cell, it **attacks instead**:
  `dmg = roll(2,4)`, `monster-attack` event, monster stays. Otherwise it takes the first
  valid step (`monster-move` event) or stays. Beyond aggro: idles.
- **Ranged**: if aligned with the player (same row or column), distance ≤ **5**, and no
  `'#'` strictly between (walls only block) → **shoots instead of moving**:
  `dmg = roll(1,3)`, `shot` event, stays. Otherwise it chases exactly like melee, except it
  never enters the player's cell (it holds instead — no melee attack).

If the player's hp drops to ≤ 0: `death` event, `status = 'lost'`, and the **remaining
monsters skip their turns** this step.

### End of step

If `status` is still `'active'` and `turn >= maxTurns` → `timeout` event,
`status = 'timeout'`.

Stepping a non-`'active'` state is a **no-op**: same state content back, `events: []`.

## 6. `percepts(state, radius = 4)` → patch under the lamp

```js
{
  self: { hp, maxHp, x, y, turn, loot },
  local:    [ (2r+1) strings of (2r+1) chars ],  // window centered on player,
                                                 // row-major; out-of-bounds pads '#'
  monsters: [ { dx, dy, kind, hp } ],            // Chebyshev dist <= radius; dx=x'-x, dy=y'-y
  items:    [ { dx, dy, kind } ],                // kind: '$' | '+'
  exitSeen: { dx, dy } | null                    // present iff '>' within radius
}
```

`local[r][r]` is always `'@'`. `percepts` is pure and never consumes RNG.

## 6.5. `legalActions(p)` — the typed legality mask (additive v1.1.0)

```js
legalActions(p)  // p = a percept ({local}) or a state ({grid, player})
isLegalAction(action, p)
```

Returns the subset of `['up','down','left','right','wait']` whose target cell is
NOT `'#'` (in ACTIONS order). `wait` is always legal. A monster cell is legal
(bump = attack, §5). Out-of-bounds reads as `'#'` (percept padding already does
this), so the world's edge is illegal too — **a bump is never in the mask**.

- **THE MASK LAW — OFFERED, never enforced:** the mask is a typed cell scripts
  may consult; the engine's `step` behavior is unchanged and scripts that
  ignore it byte-reproduce. A script with no memory of walls can ask the
  percept's local window (the fog is the law — the mask reads the same patch
  under the lamp, nothing more).
- Pure, RNG-free (never consumes the cursor), never mutates its input.
- Throws `TypeError` on a shape that is neither percept nor state (fail-closed;
  a malformed window is a bug, not a fog).

## 7. `score(state)` → receipt numbers

```js
{
  loot,            // picked-up '$' count
  kills,           // count of 'kill' events in state.log
  hpLeft,          // player.hp
  turns,           // state.turn
  reachedExit,     // status === 'won'
  won,             // status === 'won'
  score: loot*10 + kills*25 + hpLeft*2 + (won ? 200 : 0) - turns*0.1
}
```

## 8. Scripts — player-logic

A **script file** default-exports a factory:

```js
export default (seed) => ({
  name: 'my-script',
  step(percept, memory) {
    // memory: a plain object, fresh {} per run, mutable, yours
    return { action: 'up' | 'down' | 'left' | 'right' | 'wait', thought: 'why' };
  },
});
```

Laws:

- **SYNC**: `step` returns in the same tick. No promises, no I/O, no model calls inside.
  (Models plug in via plan-ahead buffers or percept-hash memoization — see
  `docs/INTEGRATION.md`.)
- **DETERMINISTIC**: same percept-stream ⇒ same action stream. A script is a pure function
  of `(percept history, own memory)`.
- A script sees **only** `percept` and `memory` — never the raw state. The fog is the law.
- A script with no memory of walls can ask `legalActions(percept)` (§6.5) — the
  typed mask cell, offered to every seat since v1.1.0.
- If `step` throws or returns a malformed decision, the runner/coercion layer degrades to
  `'wait'` and records why; the game continues. (The game continues whether or not any
  model is reachable.)

## 9. DETERMINISM LAW

> Same seed + same script ⇒ byte-identical trajectory.

`src/runner.mjs` `runGame(scriptFactory, seed, { maxTurns = 200, radius = 4 } = {})` →

```js
{ trajectory: [ { turn, action, thought, hp, events } ], score, finalState }
```

- Loop while `status === 'active'`: percept → script.step → step.
- `action` is recorded **as returned by the script** (engine coerces unknowns to `wait`
  and emits `invalid-action`; runner-caught script exceptions record `action: null` and a
  `thought` of `script-error: <message>`).
- `trajectory` hash (sha256 over its canonical JSON, §10) is the run's fingerprint.

The test suite proves the law twice: in-process re-run and fresh-process CLI re-run.

## 10. Scoreboard — the fleet receipt chain

`scores.jsonl` is **append-only**. One JSON object per line:

```js
{ script, seed, score, turns, won, trajHash, ts, prev, hash }
```

- `ts`: ISO-8601 UTC timestamp of the append.
- `prev`: previous record's `hash` (genesis: 64 `'0'`s).
- `hash`: `sha256(canonicalJSON({script, seed, score, turns, won, trajHash, ts, prev}))`.
- `canonicalJSON`: keys sorted lexicographically, recursively; arrays keep order; no
  whitespace. (Standard `JSON.stringify` output is byte-stable for these values.)

`node src/scoreboard.mjs <script> <seed>...` runs the script on each seed and appends.
`verifyScores(path)` re-hashes every record and walks the chain; any edit breaks it.
`scores.jsonl` is committed: the ledger is the receipt, tampering is the sin.

## 11. Events catalog

| type | detail fields |
|------|---------------|
| `invalid-action` | `{ action }` |
| `bump` | `{ x, y }` (wall cell) |
| `move` | `{ from: [x,y], to: [x,y] }` (player) |
| `attack` | `{ target: id, kind, dmg, hp }` (player → monster; hp = monster hp after) |
| `kill` | `{ target: id, kind }` |
| `monster-move` | `{ id, from: [x,y], to: [x,y] }` |
| `monster-attack` | `{ id, dmg, hp }` (hp = player hp after) |
| `shot` | `{ id, dmg, hp }` |
| `pickup` | `{ id, kind, loot?, hp? }` |
| `exit` | `{ x, y }` |
| `death` | `{ cause: 'melee' \| 'ranged', by: id }` |
| `timeout` | `{ turn }` |

## 12. Compatibility rules for lanes

- Consume the state as JSON; ignore unknown fields; never require field order.
- Never mutate a state someone else handed you; call `step` (pure) instead.
- Pin `CONTRACT v1.x` in your lane docs; the socket only breaks on a major bump.
- `docs/INTEGRATION.md` is the how-to for JEV/MicroMoth/any-model lanes.
