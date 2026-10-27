/* lazy-prm.js — PRM that checks only the edges on the shortest path it finds. */
Algorithms.register({
  id: 'lazyprm',
  name: 'Lazy PRM',
  group: 'Roadmaps',
  suggestedSpeed: 10000,
  code: `// R. Bohlin and L. E. Kavraki, “A randomized algorithm for 
// robot path planning based on lazy evaluation,” in Handbook on 
// Randomized Computing, pp. 221–249, 2001.

N ← 250
R ← 16

function add_samples(G, n)
  for i ← 1 to n do
    q ← sample_free()
    add_vertex(G, q)
    for each q_n in near(G, q, R) do
      if q_n ≠ q then
        add_edge(G, q, q_n)        // not checked yet
      end if
    end for
  end for
end function

q_g ← sample_goal()
G ← new_graph()
add_vertex(G, q_start)
add_vertex(G, q_g)
add_samples(G, N)
for attempt ← 1 to 500 do
  P ← shortest_path(G, q_start, q_g)
  if P = failure then
    add_samples(G, N / 2)          // the roadmap is cut: grow it
    continue
  end if
  ok ← true
  for i ← 1 to length(P) - 1 do
    if not collision_free(P[i], P[i + 1]) then
      remove_edge(G, P[i], P[i + 1])
      ok ← false
    end if
  end for
  if ok then
    return P
  end if
end for
return failure
`,
});
