/* rrt-star.js — RRT* (choose the cheapest parent, then rewire neighbours). */
Algorithms.register({
  id: 'star',
  name: 'RRT*',
  group: 'Trees',
  suggestedSpeed: 10000,
  code: `// S. Karaman and E. Frazzoli, “Sampling-based algorithms for optimal motion 
// planning,” The International Journal of Robotics Research, vol. 30, no. 7, 
// pp. 846–894, 2011.

K ← 1200
STEP ← 4
GOAL_BIAS ← 0.05
GOAL_TOL ← 3
R ← 10              // rewiring radius

T ← new_tree(q_start)
best ← failure
for k ← 1 to K do
  if random() < GOAL_BIAS then
    q_rand ← sample_goal()
  else
    q_rand ← sample_free()
  end if
  q_nearest ← nearest(T, q_rand)
  q_new ← steer(q_nearest, q_rand, STEP)
  if collision_free(q_nearest, q_new) then
    Q_near ← near(T, q_new, R)
    // pick the parent that gives the cheapest path
    q_min ← q_nearest
    c_min ← cost(T, q_nearest) + dist(q_nearest, q_new)
    for each q in Q_near do
      c ← cost(T, q) + dist(q, q_new)
      if c < c_min and collision_free(q, q_new) then
        q_min ← q
        c_min ← c
      end if
    end for
    add_vertex(T, q_new)
    add_edge(T, q_min, q_new)
    // reroute neighbours through q_new when that is shorter
    for each q in Q_near do
      if c_min + dist(q_new, q) < cost(T, q) and collision_free(q_new, q) then
        set_parent(T, q, q_new)
      end if
    end for
    if in_goal(q_new, GOAL_TOL) then
      if best = failure or c_min < cost(T, best) then
        best ← q_new
      end if
    end if
    if best ≠ failure then
      P_best ← path(T, best)     // drawn live as the current best path
    end if
  end if
end for
if best = failure then
  return failure
end if
return path(T, best)
`,
});
