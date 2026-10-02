// survivor — flees any monster within three cells, gathers what is left
// behind, sips potions when hurt, takes the stairs the moment the coast is
// clear. Low on kills, high on still being alive.
//
// Self-contained on purpose: a baseline is meant to be READ in one sitting.
export default function survivor(seed) {
  const ORDER = ['right', 'down', 'left', 'up'];
  const VEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const dirOf = (dx, dy) => (dy < 0 ? 'up' : dy > 0 ? 'down' : dx < 0 ? 'left' : 'right');
  const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

  return {
    name: 'survivor',
    step(percept, memory) {
      const r = (percept.local.length - 1) / 2;
      const cell = (dx, dy) => percept.local[r + dy][r + dx];
      const passable = (dx, dy) => {
        const c = cell(dx, dy);
        return c !== '#' && c !== 'm' && c !== 'r';
      };
      const { x: px, y: py, hp } = percept.self;

      // 1. flee: any monster within Chebyshev 3 — maximize distance to the
      //    nearest of them, ties broken in fixed up/right/down/left order.
      const danger = percept.monsters.filter(m => cheb(px + m.dx, py + m.dy, px, py) <= 3);
      if (danger.length > 0) {
        let best = null;
        for (const d of ORDER) {
          const [dx, dy] = VEC[d];
          if (!passable(dx, dy)) continue;
          let nearest = Infinity;
          for (const m of danger) {
            nearest = Math.min(nearest, cheb(px + dx + m.dx, py + dy + m.dy, px, py));
          }
          if (!best || nearest > best.nearest) best = { d, nearest };
        }
        if (best) {
          return { action: best.d, thought: `${danger.length} too close, fleeing ${best.d}` };
        }
      }

      // 2. gather: potion when hurt, else nearest item, else the stairs.
      let target = null;
      let why = '';
      if (hp <= 10) {
        const potion = percept.items.find(it => it.kind === '+');
        if (potion) {
          target = potion;
          why = `hurt (${hp}hp), potion at (${potion.dx},${potion.dy})`;
        }
      }
      if (!target) {
        let best = null;
        for (const it of percept.items) {
          const d = Math.abs(it.dx) + Math.abs(it.dy);
          if (!best || d < best.d) best = { ...it, d };
        }
        if (best) {
          target = best;
          why = `${best.kind} at (${best.dx},${best.dy})`;
        } else if (percept.exitSeen && danger.length === 0) {
          target = percept.exitSeen;
          why = 'coast clear, taking the stairs';
        }
      }

      if (target) {
        const horizontal = [Math.sign(target.dx), 0];
        const vertical = [0, Math.sign(target.dy)];
        const order = Math.abs(target.dx) >= Math.abs(target.dy) ? [horizontal, vertical] : [vertical, horizontal];
        for (const [dx, dy] of order) {
          if ((dx !== 0 || dy !== 0) && passable(dx, dy)) {
            return { action: dirOf(dx, dy), thought: why };
          }
        }
      }

      // 3. wander: right hand on the wall
      if (!memory.dir) memory.dir = 'right';
      const start = ORDER.indexOf(memory.dir);
      for (let i = 0; i < 4; i++) {
        const d = ORDER[(start + i) % 4];
        const [dx, dy] = VEC[d];
        if (passable(dx, dy)) {
          memory.dir = d;
          return { action: d, thought: `quiet patch, wandering ${d}` };
        }
      }
      return { action: 'wait', thought: 'walled in, waiting it out' };
    },
  };
}
