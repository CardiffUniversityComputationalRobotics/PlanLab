/* lazy-rrt.js — RRT that checks edges only once a branch reaches a goal. */
Algorithms.register({
  id: 'lazyrrt',
  name: 'Lazy RRT',
  group: 'Trees',
  suggestedSpeed: 3000,
  code: `// R. Bohlin and L. E. Kavraki, “A randomized algorithm for 
// robot path planning based on lazy evaluation,” in Handbook on 
// Randomized Computing, pp. 221–249, 2001.

// S. M. LaValle, “Rapidly-exploring random trees: A new tool for path 
// planning,” Technical Report TR 98-11, Department of Computer Science, 
// Iowa State University, 1998.

K ← 10000
STEP ← 4
GOAL_BIAS ← 0.05
GOAL_TOL ← 3

T ← new_tree(q_start)
for k ← 1 to K do
  if random() < GOAL_BIAS then
    q_rand ← sample_goal()
  else
    q_rand ← sample()
  end if
  q_near ← nearest(T, q_rand)
  q_new ← steer(q_near, q_rand, STEP)
  if is_free(q_new) then          // cheap point check only
    add_vertex(T, q_new)
    add_edge(T, q_near, q_new)    // the edge is not checked yet
    if in_goal(q_new, GOAL_TOL) then
      P ← path(T, q_new)
      ok ← true
      for i ← 1 to length(P) - 1 do
        if not collision_free(P[i], P[i + 1]) then
          remove_subtree(T, P[i + 1])   // drop the blocked branch
          ok ← false
          break
        end if
      end for
      if ok then
        return P
      end if
      P ← null
    end if
  end if
end for
return failure
`,
});
