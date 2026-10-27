/* ait-star.js — Adaptively Informed Trees: a lazy reverse search gives the forward search its heuristic. */
Algorithms.register({
  id: 'ait',
  name: 'AIT*',
  group: 'Batch informed trees',
  suggestedSpeed: 50000,
  code: `// M. P. Strub and J. D. Gammell, “Adaptively Informed Trees (AIT*): Fast asymptotically 
// optimal path planning through adaptive heuristics,” in Proceedings of the IEEE International 
// Conference on Robotics and Automation (ICRA), 2020, pp. 3191–3198.

BATCHES ← 3
M ← 60
ETA ← 1.1
GOAL_M ← 5          // new goal samples per goal region in each batch

// The connection radius for n samples and vertices in the informed set,
// whose area informed_measure() takes from the PHS (the whole workspace
// until there is a path), as in the BIT* paper.
function radius(n)
  return ETA * 2 * sqrt(1.5 * informed_measure(c_best) / PI) * sqrt(log(n) / n)
end function

function f_hat(x) = dist(q_start, x) + dist_to_goal(x)   // the cheapest a path through x could be

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

function g_T(x)
  if x in T then
    return cost(T, x)
  end if
  return ∞
end function

function neighbours(x) = near(X_samples, x, r) + near(T, x, r)

// Dijkstra outward from the queue open, skipping blocked edges.
// Only vertices in the set allowed get a new cost-to-go.
function reverse_dijkstra(open, allowed)
  closed ← new_set()
  while not is_empty(open) do
    u ← pop_min(open)
    if u in closed then
      continue
    end if
    add(closed, u)
    for each v in neighbours(u) do
      if v in allowed and v ∉ closed and edge(u, v) ∉ blocked then
        c ← h_map[u] + dist(u, v)
        if c < h_map[v] then
          h_map[v] ← c
          add_vertex(R, v)
          add_edge(R, u, v)
          push(open, v, c)
        end if
      end if
    end for
  end while
end function

// The full reverse search, from every goal vertex over every sample and
// vertex. Each goal vertex is a root of R.
function reverse_search()
  global h_map, R
  h_map ← new_map(∞)
  R ← new_tree(to_list(G)[1])
  open ← new_queue()
  for each g in G do
    add_vertex(R, g)
    h_map[g] ← 0
    push(open, g, 0)
  end for
  reverse_dijkstra(open, new_set(to_list(X_samples) + vertices(T)))
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

// The reverse-tree edge into x is blocked, so x and the branch below
// it lose their cost-to-go. Re-seed them from their other neighbours.
function repair(x)
  stale ← new_set(subtree(R, x))
  remove_subtree(R, x)
  open ← new_queue()
  for each y in stale do
    h_map[y] ← ∞
  end for
  for each y in stale do
    for each z in neighbours(y) do
      if z ∉ stale and h_map[z] < ∞ and edge(y, z) ∉ blocked then
        c ← h_map[z] + dist(z, y)
        if c < h_map[y] then
          h_map[y] ← c
          add_vertex(R, y)
          add_edge(R, z, y)
        end if
      end if
    end for
    if h_map[y] < ∞ then
      push(open, y, h_map[y])
    end if
  end for
  reverse_dijkstra(open, stale)
end function

function expand(v)
  for each x in neighbours(v) do
    if x ≠ v and parent(T, x) ≠ v and edge(v, x) ∉ blocked then
      key ← g_T(v) + dist(v, x) + h_map[x]
      if key < c_best and g_T(v) + dist(v, x) < g_T(x) then
        push(Q_F, (v, x), key)
      end if
    end if
  end for
end function

function restart_forward()
  global Q_F
  Q_F ← new_queue()
  for each v in T do
    expand(v)
  end for
end function

T ← new_tree(q_start)
G ← new_set(goal_samples)           // the goal vertices to aim for
X_samples ← new_set(goal_samples)   // they start as samples
blocked ← new_set()         // edges found in collision
c_best ← ∞
q_best ← failure
for b ← 1 to BATCHES do
  prune()
  for i ← 1 to M do
    add(X_samples, sample_informed(c_best))
  end for
  add_goal_samples(GOAL_M)
  r ← radius(size(T) + size(X_samples))
  reverse_search()
  restart_forward()
  while not is_empty(Q_F) and min_key(Q_F) < c_best do
    k_queued ← min_key(Q_F)
    (v_m, x_m) ← pop_min(Q_F)
    key ← g_T(v_m) + dist(v_m, x_m) + h_map[x_m]
    if key > k_queued then
      push(Q_F, (v_m, x_m), key)    // h_map rose since it was queued
      continue
    end if
    if key < c_best and g_T(v_m) + dist(v_m, x_m) < g_T(x_m) then
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
        expand(x_m)
      else
        add(blocked, edge(v_m, x_m))
        if parent(R, v_m) = x_m then
          repair(v_m)              // h_map[v_m] relied on that edge
        else if parent(R, x_m) = v_m then
          repair(x_m)
        end if
      end if
    end if
  end while
end for
if q_best ≠ failure then
  return path(T, q_best)
end if
return failure
`,
});
