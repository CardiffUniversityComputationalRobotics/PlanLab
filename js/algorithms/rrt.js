/* rrt.js — RRT, the default algorithm. */
Algorithms.register({
  id: 'rrt',
  name: 'RRT',
  group: 'Trees',
  suggestedSpeed: 1000,
  code: `// S. M. LaValle, “Rapidly-exploring random trees: A new tool for path 
// planning,” Technical Report TR 98-11, Department of Computer Science, 
// Iowa State University, 1998.

K ← 2000            // maximum number of iterations
STEP ← 4            // how far one expansion reaches
GOAL_BIAS ← 0.05    // chance of sampling a goal instead
GOAL_TOL ← 3        // how close counts as reaching a goal point

T ← new_tree(q_start)
for k ← 1 to K do
  if random() < GOAL_BIAS then
    // a goal sample (a dot in a goal region), picked at random or in
    // order, as set under Goal samples in the Objects window
    q_rand ← sample_goal()
  else
    q_rand ← sample_free()
  end if
  q_near ← nearest(T, q_rand)
  q_new ← steer(q_near, q_rand, STEP)
  if collision_free(q_near, q_new) then
    add_vertex(T, q_new)
    add_edge(T, q_near, q_new)
    if in_goal(q_new, GOAL_TOL) then
      return path(T, q_new)
    end if
  end if
end for
return failure
`,
});
