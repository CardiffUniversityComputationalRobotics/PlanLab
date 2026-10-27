/* abit-star.js — Advanced BIT*: inflated, then deflated, truncated searches over each batch. */
Algorithms.register({
  id: 'abit',
  name: 'ABIT*',
  group: 'Batch informed trees',
  suggestedSpeed: 50000,
  code: `// M. P. Strub and J. D. Gammell, “Advanced BIT* (ABIT*): Sampling-based 
// planning with advanced graph-search techniques,” in Proceedings of the IEEE 
// International Conference on Robotics and Automation (ICRA), 2020, pp. 130–136.

BATCHES ← 4
M ← 100
ETA ← 1.1
EPS ← 3             // starting inflation for each batch
GOAL_M ← 5          // new goal samples per goal region in each batch

// The connection radius for n samples and vertices in the informed set,
// whose area informed_measure() takes from the PHS (the whole workspace
// until there is a path), as in the BIT* paper.
function radius(n)
  return ETA * 2 * sqrt(1.5 * informed_measure(c_best) / PI) * sqrt(log(n) / n)
end function

function g_T(x)
  if x in T then
    return cost(T, x)
  end if
  return ∞
end function

function h(x) = dist_to_goal(x)   // straight to the nearest goal

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

function expand(v, eps)
  for each x in near(X_samples, v, r) + near(T, v, r) do
    if x ≠ v and parent(T, x) ≠ v and g_T(v) + dist(v, x) < g_T(x) then
      if dist(q_start, v) + dist(v, x) + h(x) < c_best then
        push(Q_E, (v, x), g_T(v) + dist(v, x) + eps * h(x))
      end if
    end if
  end for
end function

T ← new_tree(q_start)
G ← new_set(goal_samples)           // the goal vertices to aim for
X_samples ← new_set(goal_samples)   // they start as samples
c_best ← ∞
q_best ← failure
for b ← 1 to BATCHES do
  prune()
  for i ← 1 to M do
    add(X_samples, sample_informed(c_best))
  end for
  add_goal_samples(GOAL_M)
  r ← radius(size(T) + size(X_samples))
  for eps ← EPS downto 1 do
    Q_E ← new_queue()
    for each v in T do
      expand(v, eps)
    end for
    while not is_empty(Q_E) and min_key(Q_E) < c_best do
      (v_m, x_m) ← pop_min(Q_E)
      if g_T(v_m) + dist(v_m, x_m) < g_T(x_m) and g_T(v_m) + dist(v_m, x_m) + h(x_m) < c_best then
        if collision_free(v_m, x_m) then
          if x_m in T then
            set_parent(T, x_m, v_m)
            update_best(G)
          else
            remove(X_samples, x_m)
            add_vertex(T, x_m)
            add_edge(T, v_m, x_m)
            update_best([x_m])
          end if
          expand(x_m, eps)
        end if
      end if
    end while
  end for
end for
if q_best ≠ failure then
  return path(T, q_best)
end if
return failure
`,
});
