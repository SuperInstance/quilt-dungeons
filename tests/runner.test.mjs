// quilt-dungeons runner tests — the DETERMINISM LAW
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGame, trajHash } from '../src/runner.mjs';
import { canonicalJSON } from '../src/util.mjs';
import greedyLoot from '../scripts/greedy-loot.js';
import survivor from '../scripts/survivor.js';
import hunter from '../scripts/hunter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const baselines = [
  ['greedy-loot', greedyLoot],
  ['survivor', survivor],
  ['hunter', hunter],
];

test('DETERMINISM LAW: same seed + same script => byte-identical trajectory', () => {
  for (const [name, factory] of baselines) {
    for (const seed of [4, 12]) {
      const a = runGame(factory, seed);
      const b = runGame(factory, seed);
      assert.equal(canonicalJSON(a.trajectory), canonicalJSON(b.trajectory), `${name} seed ${seed}`);
      assert.equal(trajHash(a.trajectory), trajHash(b.trajectory), `${name} seed ${seed}`);
    }
  }
  assert.notEqual(trajHash(runGame(greedyLoot, 4).trajectory), trajHash(runGame(greedyLoot, 5).trajectory));
});

test('DETERMINISM LAW holds across processes (CLI double-run, byte-equal stdout)', () => {
  const run = () => execFileSync(
    process.execPath,
    [path.join(here, '..', 'src', 'runner.mjs'), 'greedy-loot', '7'],
    { encoding: 'utf8' },
  );
  const out1 = run();
  const out2 = run();
  assert.equal(out1, out2);
  const parsed = JSON.parse(out1);
  assert.equal(parsed.script, 'greedy-loot');
  assert.equal(parsed.seed, 7);
  assert.match(parsed.trajHash, /^[0-9a-f]{64}$/);
});

test('runGame: shape, termination, score consistency for every baseline', () => {
  for (const [name, factory] of baselines) {
    const run = runGame(factory, 1, { maxTurns: 60 });
    assert.ok(run.finalState.status !== 'active', `${name} terminated`);
    assert.ok(run.finalState.turn <= 60);
    assert.equal(run.trajectory.length, run.finalState.turn);
    for (const t of run.trajectory) {
      assert.ok(t.action === null || ['up', 'down', 'left', 'right', 'wait'].includes(t.action), `${name} action`);
      assert.equal(typeof t.thought, 'string');
      assert.ok(Array.isArray(t.events));
      assert.ok(Number.isInteger(t.turn));
      assert.ok(Number.isInteger(t.hp));
    }
    const s = run.score;
    assert.equal(s.turns, run.finalState.turn);
    assert.equal(s.score, s.loot * 10 + s.kills * 25 + s.hpLeft * 2 + (s.won ? 200 : 0) - s.turns * 0.1);
  }
});

test('the game continues: a throwing script degrades to wait, everything recorded', () => {
  const bad = () => ({ name: 'bad', step() { throw new Error('model unreachable'); } });
  const run = runGame(bad, 3, { maxTurns: 5 });
  assert.equal(run.finalState.status, 'timeout');
  assert.equal(run.trajectory.length, 5);
  assert.ok(run.trajectory.every(t => t.action === null && t.thought.startsWith('script-error:')));
  assert.ok(run.trajectory.every(t => t.events.some(e => e.type === 'invalid-action')));
  assert.equal(run.score.won, false);
});
