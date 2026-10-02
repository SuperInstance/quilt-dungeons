# TUTORIAL — from clone to first script in five minutes

Zero model calls, zero dependencies, zero prior dungeon-crafting. You need Node 20+.

## 0. Clone and prove the ground (30 seconds)

```bash
git clone https://github.com/SuperInstance/quilt-dungeons.git
cd quilt-dungeons
npm test                          # 20 tests, incl. the Determinism Law
node src/runner.mjs greedy-loot 1 # watch a baseline die productively
```

That second command prints one line of canonical JSON: the script, seed, score, turns,
and the run's fingerprint (`trajHash`) — the same run always prints the same line. That
is not a promise, it is a law: **same seed + same script ⇒ byte-identical trajectory**.

## 1. Look at a quilt

```js
import { createGame, percepts } from './src/engine.mjs';
const g = createGame(1);
for (const row of g.grid) console.log(row);
console.log(percepts(g, 4).local); // the 9×9 patch a script would see at spawn
```

Every character is a cell: `#` wall, `.` floor, `@` you, `m` melee monster, `r` sniper,
`$` loot, `+` potion, `>` stairs. The engine is just the relational understanding
between those cells.

## 2. Write your first player-logic (2 minutes)

Create `scripts/my-first.js`. A script is a factory: `(seed) => { name, step }`.
`step` gets a **percept** (the patch under the lamp) and a **memory** (yours, mutable,
per-run), and returns an action plus the reason:

```js
export default function myFirst(seed) {
  return {
    name: 'my-first',
    step(percept, memory) {
      const r = (percept.local.length - 1) / 2;        // window radius
      const cell = (dx, dy) => percept.local[r + dy][r + dx];
      memory.steps ??= 0;
      memory.steps += 1;

      // walk to the nearest loot you can see
      let best = null;
      for (const it of percept.items) {
        const d = Math.abs(it.dx) + Math.abs(it.dy);
        if (!best || d < best.d) best = it;
      }
      if (best) {
        const action = Math.abs(best.dx) >= Math.abs(best.dy)
          ? (best.dx > 0 ? 'right' : 'left')
          : (best.dy > 0 ? 'down' : 'up');
        return { action, thought: `loot at (${best.dx},${best.dy})` };
      }

      // see the stairs? take them.
      if (percept.exitSeen) {
        const e = percept.exitSeen;
        return { action: Math.abs(e.dx) >= Math.abs(e.dy) ? (e.dx > 0 ? 'right' : 'left') : (e.dy > 0 ? 'down' : 'up'), thought: 'stairs' };
      }

      // otherwise: step right until you bump something, then fall a floor
      if (cell(1, 0) !== '#') return { action: 'right', thought: `sweeping right (step ${memory.steps})` };
      return { action: 'down', thought: 'wall ahead, dropping a row' };
    },
  };
}
```

Actions are `'up' | 'down' | 'left' | 'right' | 'wait'`. Bumping into a monster attacks
it (2–5 damage); stepping onto `$` or `+` picks it up automatically; stepping onto `>`
wins. Walking into `m` or `r` cells in `local` means attack — `passable` is your policy.

## 3. Run it, score it, receipt it (1 minute)

```bash
node src/runner.mjs my-first 1
node src/scoreboard.mjs my-first 1 2 3 4 5 6 7 8   # appends to scores.jsonl
node --input-type=module -e '
import { verifyScores } from "./src/scoreboard.mjs";
console.log(verifyScores("./scores.jsonl"));'      # { ok: true, count: ... }
```

Your scores are now hash-chained to every baseline score before them. The chain is
append-only and tamper-evident: edit one byte of history and `verifyScores` names the
record.

## 4. Read the fog like a pro

Your percept, exactly (CONTRACT §6):

```js
{
  self:    { hp, maxHp, x, y, turn, loot },
  local:   ['#####', '#@m..', '...>.', ...],  // (2r+1)² chars, center is '@',
                                              // outside-the-world reads '#'
  monsters:[{ dx, dy, kind, hp }],            // Chebyshev distance ≤ radius
  items:   [{ dx, dy, kind }],
  exitSeen:{ dx, dy } | null                  // only if '>' is in the window
}
```

`memory` is where sight becomes knowledge: remember where you have been, count the
monsters you have wounded, hold a plan across turns. The Determinism Law applies to
memory too — same percepts in, same decisions out, every replay.

## 5. Where to go next

- [`docs/CONTRACT.md`](CONTRACT.md) — the whole law, one page. It is the socket; code
  against it and your script runs forever.
- `scripts/hunter.js` — read it: 60 lines of player-logic that more than triples
  `greedy-loot`'s score by treating distance as damage not yet dealt.
- [`docs/INTEGRATION.md`](INTEGRATION.md) — if you are a model lane (JEV, MicroMoth,
  anything async): how to plug in without breaking the Determinism Law.
- The gym's opening exercise: no baseline has ever taken the stairs. The 200-point win
  bonus is unclaimed. Hold the map in your head and claim it.
