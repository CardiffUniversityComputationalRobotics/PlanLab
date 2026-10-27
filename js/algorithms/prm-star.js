/* prm-star.js — PRM whose connection radius shrinks as the roadmap grows. */
Algorithms.register({
  id: 'prmstar',
  name: 'PRM*',
  group: 'Roadmaps',
  suggestedSpeed: 10000,
  code: `// // S. Karaman and E. Frazzoli, “Sampling-based algorithms for optimal motion 
// planning,” The International Journal of Robotics Research, vol. 30, no. 7, 
// pp. 846–894, 2011.

N ← 300

function radius(n)
  return 2 * sqrt(1.5 * WIDTH * HEIGHT / PI) * sqrt(log(n) / n)
end function

q_g ← sample_goal()
G ← new_graph()
add_vertex(G, q_start)
add_vertex(G, q_g)
for i ← 1 to N do
  q ← sample_free()
  add_vertex(G, q)
  r ← radius(size(G))
  for each q_n in near(G, q, r) do
    if q_n ≠ q and collision_free(q, q_n) then
      add_edge(G, q, q_n)
    end if
  end for
end for
return shortest_path(G, q_start, q_g)
`,
});
