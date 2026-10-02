// quilt-dungeons scoreboard tests — the fleet receipt chain
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appendResults, verifyScores, GENESIS } from '../src/scoreboard.mjs';
import { canonicalJSON, sha256Hex } from '../src/util.mjs';

test('canonicalJSON: sorted keys, recursively; arrays keep order', () => {
  assert.equal(canonicalJSON({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalJSON({ z: { c: 1, a: [2, 1] }, a: null }), '{"a":null,"z":{"a":[2,1],"c":1}}');
  assert.equal(canonicalJSON('x'), '"x"');
  assert.equal(canonicalJSON(0.1), '0.1');
});

test('scoreboard: hash-chained append-only ledger, tamper-evident', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'qd-ledger-'));
  const file = path.join(dir, 'scores.jsonl');
  const rec = (seed, score) => ({ script: 'greedy-loot', seed, score, turns: 40, won: false, trajHash: 'a'.repeat(64) });

  appendResults(file, [rec(1, 12.3), rec(2, -3.5)]);
  const v1 = verifyScores(file);
  assert.equal(v1.ok, true);
  assert.equal(v1.count, 2);
  assert.equal(v1.error, null);

  const lines = readFileSync(file, 'utf8').trim().split('\n');
  const recs = lines.map(l => JSON.parse(l));
  assert.equal(recs[0].prev, GENESIS, 'genesis prev is 64 zeros');
  assert.equal(recs[1].prev, recs[0].hash, 'chain links');
  const { hash, ...body0 } = recs[0];
  assert.equal(hash, sha256Hex(canonicalJSON(body0)), 'hash re-derives');

  // appending more continues the chain
  appendResults(file, [rec(3, 99)]);
  assert.equal(verifyScores(file).ok, true);

  // tamper with a committed score -> the chain catches it
  const tampered = lines.map(l => JSON.parse(l));
  tampered[0].score = 999;
  writeFileSync(file, tampered.map(r => canonicalJSON(r)).join('\n') + '\n');
  const v2 = verifyScores(file);
  assert.equal(v2.ok, false);
  assert.match(v2.error, /hash mismatch/);

  // a spliced-out record breaks prev linkage
  const spliced = readFileSync(file, 'utf8').trim().split('\n').slice(1);
  writeFileSync(file, spliced.join('\n') + '\n');
  const v3 = verifyScores(file);
  assert.equal(v3.ok, false);
  assert.match(v3.error, /prev mismatch/);

  rmSync(dir, { recursive: true, force: true });
});
