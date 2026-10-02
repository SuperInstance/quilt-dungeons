// hunter — sees a monster, walks into it (bump = attack; the law holds for
// everyone), loots on the way, sips when hurt, takes the stairs once the
// visible field goes quiet. The relational understanding it stitches:
// distance is just damage that has not been dealt yet.
//
// Self-contained on purpose: a baseline is meant to be READ in one sitting.
export default function hunter(seed) {
  const ORDER = ['right', 'down', 'left', 'up'];
  const VEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const dirOf = (dx, dy) => (dy < 0 ? 'up' : dy > 0 ? 'down' : dx < 0 ? 'left' : 'right');

  return {
    name: 'hunter',
    step(percept, memory) {
      const r = (percept.local.length - 1) / 2;
      const cell = (dx, dy) => percept.local[r + dy][r + dx];
      const walkable = (dx, dy) => cell(dx, dy) !== '#'; // monsters are targets, not obstacles

      // 1. engage: nearest visible monster, Manhattan distance
      let best = null;
      for (const m of percept.monsters) {
        const d = Math.abs(m.dx) + Math.abs(m.dy);
        if (!best || d < best.d) best = { ...m, d };
      }
      let target = null;
      let why = '';
      if (best) {
        target = best;
        why = `engaging ${best.kind} at (${best.dx},${best.dy})`;
      } else {
        // 2. potion when hurt
        if (percept.self.hp <= 8) {
          const potion = percept.items.find(it => it.kind === '+');
          if (potion) {
            target = potion;
            why = `hurt (${percept.self.hp}hp), potion at (${potion.dx},${potion.dy})`;
          }
        }
        // 3. loot, then the stairs
        if (!target) {
          let nearestItem = null;
          for (const it of percept.items) {
            const d = Math.abs(it.dx) + Math.abs(it.dy);
            if (!nearestItem || d < nearestItem.d) nearestItem = { ...it, d };
          }
          if (nearestItem) {
            target = nearestItem;
            why = `${nearestItem.kind} at (${nearestItem.dx},${nearestItem.dy})`;
          } else if (percept.exitSeen) {
            target = percept.exitSeen;
            why = 'field quiet, taking the stairs';
          }
        }
      }

      if (target) {
        const horizontal = [Math.sign(target.dx), 0];
        const vertical = [0, Math.sign(target.dy)];
        const order = Math.abs(target.dx) >= Math.abs(target.dy) ? [horizontal, vertical] : [vertical, horizontal];
        for (const [dx, dy] of order) {
          if ((dx !== 0 || dy !== 0) && walkable(dx, dy)) {
            return { action: dirOf(dx, dy), thought: why };
          }
        }
      }

      // 4. wander: right hand on the wall
      if (!memory.dir) memory.dir = 'right';
      const start = ORDER.indexOf(memory.dir);
      for (let i = 0; i < 4; i++) {
        const d = ORDER[(start + i) % 4];
        const [dx, dy] = VEC[d];
        if (walkable(dx, dy)) {
          memory.dir = d;
          return { action: d, thought: `nothing in sight, hunting ${d}` };
        }
      }
      return { action: 'wait', thought: 'walled in, waiting it out' };
    },
  };
}
