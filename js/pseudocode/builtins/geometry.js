/* geometry.js (built-ins) — distances, steering and collision checks. */
(() => {
  'use strict';
  const { Point, edgeKey } = Values;
  const { define, inputs } = Builtins;
  const { distance } = Geometry;

  define('dist', {
    group: 'Geometry', signature: 'dist(a, b)', inputs: 2,
    description: 'Straight-line distance between two points.',
  }, function (a, line) {
    const input = inputs('dist', line);
    return distance(input.point(a[0], 1), input.point(a[1], 2));
  });

  define('steer', {
    group: 'Geometry', signature: 'steer(a, b, step)', inputs: 3,
    description: 'The point at most step away from a, heading toward b.',
  }, function (a, line) {
    const input = inputs('steer', line);
    const from = input.point(a[0], 1), to = input.point(a[1], 2), step = input.number(a[2], 3);
    const d = distance(from, to);
    const result = d <= step ? new Point(to.x, to.y) : new Point(from.x + (to.x - from.x) * step / d, from.y + (to.y - from.y) * step / d);
    this.lastSteer = { from, to };   // the Workspace draws a dashed line toward `to`
    this.lastBlocked = null;
    return result;
  });

  define('collision_free', {
    group: 'Geometry', signature: 'collision_free(a, b)', inputs: 2,
    description: 'true if the straight segment from a to b misses every obstacle. Edges are drawn solid once checked.',
  }, function (a, line) {
    const input = inputs('collision_free', line);
    const p = input.point(a[0], 1), q = input.point(a[1], 2);
    const key = edgeKey(p, q);
    let free = this.collisionCache.get(key);   // the same check twice gives the same answer
    if (free === undefined) {
      free = this.collider.segmentFree(p, q);
      this.collisionCache.set(key, free);
    }
    if (free) this.checkedEdges.add(key);
    this.lastBlocked = free ? null : [p, q];   // drawn as a red dashed segment
    return free;
  });

  define('is_free', {
    group: 'Geometry', signature: 'is_free(q)', inputs: 1,
    description: 'true if q is inside the workspace and outside every obstacle.',
  }, function (a, line) {
    return this.collider.pointFree(inputs('is_free', line).point(a[0], 1));
  });

  define('point', {
    group: 'Geometry', signature: 'point(x, y)', inputs: 2,
    description: 'A new point. Writing (x, y) does the same.',
  }, function (a, line) {
    const input = inputs('point', line);
    return new Point(input.number(a[0], 1), input.number(a[1], 2));
  });

  define('norm', {
    group: 'Geometry', signature: 'norm(v)', inputs: 1,
    description: 'Length of the vector v.',
  }, function (a, line) {
    const v = inputs('norm', line).point(a[0], 1);
    return Math.hypot(v.x, v.y);
  });
})();
