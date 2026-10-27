/* geometry.js — obstacle outlines, collision checks and distances in the workspace. */
const Geometry = (() => {
  'use strict';
  const { SHAPES, WIDTH, HEIGHT } = World;

  /** The corner points of an obstacle in workspace coordinates (scaled, rotated and moved into place). */
  function polygonOf(o) {
    const c = Math.cos(o.a), s = Math.sin(o.a);
    return SHAPES[o.shape].points.map(([px, py]) => {
      const lx = px * o.w, ly = py * o.h;
      return { x: o.x + lx * c - ly * s, y: o.y + lx * s + ly * c };
    });
  }

  /** Ray casting: is point p inside the polygon? */
  function pointInPolygon(p, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i], b = polygon[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  /* ---------- segment intersection ---------- */
  const orientation = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const withinBox = (a, b, p) => Math.min(a.x, b.x) - 1e-9 <= p.x && p.x <= Math.max(a.x, b.x) + 1e-9
    && Math.min(a.y, b.y) - 1e-9 <= p.y && p.y <= Math.max(a.y, b.y) + 1e-9;

  /** Do segments p1–p2 and p3–p4 touch or cross? */
  function segmentsIntersect(p1, p2, p3, p4) {
    const d1 = orientation(p3, p4, p1), d2 = orientation(p3, p4, p2), d3 = orientation(p1, p2, p3), d4 = orientation(p1, p2, p4);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    return (d1 === 0 && withinBox(p3, p4, p1)) || (d2 === 0 && withinBox(p3, p4, p2))
      || (d3 === 0 && withinBox(p1, p2, p3)) || (d4 === 0 && withinBox(p1, p2, p4));
  }

  /* ---------- collision checking ---------- */

  /** A collision checker for a fixed set of obstacles. Bounding boxes are worked out once, for speed. */
  function makeCollider(obstacles) {
    const shapes = obstacles.map((o) => {
      const poly = polygonOf(o);
      const xs = poly.map((q) => q.x), ys = poly.map((q) => q.y);
      return { poly, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    });

    /** Is q inside the workspace and outside every obstacle? */
    function pointFree(q) {
      if (q.x < 0 || q.x > WIDTH || q.y < 0 || q.y > HEIGHT) return false;
      for (const s of shapes) {
        if (q.x < s.x0 || q.x > s.x1 || q.y < s.y0 || q.y > s.y1) continue;
        if (pointInPolygon(q, s.poly)) return false;
      }
      return true;
    }

    /** Does the straight segment a–b miss every obstacle? */
    function segmentFree(a, b) {
      if (!pointFree(a) || !pointFree(b)) return false;
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
      for (const s of shapes) {
        if (x1 < s.x0 || x0 > s.x1 || y1 < s.y0 || y0 > s.y1) continue;
        for (let i = 0; i < s.poly.length; i++) {
          if (segmentsIntersect(a, b, s.poly[i], s.poly[(i + 1) % s.poly.length])) return false;
        }
      }
      return true;
    }

    return { pointFree, segmentFree };
  }

  /* ---------- distances ---------- */
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  /** Distance from q to a goal: a point, or a region { x0, x1, y0, y1 } (0 when q is inside it). */
  function distanceToGoal(q, goal) {
    if (!goal.region) return distance(q, goal);
    const dx = Math.max(goal.x0 - q.x, 0, q.x - goal.x1), dy = Math.max(goal.y0 - q.y, 0, q.y - goal.y1);
    return Math.hypot(dx, dy);
  }

  /** Total length of a list of points. */
  function pathLength(points) {
    let total = 0;
    for (let k = 1; k < points.length; k++) total += distance(points[k - 1], points[k]);
    return total;
  }

  return { polygonOf, pointInPolygon, makeCollider, distance, distanceToGoal, pathLength };
})();
