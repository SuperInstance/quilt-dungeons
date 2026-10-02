// greedy-loot — walks to the nearest thing that shines, takes the stairs when
// they show themselves, wall-hugs otherwise. Never picks a fight; pays the
// baseline tax whenever a monster is standing between it and the shiny.
//
// Self-contained on purpose: a baseline is meant to be READ in one sitting.
export default function greedyLoot(seed) {
  const ORDER = ['right', 'down', 'left', 'up'];
  const VEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const dirOf = (dx, dy) => (dy < 0 ? 'up' : dy > 0 ? 'down' : dx < 0 ? 'left' : 'right');

  return {
    name: 'greedy-loot',
    step(percept, memory) {
      const r = (percept.local.length - 1) / 2;
      const cell = (dx, dy) => percept.local[r + dy][r + dx];
      const passable = (dx, dy) => {
        const c = cell(dx, dy);
        return c !== '#' && c !== 'm' && c !== 'r';
      };

      // 1. nearest visible item, Manhattan distance
      let best = null;
      for (const it of percept.items) {
        const d = Math.abs(it.dx) + Math.abs(it.dy);
        if (!best || d < best.d) best = { ...it, d };
      }
      let target = null;
      let why = '';
      if (best) {
        target = best;
        why = `${best.kind} at (${best.dx},${best.dy})`;
      } else if (percept.exitSeen) {
        target = percept.exitSeen;
        why = 'stairs seen, thread done';
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

      // 2. wander: right hand on the wall
      if (!memory.dir) memory.dir = 'right';
      const start = ORDER.indexOf(memory.dir);
      for (let i = 0; i < 4; i++) {
        const d = ORDER[(start + i) % 4];
        const [dx, dy] = VEC[d];
        if (passable(dx, dy)) {
          memory.dir = d;
          return { action: d, thought: `no thread in reach, wandering ${d}` };
        }
      }
      return { action: 'wait', thought: 'walled in, waiting it out' };
    },
  };
}
