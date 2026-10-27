/* rrt-reward-penalty.js — RRT whose goal-biased expansions aim at goal samples chosen by a reward-penalty
 * strategy (Hernández, Moll & Kavraki, ICRA 2019, Algorithm 1). The weights are kept in a binary max heap.
 * The heap, reward/penalty and resampling functions are built-ins written in pseudocode (js/pseudocode/builtins/reward-penalty.js). */
Algorithms.register({
  id: 'rewardpenalty',
  name: 'RRT reward-penalty',
  group: 'Trees',
  suggestedSpeed: 3000,
  code: `// J. D. Hernández, M. Moll, and L. E. Kavraki, “Lazy Evaluation of Goal 
// Specifications Guided by Motion Planning,” in Proceedings of the IEEE International 
// Conference on Robotics and Automation, 2019, pp. 944–950.

K ← 5000            // maximum number of iterations
STEP ← 4            // how far one expansion reaches (ε in the paper)
GOAL_BIAS ← 0.05    // chance of expanding toward a goal sample (the paper uses 5% and 50%)
GOAL_TOL ← 3        // how close counts as reaching a goal point
N_MORE ← 2          // goal samples per goal region added when resampling
W_MIN ← 0.1         // a weight this low triggers resampling
STRATEGY ← "reward-penalty"   // the paper's baselines: "consecutive" or "random"

// ---------------------------------------------------------------- the binary max heap
// heap[1] is the goal sample with the highest weight. The functions that
// keep it in order (heap_push, heap_set_weight, reward, penalize, resample,
// choose_goal_sample, …) are built-ins written in pseudocode: see them in the
// Reference tab, or pick them in Functions → Edit a built-in… to change them.
heap ← []
weight ← new_map()     // goal sample → its weight
slot ← new_map()       // goal sample → its index in heap

// ---------------------------------------------------------------- Algorithm 1
T ← new_tree(q_start)
turn ← 0
// Gheap = goalRegionsSampler(GR): the valid goal samples drawn in the goal
// regions, all starting with weight 1.0
for each q in goal_samples do
  heap_push(q, 1.0)
end for
for k ← 1 to K do
  goal_biased ← random() < GOAL_BIAS and length(heap) > 0
  if goal_biased then
    q_towards ← choose_goal_sample()
  else
    q_towards ← sample_free()
  end if
  q_near ← nearest(T, q_towards)
  q_new ← steer(q_near, q_towards, STEP)
  success ← collision_free(q_near, q_new)
  if success then
    add_vertex(T, q_new)
    add_edge(T, q_near, q_new)
    if goal_biased and STRATEGY = "reward-penalty" then
      reward(q_towards)
    end if
    if in_goal(q_new, GOAL_TOL) then
      return path(T, q_new)
    end if
  else if goal_biased and STRATEGY = "reward-penalty" then
    penalize(q_towards)
    if weight[q_towards] ≤ W_MIN then
      resample()
    end if
  end if
end for
return failure
`,
});
