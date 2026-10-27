/* prm.js — the Probabilistic Roadmap with a fixed connection radius. */
Algorithms.register({
  id: 'prm',
  name: 'PRM',
  group: 'Roadmaps',
  suggestedSpeed: 10000,
  code: `// L. E. Kavraki, P. Švestka, J.-C. Latombe, and M. H. Overmars, “Probabilistic 
// roadmaps for path planning in high-dimensional configuration spaces,” IEEE Transactions 
// on Robotics and Automation, vol. 12, no. 4, pp. 566–580, 1996.

N ← 250             // number of roadmap samples
R ← 15              // connection radius

q_g ← sample_goal()
G ← new_graph()
add_vertex(G, q_start)
add_vertex(G, q_g)
for i ← 1 to N do
  q ← sample_free()
  add_vertex(G, q)
  for each q_n in near(G, q, R) do
    if q_n ≠ q and collision_free(q, q_n) then
      add_edge(G, q, q_n)
    end if
  end for
end for
return shortest_path(G, q_start, q_g)    // A* search
`,
});
