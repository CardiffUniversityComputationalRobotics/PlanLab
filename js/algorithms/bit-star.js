/* bit-star.js — Batch Informed Trees: ordered search over batches of samples. */
Algorithms.register({
  id: 'bit',
  name: 'BIT*',
  group: 'Batch informed trees',
  suggestedSpeed: 50000,
  code: `// J. D. Gammell, S. S. Srinivasa, and T. D. Barfoot, “Batch Informed Trees (BIT*): 
// Sampling-based optimal planning via the heuristically guided search of implicit random 
// geometric graphs,” in Proceedings of the IEEE International Conference on Robotics and 
// Automation (ICRA), 2015, pp. 3067–3074.

BATCHES ← 4         // number of sample batches
M ← 100             // new samples per batch
GOAL_M ← 5          // new goal samples per goal region in each batch
ETA ← 1.1           // radius scale, must be > 1

// The connection radius for n samples and vertices in the informed set,
// whose area informed_measure() takes from the PHS (the whole workspace
// until there is a path), as in the BIT* paper.
function radius(n)
  return ETA * 2 * sqrt(1.5 * informed_measure(c_best) / PI) * sqrt(log(n) / n)
end function

// cost from q_start through the tree, ∞ if x is not in it
function g_T(x)
  if x in T then
    return cost(T, x)
  end if
  return ∞
end function

function h(x) = dist_to_goal(x)   // cost-to-go estimate: straight to the nearest goal

function f_hat(x) = dist(q_start, x) + h(x)   // the cheapest a path through x could be

// Prune: whatever lies outside the informed set (the PHS, f_hat(x) ≥ c_best)
// can no longer be on a better path. Its samples are dropped, and so are its
// vertices, with their branches. A cut-off vertex still inside the informed
// set becomes a sample again.
function prune()
  for each x in X_samples do
    if f_hat(x) ≥ c_best then
      remove(X_samples, x)
    end if
  end for
  for each v in T do
    if v in T and v ≠ q_start and f_hat(v) > c_best then
      for each w in subtree(T, v) do
        if f_hat(w) < c_best then
          add(X_samples, w)
        end if
      end for
      remove_subtree(T, v)
    end if
  end for
end function

// The cheapest goal vertex among candidates becomes q_best, if it beats c_best.
function update_best(candidates)
  global c_best, q_best, P_best
  for each g in candidates do
    if g in G and g in T and g_T(g) < c_best then
      c_best ← g_T(g)
      q_best ← g
      P_best ← path(T, g)
    end if
  end for
end function

// n new goal samples in each goal region (a goal point is its own), kept
// only where they could give a shorter path. They join G and the samples.
function add_goal_samples(n)
  for each g in goals do
    if is_region(g) then
      for i ← 1 to n do
        q ← sample_in(g)
        if is_free(q) and dist(q_start, q) < c_best then
          add(G, q)
          add(X_samples, q)
        end if
      end for
    end if
  end for
end function

function expand(v)
  // edges from v to nearby samples
  for each x in near(X_samples, v, r) do
    if dist(q_start, v) + dist(v, x) + h(x) < c_best then
      push(Q_E, (v, x), g_T(v) + dist(v, x) + h(x))
    end if
  end for
  // rewiring edges, only from vertices new to this batch
  if v ∉ V_old then
    for each w in near(T, v, r) do
      if w ≠ v and parent(T, w) ≠ v and parent(T, v) ≠ w then
        if g_T(v) + dist(v, w) < g_T(w) and dist(q_start, v) + dist(v, w) + h(w) < c_best then
          push(Q_E, (v, w), g_T(v) + dist(v, w) + h(w))
        end if
      end if
    end for
  end if
end function

T ← new_tree(q_start)
G ← new_set(goal_samples)           // the goal vertices to aim for
X_samples ← new_set(goal_samples)   // they start as samples
Q_V ← new_queue()
Q_E ← new_queue()
V_old ← new_set()
c_best ← ∞
q_best ← failure
r ← ∞
batch ← 0
while true do
  if is_empty(Q_V) and is_empty(Q_E) then
    if batch = BATCHES then
      break
    end if
    batch ← batch + 1
    prune()
    for i ← 1 to M do
      add(X_samples, sample_informed(c_best))
    end for
    add_goal_samples(GOAL_M)
    V_old ← new_set(vertices(T))
    for each v in T do
      push(Q_V, v, g_T(v) + h(v))
    end for
    r ← radius(size(T) + size(X_samples))
  end if
  // expand vertices while they look as good as the best edge
  while not is_empty(Q_V) and min_key(Q_V) ≤ min_key(Q_E) do
    expand(pop_min(Q_V))
  end while
  if is_empty(Q_E) then
    continue
  end if
  (v_m, x_m) ← pop_min(Q_E)
  if g_T(v_m) + dist(v_m, x_m) + h(x_m) < c_best then
    if g_T(v_m) + dist(v_m, x_m) < g_T(x_m) and collision_free(v_m, x_m) then
      if x_m in T then
        set_parent(T, x_m, v_m)          // rewire: x_m and all below it get cheaper
        update_best(G)
      else
        remove(X_samples, x_m)
        add_vertex(T, x_m)
        add_edge(T, v_m, x_m)
        push(Q_V, x_m, g_T(x_m) + h(x_m))
        update_best([x_m])
      end if
    end if
  else
    clear(Q_E)             // nothing queued can beat c_best
    clear(Q_V)
  end if
end while
if q_best ≠ failure then
  return path(T, q_best)
end if
return failure
`,
});
