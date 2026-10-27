# Developing PlanLab

How PlanLab is built, for changing, debugging and testing it. Installing and using it: see `README.md`.

PlanLab is plain HTML, CSS and JavaScript with no libraries and no build step, a small VS Code extension, and a
Python worker that uses only the standard library. The only thing loaded from the internet is the fonts (without
them, system fonts are used).

## How the code is organised

```
index.html                  the four windows, and the <script> tags in load order
css/
  theme.css                 every colour and font (light and dark)
  base.css                  page shell, the four-window grid, dividers, shared buttons
  workspace.css  objects.css  pseudocode.css  run.css       one file per window
js/
  util.js                   tiny helpers ($, clamp, fixed, seeded random numbers)
  host.js                   what the page can ask of the VS Code extension: saving, Python
  world.js                  the workspace model: start, goals, obstacles, shapes, layouts
  geometry.js               obstacle outlines, collision checks, distances
  pseudocode/               the pseudocode language
    values.js               points, trees, graphs, sets, maps, queues, and the operators
    goal-samples.js         the goal samples: valid points in each goal region, from the seed
    tokenizer.js            text → tokens
    parser.js               tokens → syntax tree (the node types are listed at the top)
    compiler.js             speeds up expressions by turning them into closures
    program.js              parses the Algorithm, Functions and Python tabs into one program
    runner.js               runs a program one statement at a time; waits for Python answers
    python.js               your Python functions: their names, and each call to Python (via host.js)
    builtins/               the built-in functions, one file per group
      registry.js           Builtins.define(), Builtins.definePseudocode() and the input checks
      sampling.js  goals.js  geometry.js  trees-graphs.js  search.js  collections.js  maths.js  output.js
      reward-penalty.js     built-ins written in pseudocode (the RRT reward-penalty functions)
  algorithms/               one file per algorithm (the pseudocode you see in the editor)
  library/
    default-functions.js    what the Functions and Python tabs start with
    builtin-snippets.js     the pseudocode versions of built-ins ("Edit a built-in…")
  ui/                       the interface
    state.js                App: the shared state (world, selection, current run, …)
    algorithm-library.js    the algorithms in the menu, your edits to them, and your own algorithms
    saved-state.js          saving and restoring your work (extension file, or browser storage)
    theme.js                light or dark colours: VS Code's or the system's, until the switch in the header is used
                            (it and saved-state.js load straight after host.js, so the page never shows in the wrong theme)
    toast.js  code-editor.js  splitters.js                  shared pieces
    workspace-view.js       window 1: drawing          workspace-input.js   window 1: mouse and keys
    world-actions.js        every change to the workspace goes through here
    objects-panel.js        window 2
    pseudocode-panel.js     window 3: editors, tabs, compiling, errors
    algorithm-tab.js  functions-tab.js  python-tab.js  reference.js         window 3's tabs
    run-panel.js            window 4                   checks.js            the checks before a run
  main.js                   starts everything
  test-hooks.js             window.planlab, for the automated tests
python/functions.py         your Python functions (the Python tab), when PlanLab runs from this folder
vscode/extension.js         the VS Code extension: the tab, your work file, the live folder, the Python worker
package.json                the extension's manifest: its icon, commands and settings
media/                      the extension's icons
tools/
  python_worker.py          runs your Python functions; the extension starts it with the selected interpreter
  build.py                  makes dist/planlab.html
  build_vsix.py             makes dist/planlab.vsix
tests/                      automated tests (see Tests)
```

### Conventions

- **One namespace per file.** Each browser JavaScript file defines one object (`Geometry`, `Parser`, `RunPanel`, …)
  inside `(() => { … })()`, lists what it uses from other files at the top like imports, and returns only what other
  files use:
  ```js
  const Geometry = (() => {
    const { SHAPES, WIDTH, HEIGHT } = World;
    …
    return { polygonOf, makeCollider, distance, … };
  })();
  ```
- **Load order matters.** Files load in the order of the `<script>` tags in `index.html`. A file can use the files
  above it straight away; functions can call files further down, because they only run after everything has loaded.
- **Shared state lives in `App`** (`js/ui/state.js`). Changes to the workspace go through `WorldActions`, which clears
  the run, saves, and refreshes everything that shows the workspace.
- **Code is found by its editor:** `src` is `'algo'` (Algorithm tab), `'lib'` (Functions), `'py'` (Python) or
  `'builtin'` (a built-in written in pseudocode). Errors (`PseudoError`) carry `src` and `line`.

### How a run works

```
Algorithm, Functions and Python tabs
        │  Program.parse: tokenizer → parser → compiler (Python tab: only its def names)
        ▼
     program ──→ Runner ←── RunPanel.tick() calls runner.step() many times per frame
                   │          (Step line: once; a Python call: waits for its answer)
                   ▼
   WorkspaceView draws the trees, graphs and variables; RunPanel shows the numbers
```

The runner is written with JavaScript generators: each statement `yield`s before it runs, so `runner.step()` runs
exactly one line. That is what makes Step line, pausing and the speed slider work. Built-ins run in one go; your
pseudocode functions run line by line. A call to a Python function yields `WAIT`: `runner.isWaiting` is true until the
answer comes, and whatever drives the run waits for `runner.waiting.promise`.

### The VS Code extension

```
PlanLab tab (webview: index.html + js/)  ⇄ postMessage ⇄  vscode/extension.js  ⇄ stdin/stdout (JSON lines) ⇄  tools/python_worker.py
   host.js: saving, Python                                 your work file, live folder,        runs in the selected
                                                           Python worker, settings             interpreter (venv)
```

- **Your work** is kept in `planlab-work.json` in the extension's storage folder (VS Code's `globalStorage`); the
  Python tab also in `python/functions.py`.
- **No network port** is opened: only the extension can reach the Python worker. The tab has a content security
  policy that only allows PlanLab's own scripts.
- **Which files run:** the setting `planlab.appFolder`, else this folder when it is open in VS Code (it is watched),
  else the copy installed with the extension. The **PlanLab** output channel says which files and which Python run,
  and shows what Python writes to stderr.

## Builds

| Command | Makes | Needed when |
|---|---|---|
| `python3 tools/build_vsix.py` | `dist/planlab.vsix`, the VS Code extension | `vscode/extension.js` or `package.json` changed (then install it again), or to give the extension to someone |
| `python3 tools/build.py` | `dist/planlab.html`, PlanLab in one file for a browser | you want to share PlanLab as a single file |

Neither needs the other. While this folder is open in VS Code, the extension runs PlanLab from it, so changes to
`index.html`, `css/`, `js/`, `tools/python_worker.py` and `python/` need no build: the PlanLab tab reloads by itself.

## Changing the code

- **Add an algorithm.** Copy `js/algorithms/rrt.js`, change `id`, `name`, `group` and the pseudocode, and add a
  `<script>` tag for it in `index.html` with the other algorithms. It appears in the algorithm menu.
- **Add a built-in function.** Add a `Builtins.define(…)` call to the right file in `js/pseudocode/builtins/` (the
  comment at the top of `registry.js` shows the pattern), or write it in pseudocode with
  `Builtins.definePseudocode(group, source)` like `reward-penalty.js`. It is then callable, coloured in the editor,
  listed in the Reference tab, and replaceable from the app. To offer its pseudocode in **Edit a built-in…**, add it to
  `js/library/builtin-snippets.js` (tests/test_language.py checks it gives the same answers as the built-in).
- **Add an obstacle shape or a layout.** Add an entry to `SHAPES` or `LAYOUTS` in `js/world.js`.
- **Change colours.** Edit the tokens in `css/theme.css`; the canvas reads the same tokens.
- **Change the language.** Keywords in `tokenizer.js`, statements and precedence in `parser.js`, what operators do in
  `values.js`, and how statements run in `runner.js` (`exec`).
- **Change what Python functions get.** Values cross as JSON: `toJson`/`fromJson` in `js/pseudocode/python.js` and
  `to_json`/`from_json` in `tools/python_worker.py`, which also defines `Point` and the ready-made helpers.

## Debugging

- **In VS Code:** with the PlanLab tab focused, run **Developer: Open Webview Developer Tools** for the page's console.
  `planlab.runner` is the current run (its `globals`, `line`, `error`), `planlab.status` the Run window's status.
  **View → Output → PlanLab** shows which files and which Python run, and Python's stderr.
- **In a browser:** open `index.html` and use the browser's developer tools the same way.
- **Pseudocode errors** carry the editor and line (`error.src`, `error.line`); the line under the editors has a
  **Show** button. Python errors also carry `pythonLine`.
- **Tests:** `tests/test_app.py` saves screenshots in `tests/output/`.

## Tests

The tests drive PlanLab in real browsers with Playwright:

```
pip install playwright
python3 -m playwright install firefox chromium

python3 tests/test_app.py            # the interface, like a user would use it (Firefox; screenshots in tests/output/)
python3 tests/test_language.py       # the language, the built-ins' pseudocode versions, sampling, reward-penalty
python3 tests/test_python.py         # Python functions in the extension's page (Chromium) with a real Python worker
python3 tests/run_extension_test.py  # the VS Code extension itself (Node.js, or the one inside VS Code)
python3 tests/test_algorithms.py     # every algorithm on every layout with 3 seeds (about 10 minutes)
```

Add `--dist` to `test_app.py`, `test_language.py` or `test_algorithms.py` to test `dist/planlab.html` instead of
`index.html`. The tests never touch your saved work: each starts a fresh browser profile.
