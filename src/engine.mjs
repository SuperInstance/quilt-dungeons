// quilt-dungeons engine — the dungeon is a quilt; this file is the relational
// understanding between its cells. CONTRACT v1.0.0: docs/CONTRACT.md
// Node >= 20, ESM, stdlib only, zero dependencies. Pure: no clocks, no I/O.

export const GLYPHS = { wall: '#', floor: '.', player: '@', melee: 'm', ranged: 'r', loot: '$', potion: '+', exit: '>' };

// ---------------------------------------------------------------------------
// RNG — mulberry32, the platonic-randomness convention (CONTRACT §2)
// ---------------------------------------------------------------------------

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The engine's resumable form: same sequence, but the uint32 cursor (`rng.a`)
// is stored into state.rngState after every step so any state can be resumed
// byte-exactly.
export function makeRng(state) {
  const rng = {
    a: state >>> 0,
    next() {
      rng.a = (rng.a + 0x6D2B79F5) | 0;
      let t = rng.a;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(n) { return Math.floor(rng.next() * n); },
    roll(lo, hi) { return lo + Math.floor(rng.next() * (hi - lo + 1)); },
    chance(p) { return rng.next() < p; },
  };
  return rng;
}

// ---------------------------------------------------------------------------
// grid helpers (grid rows are strings; the grid is the full quilt render:
// terrain + items + entities, with under-tiles restored on every move)
// ---------------------------------------------------------------------------

function setCell(s, x, y, ch) {
  s.grid[y] = s.grid[y].slice(0, x) + ch + s.grid[y].slice(x + 1);
}

function cellAt(s, x, y) {
  return (x >= 0 && x < s.w && y >= 0 && y < s.h) ? s.grid[y][x] : '#';
}

function monsterAt(s, x, y) {
  for (const m of s.monsters) if (m.x === x && m.y === y) return m;
  return null;
}

function itemAt(s, x, y) {
  for (const i of s.items) if (i.x === x && i.y === y) return i;
  return null;
}

function cheb(ax, ay, bx, by) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

// What shows when an entity leaves (x, y): an item's glyph, the exit stairs,
// otherwise bare floor.
function restore(s, x, y) {
  const it = itemAt(s, x, y);
  if (it) setCell(s, x, y, it.kind);
  else if (s.exit.x === x && s.exit.y === y) setCell(s, x, y, '>');
  else setCell(s, x, y, '.');
}

// Wall-free line between two aligned points, exclusive of both ends.
function clearLine(s, x0, y0, x1, y1) {
  const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
  let x = x0 + dx, y = y0 + dy;
  while (x !== x1 || y !== y1) {
    if (cellAt(s, x, y) === '#') return false;
    x += dx; y += dy;
  }
  return true;
}

// ---------------------------------------------------------------------------
// createGame (CONTRACT §4)
// ---------------------------------------------------------------------------

export function createGame(seed, opts = {}) {
  const w = opts.w ?? 48;
  const h = opts.h ?? 24;
  const nMonsters = opts.monsters ?? 8;
  const nLoot = opts.loot ?? 10;
  const nPotions = opts.potions ?? 3;
  const maxTurns = opts.maxTurns ?? 200;
  const rng = makeRng(seed);

  const s = {
    seed,
    turn: 0,
    w, h,
    grid: Array.from({ length: h }, () => '#'.repeat(w)),
    player: { x: 0, y: 0, hp: 20, maxHp: 20 },
    monsters: [],
    items: [],
    log: [],
    rngState: 0,
    status: 'active',
    maxTurns,
    loot: 0,
    exit: { x: 0, y: 0 },
  };

  const carve = (x, y) => { if (x > 0 && x < w - 1 && y > 0 && y < h - 1) setCell(s, x, y, '.'); };

  // BSP: split the interior until small/deep, one room per leaf.
  const leaves = [];
  (function split(x0, y0, x1, y1, depth) {
    const rw = x1 - x0 + 1, rh = y1 - y0 + 1;
    const canV = rw >= 12, canH = rh >= 8;
    if (depth >= 4 || (!canV && !canH)) { leaves.push([x0, y0, x1, y1]); return; }
    const vertical = canV && canH ? rw >= rh : canV;
    if (vertical) {
      const cut = x0 + 4 + rng.int(rw - 8);
      split(x0, y0, cut, y1, depth + 1);
      split(cut + 1, y0, x1, y1, depth + 1);
    } else {
      const cut = y0 + 3 + rng.int(rh - 7);
      split(x0, y0, x1, cut, depth + 1);
      split(x0, cut + 1, x1, y1, depth + 1);
    }
  })(1, 1, w - 2, h - 2, 0);

  const rooms = [];
  for (const [x0, y0, x1, y1] of leaves) {
    const rw = x1 - x0 + 1, rh = y1 - y0 + 1;
    const rwid = 3 + rng.int(rw - 4);
    const rhgt = 2 + rng.int(rh - 3);
    const rx = x0 + 1 + rng.int(rw - rwid - 1);
    const ry = y0 + 1 + rng.int(rh - rhgt - 1);
    for (let y = ry; y < ry + rhgt; y++) for (let x = rx; x < rx + rwid; x++) carve(x, y);
    rooms.push({ cx: rx + (rwid >> 1), cy: ry + (rhgt >> 1) });
  }

  // Corridors: chain each room to the next, horizontal-first L.
  for (let i = 1; i < rooms.length; i++) {
    const a = rooms[i - 1], b = rooms[i];
    for (let x = Math.min(a.cx, b.cx); x <= Math.max(a.cx, b.cx); x++) carve(x, a.cy);
    for (let y = Math.min(a.cy, b.cy); y <= Math.max(a.cy, b.cy); y++) carve(b.cx, y);
  }

  // Spawns: player at first room's center, exit at last room's center.
  s.player.x = rooms[0].cx;
  s.player.y = rooms[0].cy;
  const last = rooms[rooms.length - 1];
  s.exit = { x: last.cx, y: last.cy };
  if (s.exit.x === s.player.x && s.exit.y === s.player.y) {
    // degenerate single-room map: fall back to the scan-last floor tile
    for (let y = h - 2; y >= 1 && (s.exit.x === s.player.x && s.exit.y === s.player.y); y--) {
      for (let x = w - 2; x >= 1; x--) {
        if (s.grid[y][x] === '.' && !(x === s.player.x && y === s.player.y)) { s.exit = { x, y }; break; }
      }
    }
  }
  setCell(s, s.exit.x, s.exit.y, '>');
  setCell(s, s.player.x, s.player.y, '@');

  // Free-cell placement: seeded rejection sampling over distinct floor tiles.
  const floorCells = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (s.grid[y][x] === '.') floorCells.push([x, y]);
  const occupied = new Set([`${s.player.x},${s.player.y}`, `${s.exit.x},${s.exit.y}`]);
  const taken = [];
  const total = nMonsters + nLoot + nPotions;
  let guard = 0;
  while (taken.length < total && guard++ < 100000) {
    const c = floorCells[rng.int(floorCells.length)];
    const k = `${c[0]},${c[1]}`;
    if (occupied.has(k)) continue;
    occupied.add(k);
    taken.push(c);
  }
  if (taken.length < total) throw new Error(`map too small for ${total} entities`);

  for (let i = 0; i < nMonsters; i++) {
    const [x, y] = taken[i];
    // ranged only in the last half of the draw order (CONTRACT §4)
    const kind = (i >= (nMonsters >> 1) && rng.chance(0.3)) ? 'r' : 'm';
    s.monsters.push({ id: i, x, y, hp: kind === 'm' ? 5 : 3, kind });
    setCell(s, x, y, kind);
  }
  for (let i = 0; i < nLoot + nPotions; i++) {
    const [x, y] = taken[nMonsters + i];
    const kind = i < nLoot ? '$' : '+';
    s.items.push({ id: i, x, y, kind });
    setCell(s, x, y, kind);
  }

  s.rngState = rng.a >>> 0;
  return s;
}

// ---------------------------------------------------------------------------
// step (CONTRACT §5) — one player action, then the monsters answer
// ---------------------------------------------------------------------------

export const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0], wait: [0, 0] };

export function step(state, action) {
  const s = structuredClone(state);
  if (s.status !== 'active') return { state: s, events: [] };
  const events = [];
  const push = (type, detail) => { events.push({ type, detail }); s.log.push({ turn: s.turn, type, detail }); };

  s.turn += 1;
  const rng = makeRng(s.rngState);
  const p = s.player;

  if (action == null || !Object.hasOwn(DIRS, action)) push('invalid-action', { action: action ?? null });
  const [dx, dy] = DIRS[action] ?? DIRS.wait;

  // ---- player turn --------------------------------------------------------
  if (dx !== 0 || dy !== 0) {
    const nx = p.x + dx, ny = p.y + dy;
    const foe = monsterAt(s, nx, ny);
    if (cellAt(s, nx, ny) === '#') {
      push('bump', { x: nx, y: ny });
    } else if (foe) {
      // bump = attack: the law holds for both parties
      const dmg = rng.roll(2, 5);
      foe.hp -= dmg;
      push('attack', { target: foe.id, kind: foe.kind, dmg, hp: foe.hp });
      if (foe.hp <= 0) {
        s.monsters = s.monsters.filter(m => m !== foe);
        restore(s, nx, ny);
        push('kill', { target: foe.id, kind: foe.kind });
      }
    } else {
      const fromX = p.x, fromY = p.y;
      const item = itemAt(s, nx, ny);
      restore(s, fromX, fromY);
      p.x = nx; p.y = ny;
      if (item) {
        s.items = s.items.filter(i => i !== item);
        if (item.kind === '$') {
          s.loot += 1;
          push('pickup', { id: item.id, kind: '$', loot: s.loot });
        } else {
          p.hp = Math.min(p.maxHp, p.hp + 5);
          push('pickup', { id: item.id, kind: '+', hp: p.hp });
        }
      }
      setCell(s, nx, ny, '@');
      if (s.exit.x === nx && s.exit.y === ny) {
        push('exit', { x: nx, y: ny });
        s.status = 'won';
      } else {
        push('move', { from: [fromX, fromY], to: [nx, ny] });
      }
    }
  }

  // ---- monster turns (ascending id; skipped once the game is over) --------
  if (s.status === 'active') {
    for (const m of s.monsters) {
      if (s.status !== 'active') break;
      const ddx = p.x - m.x, ddy = p.y - m.y;
      const dist = Math.max(Math.abs(ddx), Math.abs(ddy));

      // ranged: shoot if aligned, close, and nothing but air between
      if (m.kind === 'r' && (ddx === 0 || ddy === 0) && dist >= 1 && dist <= 5 && clearLine(s, m.x, m.y, p.x, p.y)) {
        const dmg = rng.roll(1, 3);
        p.hp -= dmg;
        push('shot', { id: m.id, dmg, hp: p.hp });
        if (p.hp <= 0) { push('death', { cause: 'ranged', by: m.id }); s.status = 'lost'; }
        continue;
      }

      // greedy cardinal chase (no pathfinding), aggro Chebyshev 6
      if (dist > 6) continue;
      const horizontal = [Math.sign(ddx), 0];
      const vertical = [0, Math.sign(ddy)];
      const order = Math.abs(ddx) >= Math.abs(ddy) ? [horizontal, vertical] : [vertical, horizontal];
      for (const [sx, sy] of order) {
        if (sx === 0 && sy === 0) continue;
        const tx = m.x + sx, ty = m.y + sy;
        if (cellAt(s, tx, ty) === '#') continue;
        if (tx === p.x && ty === p.y) {
          if (m.kind === 'm') {
            const dmg = rng.roll(2, 4);
            p.hp -= dmg;
            push('monster-attack', { id: m.id, dmg, hp: p.hp });
            if (p.hp <= 0) { push('death', { cause: 'melee', by: m.id }); s.status = 'lost'; }
          }
          break; // melee attacked in place; ranged just holds — snipers don't punch
        }
        if (monsterAt(s, tx, ty)) continue;
        const fromX = m.x, fromY = m.y;
        restore(s, m.x, m.y);
        m.x = tx; m.y = ty;
        setCell(s, tx, ty, m.kind);
        push('monster-move', { id: m.id, from: [fromX, fromY], to: [tx, ty] });
        break;
      }
    }
  }

  // ---- end of step --------------------------------------------------------
  if (s.status === 'active' && s.turn >= s.maxTurns) {
    push('timeout', { turn: s.turn });
    s.status = 'timeout';
  }
  s.rngState = rng.a >>> 0;
  return { state: s, events };
}

// ---------------------------------------------------------------------------
// percepts (CONTRACT §6) — the patch under the lamp
// ---------------------------------------------------------------------------

export function percepts(state, radius = 4) {
  const r = radius;
  const { x, y, hp, maxHp } = state.player;
  const local = [];
  for (let wy = y - r; wy <= y + r; wy++) {
    let row = '';
    for (let wx = x - r; wx <= x + r; wx++) {
      row += (wy >= 0 && wy < state.h && wx >= 0 && wx < state.w) ? state.grid[wy][wx] : '#';
    }
    local.push(row);
  }
  local[r] = local[r].slice(0, r) + '@' + local[r].slice(r + 1); // the center is always the player
  const within = (px, py) => Math.max(Math.abs(px - x), Math.abs(py - y)) <= r;
  const monsters = state.monsters
    .filter(m => within(m.x, m.y))
    .map(m => ({ dx: m.x - x, dy: m.y - y, kind: m.kind, hp: m.hp }));
  const items = state.items
    .filter(i => within(i.x, i.y))
    .map(i => ({ dx: i.x - x, dy: i.y - y, kind: i.kind }));
  let exitSeen = null;
  if (state.exit && within(state.exit.x, state.exit.y)) {
    exitSeen = { dx: state.exit.x - x, dy: state.exit.y - y };
  }
  return {
    self: { hp, maxHp, x, y, turn: state.turn, loot: state.loot },
    local,
    monsters,
    items,
    exitSeen,
  };
}

// ---------------------------------------------------------------------------
// legalActions / isLegalAction (CONTRACT §6.5, additive since v1.1.0) — the
// typed legality mask. THE MASK LAW: the mask is OFFERED, never enforced —
// the engine's `step` behavior is unchanged, existing scripts ignore it and
// byte-reproduce. A script with no memory of walls can ask the percept's
// local window which actions are legal. Pure, RNG-free.
//
// Accepts either shape (duck-typed):
//   * a percept  ({local: (2r+1) rows, '@' at center})  — the script-facing API;
//     out-of-bounds padding is '#', so fog edges are already walls here.
//   * a state    ({grid, player:{x,y}})                 — the engine-facing API.
// A cardinal action is legal iff its target cell is NOT '#'. Walls and the
// world's edge are illegal (they would emit `bump`); a monster cell IS legal
// (bump = attack, CONTRACT §5); `wait` is always legal. The mask is returned
// in ACTIONS order: ['up','down','left','right','wait'].
// ---------------------------------------------------------------------------

export function legalActions(p) {
  let cell, cx, cy;
  if (p && Array.isArray(p.local)) {
    const rows = p.local;
    const r = (rows.length - 1) / 2; // window radius; center is always the player
    if (!Number.isInteger(r) || r < 1 || rows[r] == null || rows[r].length !== rows.length) {
      throw new TypeError('legalActions: percept.local must be (2r+1) square rows with the player at center');
    }
    cx = r; cy = r;
    cell = (x, y) => (y >= 0 && y < rows.length && x >= 0 && x < rows[y].length) ? rows[y][x] : '#';
  } else if (p && Array.isArray(p.grid) && p.player) {
    cx = p.player.x; cy = p.player.y;
    cell = (x, y) => (y >= 0 && y < p.grid.length && x >= 0 && x < p.grid[y].length) ? p.grid[y][x] : '#';
  } else {
    throw new TypeError('legalActions: pass a percept ({local}) or a state ({grid, player})');
  }
  return Object.keys(DIRS).filter(a => {
    if (a === 'wait') return true; // staying never bumps
    const [dx, dy] = DIRS[a];
    return cell(cx + dx, cy + dy) !== '#';
  });
}

export function isLegalAction(action, p) {
  return legalActions(p).includes(action);
}

// ---------------------------------------------------------------------------
// score (CONTRACT §7)
// ---------------------------------------------------------------------------

export function score(state) {
  const kills = state.log.filter(e => e.type === 'kill').length;
  const won = state.status === 'won';
  return {
    loot: state.loot,
    kills,
    hpLeft: state.player.hp,
    turns: state.turn,
    reachedExit: won,
    won,
    score: state.loot * 10 + kills * 25 + state.player.hp * 2 + (won ? 200 : 0) - state.turn * 0.1,
  };
}
