/* sampling.js — built-ins that draw random numbers and points, including categorical sampling and informed
 * sampling from the prolate hyperspheroid (PHS). */
(() => {
  'use strict';
  const { Point, PseudoError, isPoint, isRegion } = Values;
  const { define, inputs } = Builtins;
  const { WIDTH, HEIGHT } = World;
  const { distance, distanceToGoal } = Geometry;

  /** A random point outside every obstacle. */
  function sampleFree(runner, line) {
    for (let tries = 0; tries < 20000; tries++) {
      const q = new Point(runner.random() * WIDTH, runner.random() * HEIGHT);
      if (runner.collider.pointFree(q)) return q;
    }
    throw new PseudoError('Could not find any free space to sample. Is the workspace covered by obstacles?', line);
  }

  /** Categorical sampling: item k is picked with probability weights[k] / sum(weights). */
  function pickByWeight(runner, items, weights, fname, line) {
    const input = inputs(fname, line);
    input.list(items); input.list(weights);
    input.require(items.length > 0 && items.length === weights.length, `${fname}() needs two lists of the same, non-zero length.`);
    let total = 0;
    weights.forEach((w, k) => {
      input.number(w, 'weight ' + (k + 1));
      input.require(w >= 0, `${fname}(): weights can't be negative.`);
      total += w;
    });
    input.require(total > 0, `${fname}(): the weights must add up to more than 0.`);
    let r = runner.random() * total;
    for (let k = 0; k < items.length; k++) { r -= weights[k]; if (r < 0) return items[k]; }
    return items[items.length - 1];
  }

  /** A random point inside a goal region, or a copy of a goal point. */
  const randomPointIn = (runner, goal) => (isRegion(goal)
    ? new Point(goal.x0 + runner.random() * (goal.x1 - goal.x0), goal.y0 + runner.random() * (goal.y1 - goal.y0))
    : new Point(goal.x, goal.y));

  define('random', {
    group: 'Sampling', signature: 'random()  ·  random(a, b)', inputs: [0, 2],
    description: 'A random number in [0, 1), or in [a, b).',
  }, function (a, line) {
    const r = this.random();
    if (a.length !== 2) return r;
    const input = inputs('random', line);
    const lo = input.number(a[0], 1), hi = input.number(a[1], 2);
    return lo + r * (hi - lo);
  });

  define('sample', {
    group: 'Sampling', signature: 'sample()', inputs: 0,
    description: 'A random point anywhere in the workspace, even inside obstacles.',
  }, function () {
    return new Point(this.random() * WIDTH, this.random() * HEIGHT);
  });

  define('sample_free', {
    group: 'Sampling', signature: 'sample_free()', inputs: 0,
    description: 'A random point that is outside every obstacle.',
  }, function (a, line) {
    return sampleFree(this, line);
  });

  define('sample_categorical', {
    group: 'Sampling', signature: 'sample_categorical(items, weights)', inputs: 2,
    description: 'Categorical sampling: one item, picked with probability weight / sum(weights). The Functions tab has the same function in pseudocode.',
  }, function (a, line) {
    return pickByWeight(this, a[0], a[1], 'sample_categorical', line);
  });

  define('sample_goal', {
    group: 'Sampling', signature: 'sample_goal()', inputs: 0,
    description: 'One of the goal samples (the dots in the goal regions, also in goal_samples): picked at random, or in order 1, 2, 3, … when Objects → Goal samples is set to Consecutive.',
  }, function (a, line) {
    const samples = this.goalSamples;
    inputs('sample_goal', line).require(samples.length, 'sample_goal() has no goal samples: place q_goal, or a goal region that obstacles do not cover.');
    let pick;
    if (this.goalChoice === 'consecutive') {
      const last = this.globals.get('goal_turn');
      const turn = (Number.isInteger(last) ? last : 0) % samples.length + 1;   // 1, 2, …, n, 1, 2, …
      this.globals.set('goal_turn', turn);
      pick = samples[turn - 1];
    } else {
      pick = samples[Math.floor(this.random() * samples.length)];
    }
    this.lastGoalSample = pick;
    return pick;
  });

  define('sample_in', {
    group: 'Sampling', signature: 'sample_in(g)', inputs: 1,
    description: 'A random point inside goal region g, or g itself if it is a point.',
  }, function (a, line) {
    const g = a[0];
    inputs('sample_in', line).require(isPoint(g) || isRegion(g), `sample_in() needs a point or a goal region, but got ${Values.typeName(g)}.`);
    return isPoint(g) ? g : randomPointIn(this, g);
  });

  /* ---------------------------------------------------------------- informed sampling
   * A path through x costs at least dist(q_start, x) + dist(x, g) to reach goal point g. So the points that could be on
   * a path cheaper than c lie in the prolate hyperspheroid (PHS) { x : dist(q_start, x) + dist(x, g) ≤ c }, an ellipse
   * in 2D with foci q_start and g (Gammell, Srinivasa & Barfoot, 2014). With several goals the informed set is the union
   * of their PHSs (Gammell et al., 2018). Each function here has a pseudocode copy in builtin-snippets.js that draws
   * its random numbers in the same order, so both give the same samples. */

  /** A uniform point in the unit disc. The radius is sqrt(u), so the points spread evenly over the area. */
  function sampleUnitBall(runner) {
    const r = Math.sqrt(runner.random());
    const t = 2 * Math.PI * runner.random();
    return new Point(r * Math.cos(t), r * Math.sin(t));
  }

  /** A uniform point in the PHS with foci a and b and transverse diameter c: x = C · L · x_ball + x_centre. */
  function samplePHS(runner, a, b, c) {
    const cMin = distance(a, b);
    const centre = new Point((a.x + b.x) / 2, (a.y + b.y) / 2);
    const r1 = c / 2, r2 = Math.sqrt(Math.max(0, c * c - cMin * cMin)) / 2;   // L = diag(r1, r2)
    const theta = Math.atan2(b.y - a.y, b.x - a.x);                           // C: a rotation by the angle of b − a
    const ball = sampleUnitBall(runner);
    const lx = r1 * ball.x, ly = r2 * ball.y;
    return new Point(centre.x + (Math.cos(theta) * lx - Math.sin(theta) * ly), centre.y + (Math.sin(theta) * lx + Math.cos(theta) * ly));
  }

  /** The informed set as PHSs, [focus, c, area] for each goal a path cheaper than cBest could still reach. A goal
   *  region gets the PHS with foci q_start and its centre, with c widened by half its diagonal so it holds the region. */
  function informedPHS(runner, cBest) {
    const out = [];
    for (const g of runner.goals) {
      const f = isRegion(g) ? new Point((g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2) : g;
      const c = isRegion(g) ? cBest + distance(new Point(g.x0, g.y0), new Point(g.x1, g.y1)) / 2 : cBest;
      const cMin = distance(runner.start, f);
      if (c > cMin) out.push([f, c, Math.PI * (c / 2) * (Math.sqrt(c * c - cMin * cMin) / 2)]);
    }
    return out;
  }

  define('sample_unit_ball', {
    group: 'Informed sampling', signature: 'sample_unit_ball()', inputs: 0,
    description: 'A uniform point in the unit disc (the 2D unit ball), as a point (x, y).',
  }, function () {
    return sampleUnitBall(this);
  });

  define('sample_phs', {
    group: 'Informed sampling', signature: 'sample_phs(a, b, c)', inputs: 3,
    description: 'A uniform point in the prolate hyperspheroid (PHS) with foci a and b and transverse diameter c: the points x with dist(a, x) + dist(x, b) ≤ c, an ellipse in 2D. x = C · L · x_ball + x_centre, as in Gammell et al. (2014), Algorithm 2.',
  }, function (a, line) {
    const input = inputs('sample_phs', line);
    return samplePHS(this, input.point(a[0], 1), input.point(a[1], 2), input.number(a[2], 3));
  });

  define('informed_phs', {
    group: 'Informed sampling', signature: 'informed_phs(c_best)', inputs: 1,
    description: 'The informed set as prolate hyperspheroids: [focus, c, area] for each goal that a path cheaper than c_best could still reach. The foci are q_start and the goal; c is the transverse diameter. A goal region uses its centre, with c widened by half its diagonal so the PHS holds the region.',
  }, function (a, line) {
    const input = inputs('informed_phs', line);
    const cBest = input.number(a[0], 1);
    input.require(this.start, 'informed_phs() needs q_start.');
    const P = informedPHS(this, cBest);
    this.lastInformed = { c: cBest, phs: P };   // the Workspace draws it, also for your own sample_informed()
    return P;
  });

  define('informed_measure', {
    group: 'Informed sampling', signature: 'informed_measure(c_best)', inputs: 1,
    description: "The area of the informed set: the PHSs' areas added up, at most the workspace's area. The workspace's area while c_best is ∞.",
  }, function (a, line) {
    const input = inputs('informed_measure', line);
    const cBest = input.number(a[0], 1);
    if (!isFinite(cBest)) return WIDTH * HEIGHT;
    input.require(this.start, 'informed_measure() needs q_start.');
    return Math.min(WIDTH * HEIGHT, informedPHS(this, cBest).reduce((total, p) => total + p[2], 0));
  });

  define('sample_informed', {
    group: 'Informed sampling', signature: 'sample_informed(c_best)', inputs: 1,
    description: 'Informed sampling: a uniform free point that could be on a path cheaper than c_best. It samples the PHSs of informed_phs() directly: one picked in proportion to its area, and a point in k of them kept 1 time in k, so the union is covered evenly. Any free point while c_best is ∞.',
  }, function (a, line) {
    const input = inputs('sample_informed', line);
    const cBest = input.number(a[0], 1);
    input.require(this.start, 'sample_informed() needs q_start.');
    if (!isFinite(cBest)) { this.lastInformed = null; return sampleFree(this, line); }
    const s = this.start, P = informedPHS(this, cBest);
    this.lastInformed = { c: cBest, phs: P };        // the Workspace draws each PHS
    if (!P.length) return sampleFree(this, line);   // no goal can be reached for less than c_best
    const total = P.reduce((sum, p) => sum + p[2], 0);
    for (let tries = 0; tries < 5000; tries++) {
      let u = this.random() * total, i = 0;          // a PHS, in proportion to its area
      while (i < P.length - 1 && u >= P[i][2]) { u -= P[i][2]; i++; }
      const x = samplePHS(this, s, P[i][0], P[i][1]);
      if (x.x < 0 || x.x > WIDTH || x.y < 0 || x.y > HEIGHT) continue;
      let k = 0;                                     // how many PHSs hold x
      for (const p of P) if (distance(s, x) + distance(x, p[0]) < p[1]) k++;
      if (k > 1 && this.random() * k >= 1) continue;
      if (distance(s, x) + Math.min(...this.goals.map((g) => distanceToGoal(x, g))) < cBest && this.collider.pointFree(x)) return x;
    }
    return sampleFree(this, line);   // the informed set is too small to hit
  });
})();
