/* default-functions.js — what the Functions tab holds the first time the app opens.
 * Library.snippets (builtin-snippets.js) adds the built-ins written in pseudocode. */
const Library = {
  defaultSource: `// Functions: your own pseudocode, shared by every algorithm.
// • "+ New function" starts a new one for you.
// • "Edit a built-in…" brings in a built-in written in pseudocode,
//   so you can read and change it. A function here replaces the
//   built-in with the same name. A function in the algorithm
//   replaces one here.

// Categorical sampling: pick one item, where item i is chosen
// with probability weights[i] / sum(weights).
// No algorithm uses it by default. To pick goals by their weights:
//   q_rand ← sample_in(sample_categorical(goals, goal_weights))
function sample_categorical(items, weights)
  total ← sum(weights)
  r ← random() * total
  acc ← 0
  for i ← 1 to length(items) do
    acc ← acc + weights[i]
    if r < acc then
      return items[i]
    end if
  end for
  return items[length(items)]
end function
`,
  /** What the Python tab holds the first time the app opens. */
  defaultPython: `# Python functions: your own functions in Python, run in the Python selected
# in VS Code (Python: Select Interpreter), e.g. your virtual environment,
# with all its packages. "Check Python" above shows which one it is.
# Call them from the pseudocode by name, like  c ← path_cost(P)
#
# • Points arrive as Point objects (p.x, p.y; + - * / work); give back a
#   Point or an (x, y) tuple. Lists arrive as lists. Trees, graphs and sets
#   arrive as handles you can give back but not look into.
# • dist(a, b), norm(p), steer(a, b, step), Point, inf and failure are
#   ready to use. For other built-ins, call them in the pseudocode and pass
#   the results in. print() writes to the Output tab.
# • import random uses the run's seed, so runs can be repeated.
# • A Python function runs in one go: Step line steps over it.
# • Python functions need PlanLab opened in VS Code (the PlanLab icon in the
#   activity bar), not index.html in a browser. There, this tab is saved as
#   python/functions.py in your PlanLab folder: edit it here or in VS Code
#   ("Open functions.py"), and import your other .py files from python/.

# The length of a path (a list of points).
def path_cost(P):
    return sum(dist(P[i], P[i + 1]) for i in range(len(P) - 1))
`,
  snippets: {},
};
