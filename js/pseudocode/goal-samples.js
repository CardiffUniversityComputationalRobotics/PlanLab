/* goal-samples.js — the goal samples: a few collision-free points in each goal region (a goal point is its own
 * sample). Planners aim at them through sample_goal(), which picks one at random or in order, and RRT
 * reward-penalty starts its heap with them. They use their own random numbers, made from the run's seed,
 * so the Workspace can show exactly the samples a run will use before it starts. */
const GoalSamples = (() => {
  'use strict';
  const { Point } = Values;

  /** The world's goals as the pseudocode sees them: Points, and regions { region: true, x0, x1, y0, y1 }. */
  function goalObjects(world) {
    return world.goals.map((g) => (g.kind === 'region'
      ? { region: true, x0: g.x - g.w / 2, x1: g.x + g.w / 2, y0: g.y - g.h / 2, y1: g.y + g.h / 2 }
      : new Point(g.x, g.y)));
  }

  /** Up to perRegion collision-free samples in each goal region, in goal order. A free goal point is its own sample. */
  function generate(goals, collider, seed, perRegion) {
    const random = Util.seededRandom((seed * 2654435761 + 12345) | 0);   // separate from the run's own random numbers
    const samples = [];
    for (const g of goals) {
      if (!g.region) {
        if (collider.pointFree(g)) samples.push(g);
        continue;
      }
      for (let added = 0, tries = 0; added < perRegion && tries < 50 * perRegion; tries++) {
        const q = new Point(g.x0 + random() * (g.x1 - g.x0), g.y0 + random() * (g.y1 - g.y0));
        if (collider.pointFree(q)) { samples.push(q); added++; }
      }
    }
    return samples;
  }

  /** The samples a run would use with these settings, for showing before a run. Worked out again only when something changed. */
  let cacheKey = null, cache = [];
  function preview(world, seed, perRegion) {
    const key = JSON.stringify([world.goals, world.obstacles, seed, perRegion]);
    if (key !== cacheKey) {
      cacheKey = key;
      cache = generate(goalObjects(world), Geometry.makeCollider(world.obstacles), seed, perRegion);
    }
    return cache;
  }

  return { goalObjects, generate, preview };
})();
