// quilt-dungeons engine tests — CONTRACT v1.0.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, makeRng, createGame, step, percepts, score } from '../src/engine.mjs';

// Synthetic state builder for unit-level rules; full gen is tested separately.
function synth(opts = {}) {
  const w = opts.w ?? 9;
  const h = opts.h ?? 3;
  return {
    seed: 0,
    turn: opts.turn ?? 0,
    w,
    h,
    grid: opts.grid ?? Array.from({ length: h }, () => '.'.repeat(w)),
    player: { x: 0, y: 0, hp: 20, maxHp: 20, ...(opts.player ?? {}) },
    monsters: opts.monsters ?? [],
    items: opts.items ?? [],
    log: opts.log ?? [],
    rngState: opts.rngState ?? 42,
    status: opts.status ?? 'active',
    maxTurns: opts.maxTurns ?? 200,
    loot: opts.loot ?? 0,
    exit: opts.exit ?? { x: w - 1, y: h - 1 },
  };
}

// ---------------------------------------------------------------------------
// RNG
// ---------------------------------------------------------------------------

test('mulberry32: same seed same sequence, cursor resumes byte-exactly', () => {
  const seq = (seed, n) => {
    const f = mulberry32(seed);
    return Array.from({ length: n }, () => f());
  };
  assert.deepEqual(seq(1, 50), seq(1, 50));
  assert.notDeepEqual(seq(1, 50), seq(2, 50));
  const r1 = makeRng(7);
  r1.next(); r1.next();
  const r2 = makeRng(r1.a);
  assert.equal(r1.next(), r2.next());
  const r3 = makeRng(9);
  for (let i = 0; i < 1000; i++) {
    const v = r3.next();
    assert.ok(v >= 0 && v < 1, 'uniform in [0,1)');
  }
});

// ---------------------------------------------------------------------------
// createGame
// ---------------------------------------------------------------------------

test('createGame: deterministic from seed', () => {
  const g1 = createGame(1);
  const g2 = createGame(1);
  assert.equal(JSON.stringify(g1), JSON.stringify(g2));
  const g3 = createGame(2);
  assert.notEqual(JSON.stringify(g1), JSON.stringify(g3));
  assert.ok(Number.isInteger(g1.rngState) && g1.rngState >= 0 && g1.rngState <= 0xFFFFFFFF);
});

test('createGame: quilt invariants — border walls, spawns, counts, reachability', () => {
  for (const seed of [1, 2, 3]) {
    const g = createGame(seed);
    assert.equal(g.w, 48);
    assert.equal(g.h, 24);
    assert.equal(g.grid.length, 24);
    for (const row of g.grid) assert.equal(row.length, 48);
    for (const x of [0, 47]) for (let y = 0; y < 24; y++) assert.equal(g.grid[y][x], '#', `border col ${x}`);
    for (const y of [0, 23]) for (let x = 0; x < 48; x++) assert.equal(g.grid[y][x], '#', `border row ${y}`);
    assert.equal(g.grid[g.player.y][g.player.x], '@', 'player rendered');
    let exits = 0;
    for (const row of g.grid) for (const ch of row) if (ch === '>') exits++;
    assert.equal(exits, 1);
    assert.equal(g.grid[g.exit.y][g.exit.x], '>');
    assert.equal(g.monsters.length, 8);
    assert.equal(g.items.filter(i => i.kind === '$').length, 10);
    assert.equal(g.items.filter(i => i.kind === '+').length, 3);
    for (const m of g.monsters) {
      assert.equal(g.grid[m.y][m.x], m.kind, 'monster rendered');
      assert.equal(m.hp, m.kind === 'm' ? 5 : 3);
    }
    for (const it of g.items) assert.equal(g.grid[it.y][it.x], it.kind, 'item rendered');
    assert.deepEqual(g.monsters.map(m => m.id), g.monsters.map((_, i) => i));

    // flood-fill reachability from the player
    const seen = new Set([`${g.player.x},${g.player.y}`]);
    const q = [[g.player.x, g.player.y]];
    while (q.length) {
      const [x, y] = q.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        const k = `${nx},${ny}`;
        if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h || seen.has(k)) continue;
        if (g.grid[ny][nx] === '#') continue;
        seen.add(k);
        q.push([nx, ny]);
      }
    }
    assert.ok(seen.has(`${g.exit.x},${g.exit.y}`), 'exit reachable');
    for (const m of g.monsters) assert.ok(seen.has(`${m.x},${m.y}`), 'monster reachable');
    for (const it of g.items) assert.ok(seen.has(`${it.x},${it.y}`), 'item reachable');
  }
});

// ---------------------------------------------------------------------------
// step — purity + determinism
// ---------------------------------------------------------------------------

test('step: pure — never mutates the state it is handed', () => {
  const g = createGame(5);
  const before = JSON.stringify(g);
  let s = g;
  for (const a of ['right', 'down', 'wait', 'up', 'left', 'right']) s = step(s, a).state;
  assert.equal(JSON.stringify(g), before);
  assert.notEqual(g, s);
});

test('step: same seed + same actions => byte-identical states and events', () => {
  const actions = ['right', 'right', 'down', 'wait', 'left', 'up', 'right', 'wait', 'down', 'down', 'left', 'left'];
  const run = () => {
    let s = createGame(11);
    const evs = [];
    for (const a of actions) {
      const r = step(s, a);
      s = r.state;
      evs.push(JSON.stringify(r.events));
    }
    return { s, evs };
  };
  const r1 = run();
  const r2 = run();
  assert.equal(JSON.stringify(r1.s), JSON.stringify(r2.s));
  assert.deepEqual(r1.evs, r2.evs);
});

// ---------------------------------------------------------------------------
// step — the relational rules between cells
// ---------------------------------------------------------------------------

test('step: bump = attack; monsters die; the player holds position', () => {
  const state = synth({
    grid: ['#########', '###@m...#', '#########'],
    player: { x: 3, y: 1 },
    monsters: [{ id: 0, x: 4, y: 1, hp: 5, kind: 'm' }],
  });
  let s = state;
  let sawKill = false;
  let dmgTotal = 0;
  let guard = 0;
  while (s.monsters.length > 0 && guard++ < 10) {
    const res = step(s, 'right');
    const atk = res.events.find(e => e.type === 'attack');
    if (atk) {
      assert.ok(atk.detail.dmg >= 2 && atk.detail.dmg <= 5, 'player dmg 2-5');
      assert.equal(atk.detail.target, 0);
      dmgTotal += atk.detail.dmg;
    }
    if (res.events.some(e => e.type === 'kill')) sawKill = true;
    s = res.state;
    assert.equal(s.player.x, 3, 'bump-attack never moves the player');
  }
  assert.ok(sawKill, 'kill event emitted');
  assert.ok(dmgTotal >= 5);
  assert.equal(s.monsters.length, 0);
  assert.equal(s.grid[1][4], '.', 'monster glyph lifted on death');
});

test('step: melee chase is greedy-cardinal within aggro 6, idles beyond', () => {
  const close = synth({
    grid: ['###########', '###@...m..#', '###########'],
    player: { x: 3, y: 1 },
    monsters: [{ id: 0, x: 7, y: 1, hp: 5, kind: 'm' }],
  });
  const res = step(close, 'wait');
  const mv = res.events.find(e => e.type === 'monster-move');
  assert.ok(mv, 'monster moved');
  assert.equal(res.state.monsters[0].x, 6, 'stepped one cell closer');
  assert.equal(res.state.player.hp, 20);

  const far = synth({
    grid: ['#############', '###@.......m#', '#############'],
    player: { x: 3, y: 1 },
    monsters: [{ id: 0, x: 11, y: 1, hp: 5, kind: 'm' }],
  });
  const res2 = step(far, 'wait');
  assert.deepEqual(res2.events, [], 'beyond aggro: idle');
  assert.equal(res2.state.monsters[0].x, 11);
});

test('step: ranged shoots aligned within 5; walls block; it then chases', () => {
  const clear = synth({
    grid: ['#########', '##@...r.#', '#########'],
    player: { x: 2, y: 1 },
    monsters: [{ id: 0, x: 6, y: 1, hp: 3, kind: 'r' }],
  });
  const res = step(clear, 'wait');
  const shot = res.events.find(e => e.type === 'shot');
  assert.ok(shot, 'shot fired');
  assert.ok(shot.detail.dmg >= 1 && shot.detail.dmg <= 3, 'ranged dmg 1-3');
  assert.equal(res.state.player.hp, 20 - shot.detail.dmg);
  assert.equal(res.state.monsters[0].x, 6, 'sniper holds position');

  const blocked = synth({
    grid: ['#########', '##@.#.r.#', '#########'],
    player: { x: 2, y: 1 },
    monsters: [{ id: 0, x: 6, y: 1, hp: 3, kind: 'r' }],
  });
  const res2 = step(blocked, 'wait');
  assert.ok(!res2.events.some(e => e.type === 'shot'), 'wall blocks the shot');
  const mv = res2.events.find(e => e.type === 'monster-move');
  assert.ok(mv, 'falls back to chase');
  assert.equal(res2.state.monsters[0].x, 5);
  assert.ok(!res2.events.some(e => e.type === 'monster-attack'), 'ranged never melees');
});

test('step: pickups are automatic — loot counts, potions heal to cap', () => {
  const state = synth({
    grid: ['#########', '##@$+...#', '#########'],
    player: { x: 2, y: 1, hp: 18 },
    items: [{ id: 0, x: 3, y: 1, kind: '$' }, { id: 1, x: 4, y: 1, kind: '+' }],
  });
  const r1 = step(state, 'right');
  assert.ok(r1.events.some(e => e.type === 'pickup' && e.detail.kind === '$'));
  assert.equal(r1.state.loot, 1);
  assert.equal(r1.state.items.length, 1);
  assert.equal(r1.state.grid[1][3], '@', 'player glyph moved');
  assert.equal(r1.state.grid[1][2], '.', 'under-tile restored');
  const r2 = step(r1.state, 'right');
  assert.ok(r2.events.some(e => e.type === 'pickup' && e.detail.kind === '+'));
  assert.equal(r2.state.player.hp, 20, '18 + 5 capped at maxHp');
  assert.equal(r2.state.items.length, 0);
});

test('step: exit wins; terminal states are no-ops', () => {
  const state = synth({
    grid: ['#########', '##@....>#', '#########'],
    player: { x: 2, y: 1 },
    exit: { x: 7, y: 1 },
  });
  let s = state;
  let res = null;
  for (let i = 0; i < 5; i++) {
    res = step(s, 'right');
    s = res.state;
  }
  assert.equal(s.status, 'won');
  assert.equal(s.grid[1][7], '@');
  assert.ok(res.events.some(e => e.type === 'exit'));
  const before = JSON.stringify(s);
  const noop = step(s, 'up');
  assert.equal(JSON.stringify(noop.state), before);
  assert.deepEqual(noop.events, []);
});

test('step: hp<=0 loses; later monsters skip their turn; no-op after death', () => {
  const state = synth({
    grid: ['#########', '##@.r...#', '#########'],
    player: { x: 2, y: 1, hp: 1 },
    monsters: [
      { id: 0, x: 4, y: 1, hp: 3, kind: 'r' },
      { id: 1, x: 7, y: 1, hp: 5, kind: 'm' },
    ],
  });
  const res = step(state, 'wait');
  assert.ok(res.events.some(e => e.type === 'shot'));
  assert.ok(res.events.some(e => e.type === 'death' && e.detail.cause === 'ranged'));
  assert.equal(res.state.status, 'lost');
  assert.ok(res.state.player.hp <= 0);
  assert.equal(res.state.monsters[1].x, 7, 'monster 1 skipped its turn');
  assert.deepEqual(step(res.state, 'wait').events, []);

  const melee = synth({
    grid: ['#########', '##@m....#', '#########'],
    player: { x: 2, y: 1, hp: 1 },
    monsters: [{ id: 0, x: 3, y: 1, hp: 5, kind: 'm' }],
  });
  const resM = step(melee, 'wait');
  assert.ok(resM.events.some(e => e.type === 'monster-attack'));
  assert.ok(resM.events.some(e => e.type === 'death' && e.detail.cause === 'melee'));
  assert.equal(resM.state.status, 'lost');
});

test('step: turn >= maxTurns times out — exactly maxTurns actions allowed', () => {
  let s = synth({ maxTurns: 3 });
  const r1 = step(s, 'wait'); s = r1.state;
  assert.equal(s.status, 'active');
  assert.equal(s.turn, 1);
  const r2 = step(s, 'wait'); s = r2.state;
  assert.equal(s.status, 'active');
  assert.equal(s.turn, 2);
  const r3 = step(s, 'wait'); s = r3.state;
  assert.equal(s.turn, 3);
  assert.equal(s.status, 'timeout');
  assert.ok(r3.events.some(e => e.type === 'timeout'));
  assert.deepEqual(step(s, 'wait').events, []);
});

// ---------------------------------------------------------------------------
// percepts + score
// ---------------------------------------------------------------------------

test('percepts: window, center, entities, exitSeen, fog, padding', () => {
  const state = synth({
    w: 11, h: 5,
    grid: [
      '###########',
      '#..m......#',
      '#....@$..>#',
      '#.....+..m#',
      '###########',
    ],
    player: { x: 5, y: 2 },
    monsters: [{ id: 0, x: 3, y: 1, hp: 5, kind: 'm' }, { id: 1, x: 9, y: 3, hp: 5, kind: 'm' }],
    items: [{ id: 0, x: 6, y: 2, kind: '$' }, { id: 1, x: 6, y: 3, kind: '+' }],
    exit: { x: 8, y: 2 },
  });
  const p = percepts(state, 3);
  assert.equal(p.local.length, 7);
  for (const row of p.local) assert.equal(row.length, 7);
  assert.equal(p.local[3][3], '@', 'center is the player');
  assert.deepEqual(p.monsters, [{ dx: -2, dy: -1, kind: 'm', hp: 5 }], 'fog cuts at Chebyshev 3');
  assert.deepEqual(p.items, [{ dx: 1, dy: 0, kind: '$' }, { dx: 1, dy: 1, kind: '+' }]);
  assert.deepEqual(p.exitSeen, { dx: 3, dy: 0 });
  assert.equal(p.self.hp, 20);
  assert.equal(p.self.maxHp, 20);
  assert.equal(p.self.x, 5);
  assert.equal(p.self.y, 2);
  assert.equal(p.self.turn, 0);
  assert.equal(p.self.loot, 0);

  // out-of-bounds pads '#'
  const corner = synth({
    w: 11, h: 5,
    player: { x: 1, y: 1 },
  });
  const p2 = percepts(corner, 2);
  assert.equal(p2.local[0][0], '#', 'outside the world reads as wall');
  assert.equal(p2.local[2][2], '@');
});

test('score: exact formula; kills counted from the event log', () => {
  const state = synth({
    loot: 3,
    turn: 17,
    player: { x: 2, y: 1, hp: 11 },
    status: 'won',
    log: [
      { turn: 1, type: 'kill', detail: { target: 0, kind: 'm' } },
      { turn: 2, type: 'kill', detail: { target: 1, kind: 'r' } },
      { turn: 3, type: 'pickup', detail: { id: 0, kind: '$' } },
    ],
  });
  const s = score(state);
  assert.equal(s.loot, 3);
  assert.equal(s.kills, 2);
  assert.equal(s.hpLeft, 11);
  assert.equal(s.turns, 17);
  assert.equal(s.reachedExit, true);
  assert.equal(s.won, true);
  assert.equal(s.score, 3 * 10 + 2 * 25 + 11 * 2 + 200 - 17 * 0.1);
});
