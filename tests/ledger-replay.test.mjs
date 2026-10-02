// quilt-dungeons ledger replay — THE BYTE-REPRODUCTION PROOF: every committed
// scores.jsonl record (the append-only receipt chain) must reproduce its
// trajHash AND score byte-exactly from the current engine. The mask cell
// (CONTRACT §6.5) is OFFERED-only, so adding it must not move a single hash —
// this test is the proof that the baselines' behavior is unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGame, trajHash, loadScript } from '../src/runner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

test('ledger replay: every scores.jsonl record byte-reproduces (trajHash + score)', async () => {
  const lines = readFileSync(path.join(root, 'scores.jsonl'), 'utf8')
    .split('\n').filter(l => l.trim());
  assert.ok(lines.length >= 24, `expected the committed ledger (>=24 records), got ${lines.length}`);

  const factories = new Map(); // script name -> factory (load once)
  let checked = 0;
  for (const line of lines) {
    const rec = JSON.parse(line);
    if (!factories.has(rec.script)) factories.set(rec.script, await loadScript(rec.script));
    const run = runGame(factories.get(rec.script), rec.seed);
    assert.equal(trajHash(run.trajectory), rec.trajHash,
      `${rec.script} seed ${rec.seed}: trajHash drifted — the engine moved under the ledger`);
    assert.equal(run.score.score, rec.score,
      `${rec.script} seed ${rec.seed}: score drifted`);
    assert.equal(run.score.won, rec.won, `${rec.script} seed ${rec.seed}: won flag drifted`);
    checked++;
  }
  assert.equal(checked, lines.length, `replayed ${checked}/${lines.length} records`);
});
