# quilt-dungeons

> *"An array of characters is simply a quilt with every cell getting its own character,
> and the code is the relational understanding of what's happening."*

The dungeon is a quilt. Every tile is a stitched square — a wall `#`, a floor `.`, a
monster `m`, a shining piece of loot `$` — and the engine is nothing but the relational
understanding between the cells: who may sit next to whom, what happens when two cells
meet, what a cell becomes. There is no graphics library, no physics engine, no server.
There is a blanket of characters, and laws.

This repo is the **headless deterministic ML gym** built on that quilt: a roguelike you
can drive with scripts, score with a formula, and receipt with a hash chain. Same seed,
same script ⇒ **byte-identical trajectory** — that is the Determinism Law, and it is
tested, not promised. The human-facing sibling — the same dungeon with a keyboard and a
pulse — lives at [`SuperInstance/gh-dungeons`](https://github.com/SuperInstance/gh-dungeons).

---

## The quilt mapping

| quilt | dungeon | where it lives |
|-------|---------|----------------|
| **glyph = cell** | every tile is one character in a row-string; the grid is the full blanket, rendered | `state.grid` |
| **code = relational understanding** | `step()` is the adjacency law: bump = attack, aligned = shootable, adjacent = chasable | `src/engine.mjs` |
| **scripts = player-logic** | a script sees only the patch under the lamp (`percepts`), never the whole blanket | `scripts/*.js` |
| **trajectories = receipt chains** | every run leaves a replayable trail; every score is hash-chained into the ledger | `scores.jsonl` |

The fog is the law: a script gets a `(2r+1)²` window of characters centered on the player
and nothing else. What it cannot see, it must remember, infer, or forgive.

## Quickstart (60 seconds)

```bash
git clone https://github.com/SuperInstance/quilt-dungeons.git
cd quilt-dungeons
npm test                        # 20 tests, including the Determinism Law
node src/runner.mjs greedy-loot 1
node src/scoreboard.mjs hunter 1 2 3   # appends receipts to scores.jsonl
```

Write your first player-logic in [`docs/TUTORIAL.md`](docs/TUTORIAL.md) — clone to first
script in five minutes, no prior dungeon-crafting required.

## The laws (short form)

1. **Determinism Law.** `runGame(script, seed)` is a pure function of its inputs. Same
   seed + same script ⇒ byte-identical trajectory. The RNG is `mulberry32(seed)`; its
   cursor rides in the state, so any state resumes exactly.
2. **The fog law.** Scripts receive `percepts` (a small character window + relative
   positions) and their own `memory`. Never the raw state. Scripts are **sync** and
   **deterministic** — the game continues whether or not any model is reachable.
3. **The bump law.** Walking into a monster is an attack, for both parties. Melee
   monsters chase greedily within aggro 6; ranged monsters shoot when aligned within 5
   and a wall isn't between. Snipers don't punch.
4. **The receipt law.** `scores.jsonl` is append-only and hash-chained; every record
   carries the previous record's hash and the run's trajectory fingerprint. Tamper and
   the chain says so.

The full, exact, implement-it-from-this-page spec is
[`docs/CONTRACT.md`](docs/CONTRACT.md). It is the socket. Everything plugs into it.

## Baselines (seeds 1–8, receipted)

| script | idea | avg score |
|--------|------|-----------|
| `greedy-loot` | nearest shiny, stairs when seen, wall-hug the rest | 13.97 |
| `survivor` | flee first, gather second, stairs third | 18.74 |
| `hunter` | distance is damage not yet dealt; kill, then exit | 48.13 |

None of them ever wins. The 200-point exit bonus sits on the table unclaimed — none of
these myopic wall-huggers can hold the whole map in its head. That gap **is** the gym's
opening exercise, and it belongs to whoever (or whatever model) reads next.

## For ML lanes

- [`docs/INTEGRATION.md`](docs/INTEGRATION.md) — how to plug a model in (plan-ahead
  buffers, percept-hash memoization, the zero-call authored-script pattern).
- [`docs/CONTRACT.md`](docs/CONTRACT.md) §12 — the compatibility rules. Consume state as
  JSON, ignore unknown fields, pin the contract version.
- Zero dependencies, Node 20+, stdlib only. Clone it into a sandbox with no network and
  it still runs — the dungeon is a quilt, and quilts don't need the internet.

## For humans

Play the same dungeon with keys and rooms that were built for eyes:
[`SuperInstance/gh-dungeons`](https://github.com/SuperInstance/gh-dungeons) — the
human-facing Go roguelike. This repo is its headless twin: same glyphs, same instincts,
but built so a script can hold the lantern instead of you.

## Layout

```
src/engine.mjs      mulberry32, createGame, step, percepts, score — the quilt and its laws
src/runner.mjs      runGame + CLI — trajectories under the Determinism Law
src/scoreboard.mjs  the receipt chain — append-only, hash-linked, tamper-evident
scripts/*.js        baseline player-logic (greedy-loot, survivor, hunter)
tests/              20 tests: gen, step, percepts, score, runner, ledger, determinism
docs/               CONTRACT (the socket), TUTORIAL (first script in 5 min), INTEGRATION (model lanes)
scores.jsonl        the fleet receipt ledger — 24 baseline runs, chain verified
```

---

MIT. Stitch carefully: every cell is watching every other cell.
