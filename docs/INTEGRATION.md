# INTEGRATION — the contract is the socket

For JEV, MicroMoth, and any other lane that wants to ML the quilt. The whole integration
story is one sentence: **the dungeon keeps running whether or not any model is
reachable**, so models must enter as *deterministic artifacts*, never as live calls.

## The one load-bearing rule

`step(percept, memory)` is **SYNC and DETERMINISTIC given the percept stream**
(CONTRACT §8). No promises, no I/O, no model calls inside the loop — because one async
call, one flaky timeout, one token-temperature wobble and the Determinism Law dies:
same seed + same script would no longer give byte-identical trajectories, and the
receipt chain would be measuring noise.

So models participate in one of three shapes. All three keep the law.

## Shape 1 — plan-ahead buffer (model writes, script performs)

Run the model **before** the run; the script reads its output.

```js
// lane-side, before runGame:
const plan = await model.plan(perceptAtSpawn, seed);   // e.g. ['right','right','up',...]

// the script is sync and pure:
export default (seed) => ({
  name: 'model-plan-v1',
  step(percept, memory) {
    const action = memory.plan?.shift() ?? fallback(percept, memory);
    return { action, thought: `plan step: ${action}` };
  },
});
```

The durable artifact is the plan + the trajectory. If the plan goes stale (a monster
wasn't where the model imagined), the script's fallback takes over deterministically —
and the trajectory shows exactly where the model's map of the quilt diverged from the
quilt itself. That divergence trace is the training signal.

## Shape 2 — percept-hash memoization (model as lookup table)

Cache `sha256(canonicalJSON(percept)) → action`. Cold misses get a deterministic
authored fallback; warm hits replay the model's answer with zero calls.

```js
import { canonicalJSON, sha256Hex } from '../src/util.mjs';

export default function modelMemo(seed, table = loadedTable) {
  return {
    name: 'model-memo-v1',
    step(percept, memory) {
      const key = sha256Hex(canonicalJSON(percept));
      const hit = table[key];
      if (hit) return { action: hit.action, thought: `memo hit ${key.slice(0, 8)}` };
      return fallbackScript.step(percept, memory); // authored, deterministic
    },
  };
}
```

This is the quilt-format pattern in miniature: decomposition toward lookup tables, small
models at the soft joints. The memo table is a seerable, diffable, committable artifact —
a quilt cell with a model woven through it.

## Shape 3 — authored scripts (zero model calls, zero excuses)

The three baselines (`scripts/greedy-loot.js`, `survivor.js`, `hunter.js`) are pure
player-logic. A lane can improve them with nothing but code: better exploration memory,
kill-counting via monster-disappearance inference, corridor-following. The scoreboard
measures the delta; the receipt chain keeps it honest.

## Plugging in, step by step

1. **Pin the contract.** Read `docs/CONTRACT.md` §12. Consume state as JSON, ignore
   unknown fields, never mutate a state you were handed (`step` is pure — clone or
   re-derive).
2. **Write your script** as a factory under `scripts/<lane>-<name>.js`. Default export.
   Sync. Deterministic. Name it like you'll defend it.
3. **Prove the law for your artifact.** `runGame` twice, compare `trajHash`. The test
   suite does this for the baselines; do it for yours before posting scores.
4. **Post receipts.** `node src/scoreboard.mjs <your-script> 1 2 3 4 5 6 7 8` — appends
   hash-chained records (script, seed, score, turns, won, trajHash, ts, prev, hash) to
   `scores.jsonl`. Commit the ledger.
5. **Return the table.** The fleet convention: per-seed scores, average, wins, plus the
   one design decision the next lane should know about.

## What the engine guarantees you

- `createGame(seed, opts)` — the quilt, deterministic from the seed; rooms + corridors;
  player, exit, monsters, items all flood-fill reachable.
- `step(state, action)` — pure; events for everything that moved or bled; `rngState`
  cursor rides in the state, so resume is byte-exact.
- `percepts(state, radius)` — the patch under the lamp; center always `@`; fog cuts at
  Chebyshev `radius`; out-of-world reads `#`.
- `score(state)` — `loot*10 + kills*25 + hpLeft*2 + (won?200:0) − turns*0.1`.
- `runGame(scriptFactory, seed, {maxTurns=200, radius=4})` — the loop, the trajectory,
  the fingerprint. Same in, byte-identical out, cross-process.

## Known open ground (for whoever MLs next)

- **No baseline has won.** The exit bonus (200) has never been claimed: myopic
  wall-huggers cannot hold the map in their heads. Exploration memory is the cheapest
  big win on the board.
- **Hunter dies rich.** `hunter` more than triples the others but still bleeds out on
  ranged crossfire; hit-and-run is unstitched.
- **Kill inference is unexploited.** A script that tracks "the monster I hit last turn
  is gone from my memory of the quilt" can count kills without events — a small, pure
  relational-memory exercise.

The dungeon is a quilt; every model that plays it adds a row. Keep the rows
deterministic and the blanket stays rewirable forever.
