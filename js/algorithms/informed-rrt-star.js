/* informed-rrt-star.js — RRT* that samples only the informed ellipse once it has a path. */
Algorithms.register({
  id: 'informed',
  name: 'Informed RRT*',
  group: 'Trees',
  suggestedSpeed: 10000,
  code: `// J. D. Gammell, S. S. Srinivasa, and T. D. Barfoot, “Informed RRT*: 
// Optimal sampling-based path planning focused via direct sampling of an admissible 
// ellipsoidal heuristic,” in Proceedings of the IEEE/RSJ International Conference on 
// Intelligent Robots and Systems (IROS), 2014, pp. 2997–3004.

K ← 900
STEP ← 5
GOAL_BIAS ← 0.05
GOAL_TOL ← 3
R ← 12              // rewiring radius

T ← new_tree(q_start)
X_soln ← new_set()  // the vertices that reach a goal
best ← failure      // the cheapest of them
c_best ← ∞
for k ← 1 to K do
  if c_best = ∞ and random() < GOAL_BIAS then
    q_rand ← sample_goal()
  else
    // A path may stop up to GOAL_TOL short of a goal point, so it can be up
    // to GOAL_TOL shorter than a path to the point itself: widen the
    // ellipse by GOAL_TOL, or it leaves out places a better path goes through.
    q_rand ← sample_informed(c_best + GOAL_TOL)   // whole space while c_best = ∞
  end if
  q_nearest ← nearest(T, q_rand)
  q_new ← steer(q_nearest, q_rand, STEP)
  if collision_free(q_nearest, q_new) then
    Q_near ← near(T, q_new, R)
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
    for each q in Q_near do
      if c_min + dist(q_new, q) < cost(T, q) and collision_free(q_new, q) then
        set_parent(T, q, q_new)
      end if
    end for
    if in_goal(q_new, GOAL_TOL) then
      add(X_soln, q_new)
    end if
    // c_best is the cheapest vertex in X_soln: rewiring can lower any of them
    for each q in X_soln do
      if cost(T, q) < c_best then
        best ← q
        c_best ← cost(T, q)
      end if
    end for
    if best ≠ failure then
      P_best ← path(T, best)
    end if
  end if
end for
if best = failure then
  return failure
end if
return path(T, best)
`,
});
