/* goals.js — built-ins about the goals placed in the workspace. */
(() => {
  'use strict';
  const { isRegion } = Values;
  const { define, inputs } = Builtins;
  const { distance, distanceToGoal } = Geometry;

  define('in_goal', {
    group: 'Goals', signature: 'in_goal(q, tol)', inputs: [1, 2],
    description: 'true if q is within tol of a goal point, or inside a goal region.',
  }, function (a, line) {
    const input = inputs('in_goal', line);
    const q = input.point(a[0], 1), tol = a.length > 1 ? input.number(a[1], 2) : 2;
    input.require(this.goals.length, 'in_goal() needs q_goal or a goal region in the workspace.');
    return this.goals.some((g) => (isRegion(g)
      ? q.x >= g.x0 && q.x <= g.x1 && q.y >= g.y0 && q.y <= g.y1
      : distance(q, g) <= tol));
  });

  define('dist_to_goal', {
    group: 'Goals', signature: 'dist_to_goal(q)', inputs: 1,
    description: 'Straight-line distance from q to the closest goal point or region. A cost-to-go estimate that never overestimates.',
  }, function (a, line) {
    const input = inputs('dist_to_goal', line);
    const q = input.point(a[0], 1);
    input.require(this.goals.length, 'dist_to_goal() needs a goal in the workspace.');
    return Math.min(...this.goals.map((g) => distanceToGoal(q, g)));
  });

  define('is_region', {
    group: 'Goals', signature: 'is_region(g)', inputs: 1,
    description: 'true if g is a goal region (it has fields x0, x1, y0, y1).',
  }, function (a) {
    return isRegion(a[0]);
  });
})();
