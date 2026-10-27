/* rrt-connect.js — two trees, one from each end, grown toward each other. */
Algorithms.register({
  id: 'connect',
  name: 'RRT-Connect',
  group: 'Trees',
  suggestedSpeed: 1000,
  code: `// J. J. Kuffner and S. M. LaValle, “RRT-Connect: An efficient approach to single-query 
// path planning,” in Proceedings of the IEEE International Conference on Robotics and Automation (ICRA),
// 2000, pp. 995–1001.

K ← 2000
STEP ← 4

function extend(T, q)
  q_near ← nearest(T, q)
  q_new ← steer(q_near, q, STEP)
  if collision_free(q_near, q_new) then
    add_vertex(T, q_new)
    add_edge(T, q_near, q_new)
    return q_new
  end if
  return failure
end function

function connect(T, q)
  repeat
    q_new ← extend(T, q)
  until q_new = failure or dist(q_new, q) < 0.001
  return q_new
end function

q_g ← sample_goal()        // a goal sample: random, or the first one when Consecutive
T_a ← new_tree(q_start)
T_b ← new_tree(q_g)
for k ← 1 to K do
  q_rand ← sample_free()
  q_a ← extend(T_a, q_rand)
  if q_a ≠ failure then
    q_b ← connect(T_b, q_a)
    if q_b ≠ failure and dist(q_b, q_a) < 0.001 then
      P ← path(T_a, q_a) + reverse(path(T_b, q_b))
      if root(T_a) ≠ q_start then
        P ← reverse(P)
      end if
      return P
    end if
  end if
  // swap the trees so both get to grow
  (T_a, T_b) ← (T_b, T_a)
end for
return failure
`,
});
