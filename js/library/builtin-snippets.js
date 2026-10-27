/* builtin-snippets.js — built-in functions written in pseudocode, for "Edit a built-in" and the Edit buttons in the Reference tab.
 * Copying one into the Functions tab replaces the built-in with this version. Each must behave like the
 * JavaScript built-in of the same name (tests/test_language.py checks this). Built-ins that are not here
 * are "core": they can still be replaced by a function that calls builtin.name(…).
 * The order here is the order of the menu. */
Library.snippets = {
  /* ---------------------------------------------------------------- Sampling */
  sample: `// A random point anywhere in the workspace (it may be inside an obstacle).
function sample()
  return (random(0, WIDTH), random(0, HEIGHT))
end function
`,

  sample_free: `// Draw random points until one is outside every obstacle.
function sample_free()
  repeat
    q ← (random(0, WIDTH), random(0, HEIGHT))
  until is_free(q)
  return q
end function
`,

  sample_categorical: `// Categorical sampling: pick one item, where item i is chosen
// with probability weights[i] / sum(weights).
function sample_categorical(items, weights)
  total ← sum(weights)
  r ← random() * total
  acc ← 0
  for i ← 1 to length(items) do
    acc ← acc + weights[i]
    if r < acc then
      return items[i]
    end if
  end for
  return items[length(items)]
end function
`,

  sample_goal: `// One of the goal samples (the dots in the goal regions): picked at random,
// or in order when Objects → Goal samples is set to Consecutive.
function sample_goal()
  global goal_turn
  if GOAL_CHOICE = "consecutive" then
    goal_turn ← goal_turn mod length(goal_samples) + 1
    return goal_samples[goal_turn]
  end if
  return goal_samples[floor(random() * length(goal_samples)) + 1]
end function
`,

  sample_in: `// A random point inside goal g (or g itself if it is a point).
function sample_in(g)
  if is_region(g) then
    return (random(g.x0, g.x1), random(g.y0, g.y1))
  end if
  return g
end function
`,

  /* ---------------------------------------------------------------- Informed sampling */
  sample_unit_ball: `// A uniform point in the unit disc (the 2D unit ball). The radius is
// sqrt(u), not u, so the points spread evenly over the area.
function sample_unit_ball()
  r ← sqrt(random())
  t ← 2 * PI * random()
  return (r * cos(t), r * sin(t))
end function
`,

  sample_phs: `// A uniform point in the prolate hyperspheroid (PHS) with foci a and b
// and transverse diameter c: the points x with dist(a, x) + dist(x, b) ≤ c,
// an ellipse in 2D (Gammell, Srinivasa & Barfoot, 2014, Algorithm 2):
//   x = C · L · x_ball + x_centre
// x_ball is a uniform point in the unit ball, L = diag(r1, r2) stretches it
// to the PHS's radii, C turns the PHS's first axis onto the line a → b (in
// 2D a rotation by the angle of b − a), and x_centre is halfway from a to b.
function sample_phs(a, b, c)
  c_min ← dist(a, b)                          // the distance between the foci
  x_centre ← (a + b) / 2
  r1 ← c / 2
  r2 ← sqrt(max(0, c * c - c_min * c_min)) / 2
  theta ← atan2(b.y - a.y, b.x - a.x)
  x_ball ← sample_unit_ball()
  lx ← r1 * x_ball.x                          // L · x_ball
  ly ← r2 * x_ball.y
  return x_centre + (cos(theta) * lx - sin(theta) * ly, sin(theta) * lx + cos(theta) * ly)
end function
`,

  informed_phs: `// The informed set as prolate hyperspheroids (PHSs): a path through x to
// goal g costs at least dist(q_start, x) + dist(x, g), so the points that
// could be on a path cheaper than c_best lie in the PHS with foci q_start
// and g and transverse diameter c_best. One [focus, c, area] per goal that
// can still be reached for less. A goal region uses its centre as the focus,
// with c widened by half its diagonal so the PHS holds the whole region.
// The area of an ellipse is PI * r1 * r2.
function informed_phs(c_best)
  P ← []
  for each g in goals do
    if is_region(g) then
      f ← ((g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2)
      c ← c_best + dist((g.x0, g.y0), (g.x1, g.y1)) / 2
    else
      f ← g
      c ← c_best
    end if
    c_min ← dist(q_start, f)
    if c > c_min then
      append(P, [f, c, PI * (c / 2) * (sqrt(c * c - c_min * c_min) / 2)])
    end if
  end for
  return P
end function
`,

  informed_measure: `// The area of the informed set: the PHSs' areas added up (an upper bound
// where they overlap), at most the workspace's area. BIT* uses it for its
// connection radius.
function informed_measure(c_best)
  if c_best = ∞ then
    return WIDTH * HEIGHT
  end if
  total ← 0
  for each p in informed_phs(c_best) do
    total ← total + p[3]
  end for
  return min(WIDTH * HEIGHT, total)
end function
`,

  sample_informed: `// Informed sampling (Gammell, Srinivasa & Barfoot, 2014; 2018): a uniform
// free point that could be on a path cheaper than c_best. Those points lie
// in the union of the goals' PHSs (informed_phs). To cover the union
// evenly: pick a PHS in proportion to its area, take a uniform point in
// it (sample_phs), and keep a point that lies in k PHSs only 1 time in k.
// The point must also be in the workspace, free, and closer than c_best
// by its real distance to a goal (for a region, not just to its centre).
function sample_informed(c_best)
  if c_best = ∞ then
    return sample_free()
  end if
  P ← informed_phs(c_best)
  if length(P) = 0 then
    return sample_free()        // no goal can be reached for less than c_best
  end if
  total ← 0
  for each p in P do
    total ← total + p[3]
  end for
  for tries ← 1 to 5000 do
    u ← random() * total        // a PHS, in proportion to its area
    i ← 1
    while i < length(P) and u ≥ P[i][3] do
      u ← u - P[i][3]
      i ← i + 1
    end while
    x ← sample_phs(q_start, P[i][1], P[i][2])
    if x.x ≥ 0 and x.x ≤ WIDTH and x.y ≥ 0 and x.y ≤ HEIGHT then
      k ← 0                     // how many PHSs hold x
      for each p in P do
        if dist(q_start, x) + dist(x, p[1]) < p[2] then
          k ← k + 1
        end if
      end for
      if k ≤ 1 or random() * k < 1 then
        if dist(q_start, x) + dist_to_goal(x) < c_best and is_free(x) then
          return x
        end if
      end if
    end if
  end for
  return sample_free()          // the informed set is too small to hit
end function
`,

  /* ---------------------------------------------------------------- Goals */
  in_goal: `// true if q is close to a goal point, or inside a goal region.
function in_goal(q, tol)
  for each g in goals do
    if is_region(g) then
      if q.x ≥ g.x0 and q.x ≤ g.x1 and q.y ≥ g.y0 and q.y ≤ g.y1 then
        return true
      end if
    else if dist(q, g) ≤ tol then
      return true
    end if
  end for
  return false
end function
`,

  dist_to_goal: `// Distance from q to the closest goal point or goal region (0 inside a region).
function dist_to_goal(q)
  best ← ∞
  for each g in goals do
    if is_region(g) then
      dx ← max(g.x0 - q.x, 0, q.x - g.x1)
      dy ← max(g.y0 - q.y, 0, q.y - g.y1)
      d ← sqrt(dx^2 + dy^2)
    else
      d ← dist(q, g)
    end if
    best ← min(best, d)
  end for
  return best
end function
`,

  /* ---------------------------------------------------------------- Geometry */
  dist: `// Straight-line (Euclidean) distance between two points.
function dist(a, b)
  return sqrt((a.x - b.x)^2 + (a.y - b.y)^2)
end function
`,

  steer: `// Move from a toward b, but no further than step.
function steer(a, b, step)
  d ← dist(a, b)
  if d ≤ step then
    return (b.x, b.y)
  end if
  return a + (b - a) * (step / d)
end function
`,

  point: `// A point from two numbers. Writing (x, y) does the same.
function point(x, y)
  return (x, y)
end function
`,

  norm: `// Length of the vector v.
function norm(v)
  return sqrt(v.x^2 + v.y^2)
end function
`,

  /* ---------------------------------------------------------------- Trees and graphs */
  nearest: `// The vertex of T closest to q (a linear scan).
function nearest(T, q)
  best ← null
  best_d ← ∞
  for each v in T do
    d ← dist(v, q)
    if d < best_d then
      best ← v
      best_d ← d
    end if
  end for
  return best
end function
`,

  near: `// All vertices of T within distance r of q.
function near(T, q, r)
  result ← []
  for each v in T do
    if dist(v, q) ≤ r then
      append(result, v)
    end if
  end for
  return result
end function
`,

  k_nearest: `// The k vertices of T closest to q, nearest first.
function k_nearest(T, q, k)
  result ← []
  chosen ← new_set()
  for j ← 1 to k do
    best ← null
    best_d ← ∞
    for each v in T do
      if v ∉ chosen and dist(v, q) < best_d then
        best ← v
        best_d ← dist(v, q)
      end if
    end for
    if best = null then
      return result
    end if
    add(chosen, best)
    append(result, best)
  end for
  return result
end function
`,

  path: `// Walk up the parents from q to the root, then return root → q.
function path(T, q)
  P ← [q]
  while parent(T, q) ≠ null do
    q ← parent(T, q)
    P ← [q] + P
  end while
  return as_path(P)
end function
`,

  cost: `// Length of the tree path from the root to q.
function cost(T, q)
  c ← 0
  while parent(T, q) ≠ null do
    c ← c + dist(q, parent(T, q))
    q ← parent(T, q)
  end while
  return c
end function
`,

  children: `// The vertices of T whose parent is q.
function children(T, q)
  result ← []
  for each v in T do
    if parent(T, v) = q then
      append(result, v)
    end if
  end for
  return result
end function
`,

  subtree: `// q and every vertex below it in tree T (breadth first).
function subtree(T, q)
  result ← [q]
  i ← 1
  while i ≤ length(result) do
    for each c in children(T, result[i]) do
      append(result, c)
    end for
    i ← i + 1
  end while
  return result
end function
`,

  /* ---------------------------------------------------------------- Search */
  shortest_path: `// A* search over graph G from a to b. Returns a path or failure.
function shortest_path(G, a, b)
  g ← new_map(∞)
  came_from ← new_map()
  g[a] ← 0
  open ← new_queue()
  push(open, a, dist(a, b))
  closed ← new_set()
  while not is_empty(open) do
    u ← pop_min(open)
    if u = b then
      P ← [u]
      while u ≠ a do
        u ← came_from[u]
        P ← [u] + P
      end while
      return as_path(P)
    end if
    if u in closed then
      continue
    end if
    add(closed, u)
    for each v in neighbors(G, u) do
      c ← g[u] + dist(u, v)
      if c < g[v] then
        g[v] ← c
        came_from[v] ← u
        push(open, v, c + dist(v, b))
      end if
    end for
  end while
  return failure
end function
`,

  /* ---------------------------------------------------------------- Collections */
  reverse: `// A copy of the list, back to front.
function reverse(L)
  result ← []
  for i ← length(L) downto 1 do
    append(result, L[i])
  end for
  return result
end function
`,

  sum: `// Adds up a list of numbers.
function sum(L)
  total ← 0
  for each x in L do
    total ← total + x
  end for
  return total
end function
`,

  normalize: `// The weights divided by their total, so they add up to 1.
function normalize(weights)
  total ← sum(weights)
  result ← []
  for each w in weights do
    append(result, w / total)
  end for
  return result
end function
`,
};
