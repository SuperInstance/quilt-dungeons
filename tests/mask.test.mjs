// quilt-dungeons mask tests — CONTRACT §6.5 (additive v1.1.0): the typed
// legality mask. THE MASK LAW: bump never in mask; OFFERED-only (existing
// scripts byte-reproduce — see ledger-replay.test.mjs); pure, RNG-free.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step, percepts, legalActions, isLegalAction, DIRS } from '../src/engine.mjs';
import { runGame } from '../src/runner.mjs';

const ACTIONS = ['up', 'down', 'left', 'right', 'wait'];
const DELTA = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0], wait: [0, 0] };

// Ground truth straight off a state's grid: legal iff target inside bounds and not '#'.
function gridTruth(s, x, y) {
  return ACTIONS.filter(a => {
    if (a === 'wait') return true;
    const [dx, dy] = DELTA[a];
    const nx = x + dx, ny = y + dy;
    return nx >= 0 && ny >= 0 && nx < s.w && ny < s.h && s.grid[ny][nx] !== '#';
  });
}

function synth(opts = {}) {
  const w = opts.w ?? 9, h = opts.h ?? 5;
  return {
    seed: 0, turn: 0, w, h,
    grid: opts.grid ?? Array.from({ length: h }, () => '.'.repeat(w)),
    player: { x: 0, y: 0, hp: 20, maxHp: 20, ...(opts.player ?? {}) },
    monsters: opts.monsters ?? [], items: opts.items ?? [], log: [],
    rngState: 42, status: 'active', maxTurns: 200, loot: 0,
    exit: opts.exit ?? { x: w - 1, y: h - 1 },
  };
}

test('mask: basic walls — every walled cardinal excluded, wait always in', () => {
  const s = synth({
    grid: ['#########', '###@...m#', '#########'],
    player: { x: 3, y: 1 },
    monsters: [{ id: 0, x: 6, y: 1, hp: 5, kind: 'm' }],
  });
  const mask = legalActions(s);
  assert.equal(mask.includes('up'), false, 'wall above excluded');
  assert.equal(mask.includes('down'), false, 'wall below excluded');
  assert.equal(mask.includes('left'), false, 'wall left excluded');
  assert.equal(mask.includes('right'), true, 'open right included');
  assert.equal(mask.includes('wait'), true, 'wait always legal');
  assert.deepEqual(mask, ['right', 'wait'], 'ACTIONS order preserved');
});

test('mask: bump-attack — a monster cell IS legal (the mask is not a pacifist)', () => {
  const s = synth({
    grid: ['#########', '###@m...#', '#########'],
    player: { x: 3, y: 1 },
    monsters: [{ id: 0, x: 4, y: 1, hp: 5, kind: 'm' }],
  });
  assert.ok(legalActions(s).includes('right'), 'bumping a monster = attacking = legal');
});

test('mask: out-of-bounds reads as wall — world edge excluded (state and percept agree)', () => {
  // (a) a walled room: the border walls themselves are excluded
  const room = synth({
    w: 11, h: 5,
    grid: ['###########', '#.........#', '#.........#', '#.........#', '###########'],
    player: { x: 1, y: 1 },
  });
  const mask = legalActions(room);
  assert.equal(mask.includes('up'), false, 'border wall above excluded');
  assert.equal(mask.includes('left'), false, 'border wall left excluded');
  assert.deepEqual(mask, ['down', 'right', 'wait']);
  const p = percepts(room, 2);
  assert.deepEqual(legalActions(p), mask, 'percept path == state path (padding is #)');

  // (b) a borderless open room with the player at (0,0): up/left leave the
  // world — the state path bounds-check and the percept path's '#' padding
  // must agree that those are illegal.
  const open = synth({ w: 5, h: 3, player: { x: 0, y: 0 } });
  const mask2 = legalActions(open);
  assert.equal(mask2.includes('up'), false, 'off the top excluded');
  assert.equal(mask2.includes('left'), false, 'off the left excluded');
  assert.deepEqual(mask2, ['down', 'right', 'wait']);
  assert.deepEqual(legalActions(percepts(open, 1)), mask2, 'OOB padding agrees');
});

test('mask: matches the grid — seeds 1-8, every step: excluded cardinals bump, included never bump', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    let s = createGame(seed);
    for (let i = 0; i < 30 && s.status === 'active'; i++) {
      const mask = legalActions(s);
      const truth = gridTruth(s, s.player.x, s.player.y);
      assert.deepEqual(mask, truth, `seed ${seed} tick ${i}: mask == grid truth`);
      assert.ok(mask.includes('wait'));
      // percept path agrees, both radii
      assert.deepEqual(legalActions(percepts(s, 1)), truth, `seed ${seed} tick ${i} r=1`);
      assert.deepEqual(legalActions(percepts(s, 4)), truth, `seed ${seed} tick ${i} r=4`);
      // the law, exercised: for every cardinal, step emits bump IFF excluded
      for (const a of ['up', 'down', 'left', 'right']) {
        const r = step(s, a);
        const bumped = r.events.some(e => e.type === 'bump');
        assert.equal(bumped, !mask.includes(a), `seed ${seed} tick ${i} ${a}: bump iff not in mask`);
      }
      // advance by a legal move (first open cardinal, else wait) to keep walking
      const nxt = mask.find(a => a !== 'wait') ?? 'wait';
      s = step(s, nxt).state;
    }
  }
});

test('mask: pure and RNG-free — inputs unmutated, rngState untouched', () => {
  const s = createGame(9);
  const before = JSON.stringify(s);
  const p = percepts(s, 4);
  const pBefore = JSON.stringify(p);
  legalActions(s); legalActions(p); isLegalAction('up', p);
  assert.equal(JSON.stringify(s), before, 'state unmutated');
  assert.equal(JSON.stringify(p), pBefore, 'percept unmutated');
  assert.equal(s.rngState, JSON.parse(before).rngState, 'no RNG consumed');
});

test('mask: fail-closed on garbage shapes', () => {
  assert.throws(() => legalActions({}), TypeError);
  assert.throws(() => legalActions(null), TypeError);
  assert.throws(() => legalActions({ local: ['..#'] }), TypeError); // not (2r+1)² with r>=1
  assert.deepEqual(legalActions({ local: ['###', '#@#', '###'] }), ['wait'], 'entombed player: only wait');
});

test('mask: a no-memory script rides the mask — zero bumps, zero invalid actions, full episodes', () => {
  // The script remembers nothing: every tick it asks the percept's mask and
  // takes the first open cardinal (wait only if entombed).
  const maskedWalker = () => ({
    name: 'masked-walker',
    step(percept) {
      const mask = legalActions(percept);
      return { action: mask.find(a => a !== 'wait') ?? 'wait', thought: 'asked the mask cell' };
    },
  });
  for (const seed of [1, 2, 3]) {
    const run = runGame(maskedWalker, seed);
    const bumps = run.trajectory.flatMap(t => t.events).filter(e => e.type === 'bump');
    const invalid = run.trajectory.flatMap(t => t.events).filter(e => e.type === 'invalid-action');
    assert.equal(bumps.length, 0, `seed ${seed}: bump never executed from inside the mask`);
    assert.equal(invalid.length, 0, `seed ${seed}: no invalid actions`);
    assert.equal(run.trajectory.length, run.finalState.turn);
  }
});

test('mask: isLegalAction convenience agrees with the array form', () => {
  const s = createGame(5);
  const mask = legalActions(s);
  for (const a of ACTIONS) assert.equal(isLegalAction(a, s), mask.includes(a));
  assert.equal(isLegalAction('strut', s), false, 'unknown actions are not legal');
});
