/* reward-penalty.js — the functions of the RRT reward-penalty algorithm (Hernández, Moll & Kavraki, ICRA 2019),
 * as built-ins written in pseudocode. Any algorithm can call them; "Edit a built-in…" in the Functions tab copies
 * one (or all) there to change. They work on the calling algorithm's variables heap, weight, slot, turn, N_MORE
 * and STRATEGY (see js/algorithms/rrt-reward-penalty.js). */
Builtins.definePseudocode('RRT reward-penalty', `// ================================================================ RRT reward-penalty
// Used by the RRT reward-penalty algorithm (Hernández, Moll & Kavraki, ICRA 2019).
// They work on the algorithm's variables: heap, weight, slot, turn, N_MORE and STRATEGY.

// ---------------------------------------------------------------- the binary max heap
// heap[1] is the goal sample with the highest weight. Every entry outweighs
// (or equals) its children heap[2i] and heap[2i + 1]. slot remembers where
// each sample is in the list, so its weight can be changed in place.

// swap two heap entries and update where they are
function heap_swap(i, j)
  a ← heap[i]
  heap[i] ← heap[j]
  heap[j] ← a
  slot[heap[i]] ← i
  slot[heap[j]] ← j
end function

// move the entry at i up while it outweighs its parent
function sift_up(i)
  while i > 1 and weight[heap[i]] > weight[heap[floor(i / 2)]] do
    heap_swap(i, floor(i / 2))
    i ← floor(i / 2)
  end while
end function

// move the entry at i down while one of its children outweighs it
function sift_down(i)
  n ← length(heap)
  while true do
    biggest ← i
    for each c in [2 * i, 2 * i + 1] do
      if c ≤ n and weight[heap[c]] > weight[heap[biggest]] then
        biggest ← c
      end if
    end for
    if biggest = i then
      return
    end if
    heap_swap(i, biggest)
    i ← biggest
  end while
end function

// add goal sample q to the heap with weight w
function heap_push(q, w)
  append(heap, q)
  weight[q] ← w
  slot[q] ← length(heap)
  sift_up(length(heap))
  label(q, w)
end function

// change the weight of goal sample q, then restore the heap order
function heap_set_weight(q, w)
  old ← weight[q]
  weight[q] ← w
  if w > old then
    sift_up(slot[q])
  else
    sift_down(slot[q])
  end if
  label(q, w)
end function

// ---------------------------------------------------------------- reward and penalty
// Weights are always 1, 1/2, 1/3, … (they start at 1 or 0.5), so a reward
// never goes past 1. min(1, …) only stops rounding errors (0.9999…) from
// sending w / (1 − w) to a huge number.

// reward: w ← w / (1 − w), at most 1
function reward(q)
  if weight[q] < 1 then
    heap_set_weight(q, min(1, weight[q] / (1 - weight[q])))
  end if
end function

// penalty: w ← w / (w + 1)
function penalize(q)
  heap_set_weight(q, weight[q] / (weight[q] + 1))
end function

// ---------------------------------------------------------------- goal samples
// More goal samples, for resampling: up to n valid (collision-free) samples
// in each goal region, pushed with weight w. A goal point is its own sample.
function sample_goal_regions(n, w)
  for each g in goals do
    if is_region(g) then
      added ← 0
      tries ← 0
      while added < n and tries < 50 * n do
        tries ← tries + 1
        q ← sample_in(g)
        if is_free(q) then
          heap_push(q, w)
          added ← added + 1
        end if
      end while
    else if is_free(g) and g ∉ slot then
      heap_push(g, w)
    end if
  end for
end function

// Goal region resampling: every existing sample gets weight 0.5 (all equal,
// so the heap order still holds), then new samples join with weight 1.0, so
// they are tried first.
function resample()
  for each q in heap do
    weight[q] ← 0.5
    label(q, 0.5)
  end for
  sample_goal_regions(N_MORE, 1.0)
end function

// the goal sample to expand toward
function choose_goal_sample()
  global turn
  if STRATEGY = "consecutive" then
    turn ← turn mod length(heap) + 1
    return heap[turn]
  else if STRATEGY = "random" then
    return heap[floor(random() * length(heap)) + 1]
  end if
  return heap[1]               // reward-penalty: the top of the max heap
end function
`);
