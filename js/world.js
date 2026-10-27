/* world.js — the workspace model: what the user has placed, the obstacle shapes and the ready-made layouts.
 *
 * A world is plain data, so it can be saved as JSON:
 *   {
 *     start:     { x, y } or null,
 *     goals:     [ { id, kind: 'point', x, y, weight } or { id, kind: 'region', x, y, w, h, weight } ],
 *     obstacles: [ { id, shape, x, y, w, h, a } ],
 *   }
 * x, y is the centre, w × h the size and a the rotation in radians.
 * Coordinates are workspace units in [0, WIDTH] × [0, HEIGHT], with y pointing up.
 */
const World = (() => {
  'use strict';

  const WIDTH = 100, HEIGHT = 100;

  /* ---------- obstacle shapes ----------
   * points: the outline in a unit box centred on (0, 0); it is scaled to w × h.
   * w, h:   the size a new obstacle gets. */
  const unitSquare = [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]];
  const unitCircle = Array.from({ length: 32 }, (_, i) => [Math.cos(i / 32 * 2 * Math.PI) / 2, Math.sin(i / 32 * 2 * Math.PI) / 2]);
  const SHAPES = {
    rect:   { name: 'Block',    points: unitSquare, w: 20, h: 14 },
    circle: { name: 'Circle',   points: unitCircle, w: 14, h: 14 },
    tri:    { name: 'Triangle', points: [[-.5, -.5], [.5, -.5], [0, .5]], w: 18, h: 15 },
    ell:    { name: 'L-shape',  points: [[-.5, -.5], [.5, -.5], [.5, -.2], [-.2, -.2], [-.2, .5], [-.5, .5]], w: 22, h: 22 },
    trap:   { name: 'U-trap',   points: [[-.5, -.5], [.5, -.5], [.5, .5], [.36, .5], [.36, -.36], [-.36, -.36], [-.36, .5], [-.5, .5]], w: 28, h: 28 },
    wall:   { name: 'Wall',     points: unitSquare, w: 40, h: 3 },
  };

  /* ---------- making objects ---------- */
  let nextId = 1;

  function makeObstacle({ shape, x, y, w, h, a }) {
    return { id: nextId++, shape, x, y, w: w ?? SHAPES[shape].w, h: h ?? SHAPES[shape].h, a: a || 0 };
  }

  function makeGoal(g) {
    return g.kind === 'region'
      ? { id: nextId++, kind: 'region', x: g.x, y: g.y, w: g.w ?? 20, h: g.h ?? 20, weight: g.weight ?? 1 }
      : { id: nextId++, kind: 'point', x: g.x, y: g.y, weight: g.weight ?? 1 };
  }

  /* ---------- layouts (the "Load layout…" menu) ---------- */
  const LAYOUTS = {
    blocks: {
      name: 'Four blocks',
      start: { x: 10, y: 10 },
      goals: [{ kind: 'point', x: 90, y: 90 }],
      obstacles: [
        { shape: 'rect', x: 28, y: 30, w: 22, h: 16 }, { shape: 'rect', x: 72, y: 26, w: 16, h: 26 },
        { shape: 'rect', x: 30, y: 72, w: 16, h: 24 }, { shape: 'rect', x: 68, y: 70, w: 24, h: 14 },
      ],
    },
    passage: {
      name: 'Narrow passage',
      start: { x: 14, y: 50 },
      goals: [{ kind: 'point', x: 86, y: 50 }],
      obstacles: [{ shape: 'wall', x: 50, y: 23, w: 4, h: 46 }, { shape: 'wall', x: 50, y: 77, w: 4, h: 46 }],
    },
    trap: {
      name: 'Bug trap',
      start: { x: 58, y: 50 },
      goals: [{ kind: 'point', x: 90, y: 50 }],
      obstacles: [{ shape: 'trap', x: 55, y: 50, w: 34, h: 34, a: Math.PI / 2 }],
    },
    maze: {
      name: 'Zig-zag (goal region)',
      start: { x: 8, y: 8 },
      goals: [{ kind: 'region', x: 88, y: 88, w: 18, h: 18 }],
      obstacles: [{ shape: 'wall', x: 35, y: 33, w: 70, h: 3 }, { shape: 'wall', x: 65, y: 66, w: 70, h: 3 }],
    },
    regions: {
      // Like Fig. 3 of Hernández et al. (2019): the first goal region is walled in (valid samples, but
      // unreachable), the second is behind a narrow gap, the third is easy. In that order on purpose:
      // trying goal samples in order starts with the unreachable ones.
      name: 'Three goal regions (easy, hard, unreachable)',
      start: { x: 50, y: 6 },
      goals: [
        { kind: 'region', x: 84, y: 82, w: 12, h: 12 },
        { kind: 'region', x: 50, y: 88, w: 12, h: 10 },
        { kind: 'region', x: 16, y: 84, w: 16, h: 14 },
      ],
      obstacles: [
        // box around the first region
        { shape: 'wall', x: 84, y: 74, w: 19, h: 3 }, { shape: 'wall', x: 84, y: 90, w: 19, h: 3 },
        { shape: 'wall', x: 75.5, y: 82, w: 3, h: 19 }, { shape: 'wall', x: 92.5, y: 82, w: 3, h: 19 },
        // pocket around the second region, open only through a 4-wide gap at the bottom
        { shape: 'wall', x: 40, y: 86, w: 3, h: 28 }, { shape: 'wall', x: 60, y: 86, w: 3, h: 28 },
        { shape: 'wall', x: 43.5, y: 72, w: 9, h: 3 }, { shape: 'wall', x: 56.5, y: 72, w: 9, h: 3 },
        // something in the way
        { shape: 'rect', x: 30, y: 42, w: 26, h: 8 }, { shape: 'rect', x: 72, y: 48, w: 22, h: 8 },
      ],
    },
    weighted: {
      name: 'Two weighted goals',
      start: { x: 10, y: 50 },
      goals: [{ kind: 'point', x: 90, y: 86, weight: 1 }, { kind: 'region', x: 86, y: 16, w: 18, h: 18, weight: 3 }],
      obstacles: [
        { shape: 'wall', x: 48, y: 50, w: 4, h: 60 }, { shape: 'rect', x: 72, y: 50, w: 18, h: 14 },
        { shape: 'circle', x: 28, y: 80, w: 14, h: 14 },
      ],
    },
  };

  /** A new world from plain data (a layout, saved data or a snapshot). Objects get fresh ids; unknown entries are dropped. */
  function build(data) {
    return {
      start: data.start ? { x: data.start.x, y: data.start.y } : null,
      goals: (data.goals || []).filter((g) => g && (g.kind === 'point' || g.kind === 'region')).map(makeGoal),
      obstacles: (data.obstacles || []).filter((o) => o && Object.hasOwn(SHAPES, o.shape)).map(makeObstacle),
    };
  }

  const fromLayout = (key) => build(LAYOUTS[key]);

  /** A deep copy, used for Undo. */
  const snapshot = (world) => JSON.parse(JSON.stringify(world));

  return { WIDTH, HEIGHT, SHAPES, LAYOUTS, makeObstacle, makeGoal, build, fromLayout, snapshot };
})();
