// quilt-dungeons scoreboard — the fleet receipt chain (CONTRACT §10).
// scores.jsonl is append-only; every record hashes the previous one.
//
// CLI: node src/scoreboard.mjs <script-name-or-path> <seed> [<seed>...]
//      runs each (script, seed) and appends one receipt per run.
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { runGame, loadScript, trajHash } from './runner.mjs';
import { canonicalJSON, sha256Hex } from './util.mjs';

export const GENESIS = '0'.repeat(64);

export function readScores(scoresPath) {
  if (!existsSync(scoresPath)) return [];
  return readFileSync(scoresPath, 'utf8')
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line));
}

// Walk the chain: every record's prev must be the previous hash, and every
// hash must re-derive from the record's body.
export function verifyScores(scoresPath) {
  const recs = readScores(scoresPath);
  let prev = GENESIS;
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    if (rec.prev !== prev) {
      return { ok: false, count: i, error: `record ${i}: prev mismatch (chain broken)` };
    }
    const { hash, ...body } = rec;
    const expect = sha256Hex(canonicalJSON(body));
    if (hash !== expect) {
      return { ok: false, count: i, error: `record ${i}: hash mismatch (record tampered)` };
    }
    prev = rec.hash;
  }
  return { ok: true, count: recs.length, error: null };
}

export function makeRecord(result, ts, prevHash) {
  const body = {
    script: result.script,
    seed: result.seed,
    score: result.score,
    turns: result.turns,
    won: result.won,
    trajHash: result.trajHash,
    ts,
    prev: prevHash,
  };
  const hash = sha256Hex(canonicalJSON(body));
  return { ...body, hash };
}

export function appendResults(scoresPath, results) {
  const recs = readScores(scoresPath);
  let prevHash = recs.length ? recs[recs.length - 1].hash : GENESIS;
  const appended = [];
  for (const result of results) {
    const rec = makeRecord(result, new Date().toISOString(), prevHash);
    appended.push(rec);
    prevHash = rec.hash;
    appendFileSync(scoresPath, canonicalJSON(rec) + '\n');
  }
  return appended;
}

async function main(argv) {
  const [target, ...seedArgs] = argv;
  if (!target || seedArgs.length === 0) {
    console.error('usage: node src/scoreboard.mjs <script-name-or-path> <seed> [<seed>...]');
    process.exit(1);
  }
  const factory = await loadScript(target);
  const name = factory(Number.parseInt(seedArgs[0], 10)).name;
  const results = [];
  for (const seedArg of seedArgs) {
    const seed = Number.parseInt(seedArg, 10);
    const run = runGame(factory, seed);
    results.push({
      script: name,
      seed,
      score: run.score.score,
      turns: run.score.turns,
      won: run.score.won,
      trajHash: trajHash(run.trajectory),
    });
  }
  const scoresPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scores.jsonl');
  const appended = appendResults(scoresPath, results);
  for (const rec of appended) {
    console.log(canonicalJSON(rec));
  }
  const verdict = verifyScores(scoresPath);
  console.error(`chain: ${verdict.ok ? 'OK' : 'BROKEN'} (${verdict.count} records)${verdict.error ? ' — ' + verdict.error : ''}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main(process.argv.slice(2));
}
