# Python functions: your own functions in Python, run in the Python selected
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
#   activity bar), not index.html in a browser.

# The length of a path (a list of points).
def path_cost(P):
    print("hello")
    print("test")
    return sum(dist(P[i], P[i + 1]) for i in range(len(P) - 1))
    
import numpy as np
from matplotlib.figure import Figure

# show_grid(grid): opens the grid in a matplotlib window
def show_grid(grid):
    fig = Figure()
    ax = fig.subplots()
    ax.imshow(np.array(grid, dtype=float), cmap="gray", origin="lower", extent=(0, 100, 0, 100))
    fig.savefig("workspace.png")