// quilt-dungeons runner — the game continues whether or not any model is
// reachable. DETERMINISM LAW (CONTRACT §9): same seed + same script ⇒
// byte-identical trajectory.
//
// CLI: node src/runner.mjs <script-name-or-path> [seed] [maxTurns]
//      prints one canonical JSON line: {script, seed, score, turns, won, trajHash}
import { createGame, percepts, step, score } from './engine.mjs';
import { canonicalJSON, sha256Hex } from './util.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export function trajHash(trajectory) {
  return sha256Hex(canonicalJSON(trajectory));
}

export function runGame(scriptFactory, seed, { maxTurns = 200, radius = 4 } = {}) {
  let state = createGame(seed, { maxTurns });
  const script = scriptFactory(seed);
  const memory = {};
  const trajectory = [];

  while (state.status === 'active' && state.turn < state.maxTurns) {
    const percept = percepts(state, radius);
    let action = null;
    let thought = '';
    try {
      const decision = script.step(percept, memory);
      if (decision && decision.action != null) action = decision.action;
      if (decision && decision.thought != null) thought = String(decision.thought);
    } catch (err) {
      // the game continues: a broken or unreachable player-logic degrades to wait
      action = null;
      thought = 'script-error: ' + (err && err.message ? err.message : String(err));
    }
    const res = step(state, action); // engine coerces unknown/null to wait + invalid-action
    state = res.state;
    trajectory.push({ turn: state.turn, action, thought, hp: state.player.hp, events: res.events });
  }

  return { trajectory, score: score(state), finalState: state };
}

// Resolve `<name>` to scripts/<name>.js at the package root; pass through any
// path-like target. Returns the default-export factory.
export async function loadScript(target) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkgRoot = path.resolve(here, '..');
  const file = /[\\/]/.test(target) || /\.(js|mjs)$/.test(target)
    ? path.resolve(target)
    : path.join(pkgRoot, 'scripts', `${target}.js`);
  const mod = await import(pathToFileURL(file).href);
  if (typeof mod.default !== 'function') {
    throw new Error(`script "${target}" must default-export a factory: (seed) => ({name, step})`);
  }
  return mod.default;
}

async function main(argv) {
  const [target, seedArg, maxTurnsArg] = argv;
  if (!target) {
    console.error('usage: node src/runner.mjs <script-name-or-path> [seed] [maxTurns]');
    process.exit(1);
  }
  const seed = Number.parseInt(seedArg ?? '1', 10);
  const maxTurns = Number.parseInt(maxTurnsArg ?? '200', 10);
  const factory = await loadScript(target);
  const run = runGame(factory, seed, { maxTurns });
  const out = {
    script: factory(seed).name,
    seed,
    score: run.score.score,
    turns: run.score.turns,
    won: run.score.won,
    trajHash: trajHash(run.trajectory),
  };
  console.log(canonicalJSON(out));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main(process.argv.slice(2));
}
