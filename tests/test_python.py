"""Checks Python functions as they run in the PlanLab VS Code extension, without VS Code.

The page is built exactly as vscode/extension.js builds it (content security policy included), by running the
extension's own code with Node.js (VS Code's, if Node.js isn't installed). It opens in Chromium, the engine of VS
Code's webviews. A stand-in for the extension passes the page's messages to a real Python worker
(tools/python_worker.py), started with the Python that runs this test: use a virtual environment to check that its
packages are used. tests/test_extension.js checks the extension's side.

    python3 tests/test_python.py
"""
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from run_extension_test import node  # noqa: E402  (Node.js, or VS Code's)

results = []


def check(name, ok, info=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{str(info)[:300]}]" if info else ""), flush=True)


# ---------------------------------------------------------------- the page, as the extension builds it
PAGE_SCRIPT = """
const Module = require('module'), path = require('path'), url = require('url');
const vscode = {
  Uri: { joinPath: (b, ...p) => { const f = path.join(b.fsPath, ...p); return { fsPath: f, toString: () => url.pathToFileURL(f).href }; },
         file: (f) => ({ fsPath: f, toString: () => url.pathToFileURL(f).href }) },
  workspace: {}, window: {}, commands: {}, extensions: {},
};
const load = Module._load;
Module._load = function (r, ...rest) { return r === 'vscode' ? vscode : load.call(this, r, ...rest); };
const root = process.argv[1];
const ext = require(path.join(root, 'vscode', 'extension.js'));
const webview = { cspSource: 'file:', asWebviewUri: (u) => u.toString() };
const context = { extensionPath: root, extensionUri: { fsPath: root }, globalStorageUri: { fsPath: path.join(root, 'no-such-folder') } };
process.stdout.write(ext._forTests.pageHtml(webview, context, root, '/home/you/PlanLab/python/functions.py'));   // as when PlanLab runs from your folder
"""
if not node:
    sys.exit("No Node.js, and no VS Code to borrow it from.")
html = subprocess.run([node, "-e", PAGE_SCRIPT, str(ROOT)], capture_output=True, text=True, env={**os.environ, "ELECTRON_RUN_AS_NODE": "1"}, check=True).stdout
page_file = Path(tempfile.mkdtemp(prefix="planlab-page-")) / "planlab.html"
page_file.write_text(html, encoding="utf-8")
check("the extension's page (with its content security policy) was built", "Content-Security-Policy" in html and "window.PLANLAB_SAVED = null;" in html)


# ---------------------------------------------------------------- a stand-in for the extension
class Worker:
    """tools/python_worker.py, as the extension runs it."""
    def __init__(self):
        self.process = subprocess.Popen([sys.executable, "-u", str(ROOT / "tools/python_worker.py")], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        text=True, env={**os.environ, "PLANLAB_CALL_LIMIT": "1.5"})

    def ask(self, request):
        try:
            self.process.stdin.write(json.dumps(request) + "\n")
            self.process.stdin.flush()
            line = self.process.stdout.readline()
            if not line:
                raise BrokenPipeError
            return json.loads(line)
        except (BrokenPipeError, OSError):
            return {"problem": f"Python ({sys.executable}) stopped."}


worker = Worker()
saved = []
told = []      # messages the page sent without waiting for an answer (like openPythonFile)


def host(message):
    """What vscode/extension.js answers to the page's messages."""
    kind = message.get("type")
    if kind == "save":
        saved.append(message["state"])
        return None
    if kind == "openPythonFile":
        told.append(kind)
        return None
    if kind == "pythonStatus":
        reply = worker.ask({"op": "status"})
        reply["from"] = "the interpreter selected in VS Code"
    elif kind == "pythonLoad":
        reply = worker.ask({"op": "load", "source": message["source"]})
        if "error" not in reply and "problem" not in reply:
            worker.ask({"op": "start", "seed": message["seed"]})
    elif kind == "pythonCall":
        reply = worker.ask({"op": "call", "name": message["name"], "args": message["args"]})
    else:
        return None
    reply["replyTo"] = message["id"]
    return reply


# the page's acquireVsCodeApi(): messages go to host() above; answers come back as message events.
# window.slowCalls = { name: ms } holds a function's answer back, like a Python function that takes a while.
SHIM = """
window.acquireVsCodeApi = () => ({ postMessage(m) {
  const delay = (window.slowCalls || {})[m.name] || 0;
  window.planlabHost(m).then((reply) => { if (reply) setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data: reply })), delay); });
} });
"""

# What VS Code puts in every webview for scrollbars and inline code (its default styles), with a dark theme's colours.
VSCODE_DARK_STYLES = """@layer vscode-default {
  html { scrollbar-color: var(--vscode-scrollbarSlider-background) var(--vscode-editor-background); }
  code { color: var(--vscode-textPreformat-foreground); background-color: var(--vscode-textPreformat-background); padding: 1px 3px; border-radius: 4px; }
}
:root { --vscode-editor-background: #1f1f1f; --vscode-scrollbarSlider-background: rgba(121, 121, 121, 0.4);
  --vscode-textPreformat-foreground: #d0d0d0; --vscode-textPreformat-background: #3c3c3c; }
"""

PYTHON = '''import math, random

# scale a point
def scale(p, k):
    return p * k

def first(L):
    return L[0]

def total(xs):
    return sum(xs)

def far():
    return math.inf

def nothing():
    return failure

def shout(x):
    print("hello from Python", x)
    return x

def boom(a):
    b = a - 1
    return a / b

def roll():
    return random.random()

def has_package():
    import playwright          # installed in the environment that runs this test
    return True

def same_tree(T):
    return T

def forever():
    while True:
        pass

def double(x):
    return 2 * x

def slow():
    return 7

def dist(a, b):                # replaces the built-in
    return 42
'''

with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    context.expose_function("planlabHost", host)
    context.add_init_script(SHIM)
    page = context.new_page()
    errors, violations = [], []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: violations.append(m.text) if "Content Security Policy" in m.text else None)
    page.goto(page_file.as_uri())
    page.wait_for_timeout(800)
    status = lambda: page.evaluate("window.planlab.status")

    def wait_until(js, timeout=10000):
        """Like page.wait_for_function, which the page's content security policy (rightly) doesn't allow."""
        end = time.time() + timeout / 1000
        while not page.evaluate(js):
            if time.time() > end:
                raise TimeoutError(f"waited {timeout} ms for {js}")
            page.wait_for_timeout(50)

    def set_python(text):
        page.evaluate("t => { const c = document.querySelector('#py'); c.value = t; c.dispatchEvent(new Event('input')); }", text)
        page.wait_for_timeout(400)

    def set_algorithm(text):
        page.evaluate("t => { const c = document.querySelector('#code'); c.value = t; c.dispatchEvent(new Event('input')); }", text)
        page.wait_for_timeout(400)

    def run(algorithm, seed=177):
        return page.evaluate("([a, s]) => window.planlab.runSource(a, null, s, 1e7)", [algorithm, seed])

    check("the page runs under the extension's content security policy, with no errors", not errors and not violations
          and page.evaluate("typeof window.planlab") == "object", (errors + violations)[:2])
    page.evaluate("document.body.className = 'vscode-light'")
    page.wait_for_timeout(100)
    light = page.evaluate("document.documentElement.dataset.theme")
    page.evaluate("document.body.className = 'vscode-dark'")
    page.wait_for_timeout(100)
    check("the colours follow VS Code's light or dark theme", light == "light" and page.evaluate("document.documentElement.dataset.theme") == "dark")
    page.click("#themeSwitch")
    page.wait_for_timeout(100)
    chosen = page.evaluate("document.documentElement.dataset.theme")
    page.evaluate("document.body.className = 'vscode-light'")
    page.wait_for_timeout(100)
    page.evaluate("document.body.className = 'vscode-dark'")
    page.wait_for_timeout(400)
    check("the switch in the header makes PlanLab light, and it stays light when VS Code's theme changes",
          chosen == "light" and page.evaluate("document.documentElement.dataset.theme") == "light")
    check("the choice is saved with your work", saved and saved[-1].get("theme") == "light", saved[-1].get("theme") if saved else "nothing saved")
    page.click("#themeSwitch")
    page.wait_for_timeout(400)
    check("the switch makes it dark again", page.evaluate("document.documentElement.dataset.theme") == "dark" and saved[-1].get("theme") == "dark")
    light_page_file = page_file.with_name("planlab-light.html")
    light_page_file.write_text(html.replace("window.PLANLAB_SAVED = null;", 'window.PLANLAB_SAVED = {"theme": "light"};'), encoding="utf-8")
    light_page = context.new_page()
    light_page.goto(light_page_file.as_uri())
    light_page.wait_for_timeout(800)
    check("a saved choice is used when PlanLab opens, whatever VS Code's theme",
          light_page.evaluate("document.documentElement.dataset.theme") == "light" and light_page.get_attribute("#themeSwitch", "aria-checked") == "false")
    light_page.close()
    page.evaluate("css => { const s = document.createElement('style'); s.textContent = css; document.head.prepend(s); }", VSCODE_DARK_STYLES)
    page.click("#themeSwitch")   # PlanLab light, VS Code dark
    page.wait_for_timeout(200)
    code_colours = page.eval_on_selector("#goalNote code", "c => [getComputedStyle(c).color, getComputedStyle(c).backgroundColor]")
    scrollbars = page.evaluate("getComputedStyle(document.documentElement).scrollbarColor")
    check("in a dark VS Code, a light PlanLab shows code and scrollbars in its own light colours, not VS Code's dark ones",
          code_colours == ["rgb(21, 27, 34)", "rgba(21, 27, 34, 0.07)"] and "31, 31, 31" not in scrollbars, [code_colours, scrollbars])
    page.click("#themeSwitch")
    page.wait_for_timeout(400)

    page.click("#tabPy")
    wait_until("!/Checking/.test(document.querySelector('#pyState').textContent)")
    state = page.inner_text("#pyState")
    check("the Python tab says which Python runs the functions", sys.executable in state and (("virtual environment" in state) == (sys.prefix != sys.base_prefix)), state)
    check("it starts with an example Python function, in Python colours",
          "def path_cost(P):" in page.input_value("#py") and page.locator("#edPy .s-k", has_text="def").count() > 0)

    set_python(PYTHON)
    r = run("p ← scale((1, 2), 3)\nreturn [p.x, p.y]")
    check("the pseudocode calls a Python function, with points both ways", r["result"] == "[3,6]", r["error"] or r["result"])
    r = run("T ← new_tree(q_start)\nq ← first([q_start, (5, 5)])\nreturn [length(path(T, q))]")
    check("a point that comes back unchanged is the same point (a tree vertex stays a vertex)", r["result"] == "[1]", r["error"] or r["result"])
    r = run("return [total([1, 2, 3.5])]")
    check("lists go in as lists", r["result"] == "[6.5]", r["error"] or r["result"])
    r = run("if far() = ∞ and nothing() = failure then\n  return [1]\nend if\nreturn [0]")
    check("∞ and failure cross both ways", r["result"] == "[1]", r["error"] or r["result"])
    r = run("T ← new_tree(q_start)\nU ← same_tree(T)\nadd_vertex(U, (1, 1))\nreturn [length(vertices(T))]")
    check("a tree goes to Python as a handle and comes back as the same tree", r["result"] == "[2]", r["error"] or r["result"])
    r = run("x ← shout(5)\nreturn [x]")
    check("print() in Python reaches the Output", r["result"] == "[5]" and "hello from Python 5" in " ".join(r["printed"]), r["printed"])
    r = run("x ← 1\ny ← boom(1)\nreturn [y]")
    check("an error in Python is reported at the pseudocode line, with the Python line and message",
          r["error"] and r["error"].startswith("algo:2: boom(), Python line 25: ZeroDivisionError"), r["error"])
    r1, r2, r3 = run("return [roll()]", 5), run("return [roll()]", 5), run("return [roll()]", 6)
    check("Python's random module follows the run's seed: same seed, same numbers", r1["result"] == r2["result"] != r3["result"], [r1["result"], r3["result"]])
    r = run("if has_package() then\n  return [1]\nend if\nreturn [0]")
    check("packages of the selected Python (here a virtual environment) can be imported", r["result"] == "[1]", r["error"] or r["result"])
    r = run("return [dist((0, 0), (3, 4)), builtin.dist((0, 0), (3, 4))]")
    check("a Python function with a built-in's name replaces it; builtin.dist(…) is still the original", r["result"] == "[42,5]", r["error"] or r["result"])
    r = run("x ← scale((1, 2))")
    check("calling with the wrong number of inputs says so", r["error"] and "scale() takes 2 inputs, but got 1" in r["error"], r["error"])
    started = time.time()
    r = run("x ← forever()")
    check("a Python function that never ends is stopped, and says why", r["error"] and "TimeoutError" in r["error"] and time.time() - started < 10, r["error"])

    # a real planner with a Python function in its inner loop: RRT with steer() written in Python
    set_python('''import math
def steer(a, b, step):
    d = math.hypot(b.x - a.x, b.y - a.y)
    if d <= step:
        return b
    return Point(a.x + (b.x - a.x) * step / d, a.y + (b.y - a.y) * step / d)
''')
    page.select_option("#preset", "blocks")
    page.wait_for_timeout(200)
    started = time.time()
    r = page.evaluate("() => { const w = window.planlab; return w.runSource(w.algorithms.rrt.code, null, 177, 1e7); }")
    check("RRT finds a path with steer() written in Python", r["pathPoints"] > 0 and not r["blocked"] and not r["error"],
          f"{r['error'] or round(r['length'], 1)}, {time.time() - started:.1f} s")

    # the Run window: Step line goes through a line that calls Python, and the run waits without freezing
    set_python(PYTHON)
    page.click("#tabAlgo")
    set_algorithm("a ← 1\nb ← double(a)\nc ← b + 1\nreturn [c]")
    for _ in range(3):
        page.click("#stepBtn")
        page.wait_for_timeout(250)
    check("Step line goes through a line that calls Python", page.evaluate("window.planlab.runner.globals.get('b')") == 2
          and page.evaluate("window.planlab.runner.line") == 3, page.evaluate("window.planlab.runner.line"))   # about to run line 3
    page.click("#resetBtn")
    page.evaluate("window.slowCalls = { slow: 1500 }")
    set_algorithm("x ← slow()\nreturn [x]")
    page.click("#runBtn")
    page.wait_for_timeout(300)
    check("while Python works, the page stays responsive (the run waits)", status() == "running" and page.evaluate("window.planlab.runner.isWaiting"))
    page.click("#runBtn")   # Pause
    page.wait_for_timeout(2000)
    check("Pause while Python works: the run stays paused after the answer comes", status() == "paused")
    page.click("#runBtn")   # Resume
    wait_until("window.planlab.status === 'done'")
    check("…and Resume finishes it", page.evaluate("window.planlab.runner.result[0]") == 7)
    page.click("#runBtn")   # Run again, then Reset while Python works
    page.wait_for_timeout(300)
    page.click("#resetBtn")
    page.wait_for_timeout(2000)
    check("Reset while Python works: the late answer is ignored", status() == "idle" and not errors, errors[:2])
    page.evaluate("window.slowCalls = {}")
    set_algorithm("x ← shout(7)\nreturn [x]")
    page.click("#runBtn")
    wait_until("['found','nopath','done','error'].includes(window.planlab.status)")
    log = page.evaluate("document.querySelector('#boxLog').textContent")
    check("a run from the Run window prints Python output to the Output tab", "hello from Python 7" in log, log[-200:])

    # errors in the Python tab itself, and names
    set_python("def bad(:\n    pass\n")
    set_algorithm("x ← bad()")
    page.click("#runBtn")
    wait_until("window.planlab.status === 'error'")
    check("a syntax error in the Python tab stops the run and shows its line",
          "Python · line 1" in page.inner_text("#codeMsg") and page.get_attribute("#tabPy", "aria-selected") == "true", page.inner_text("#codeMsg"))
    set_python("def twice(x):\n    return 2 * x\n")
    page.evaluate("() => { const c = document.querySelector('#lib'); c.value += '\\nfunction twice(x)\\n  return x\\nend function\\n'; c.dispatchEvent(new Event('input')); }")
    page.wait_for_timeout(500)
    check("the same name in pseudocode and in Python is an error", "defined in pseudocode and in Python" in page.inner_text("#codeMsg"), page.inner_text("#codeMsg"))
    page.evaluate("() => { const c = document.querySelector('#lib'); c.value = c.value.replace('\\nfunction twice(x)\\n  return x\\nend function\\n', ''); c.dispatchEvent(new Event('input')); }")
    page.click("#tabPy")
    page.click("#newPyFn")
    page.fill("#fnName", "clearance")
    page.fill("#fnParams", "q")
    page.click("#newFnForm button[type=submit]")
    page.wait_for_timeout(500)
    check("+ New Python function adds a def outline to the Python tab", "def clearance(q):\n    result = None" in page.input_value("#py"))
    page.click("#tabRef")
    page.wait_for_timeout(300)
    check("the Reference tab lists Python functions", "clearance(q)" in page.inner_text("#ref") and "PYTHON" in page.inner_text("#ref").upper())

    # the Python tab as python/functions.py: its button, and edits made to the file in VS Code
    page.click("#tabPy")
    wait_until("!/Checking/.test(document.querySelector('#pyState').textContent)")
    check("the Python tab has an Open functions.py button, and says where it is saved",
          page.is_visible("#pyOpenFile") and "/home/you/PlanLab/python/functions.py" in page.inner_text("#pyState"), page.inner_text("#pyState"))
    page.click("#pyOpenFile")
    page.wait_for_timeout(300)
    check("…which asks VS Code to open the file", told == ["openPythonFile"], told)
    page.evaluate("window.dispatchEvent(new MessageEvent('message', { data: { type: 'pythonFile', source: 'def from_file():\\n    return 3\\n' } }))")
    page.wait_for_timeout(400)
    check("edits made to functions.py in VS Code show in the Python tab", page.input_value("#py") == "def from_file():\n    return 3\n")
    r = run("return [from_file()]")
    check("…and the pseudocode can call them", r["result"] == "[3]", r["error"] or r["result"])
    set_python(page.input_value("#py") + "\n# clearance(q)\ndef clearance(q):\n    result = None\n    return result\n")

    # your work is saved through the extension, not in the browser
    page.wait_for_timeout(500)
    check("your work, Python tab included, is saved through the extension", saved and "def clearance(q):" in saved[-1].get("python", "")
          and page.evaluate("localStorage.getItem('planlab')") is None)

    # Python stops: the next run says so
    worker.process.kill()
    worker.process.wait()
    r = run("return [from_file()]")
    check("if Python stops, a run says so", r["error"] and "stopped" in r["error"], r["error"])
    check("no page errors", not errors, errors[:3])

    # opened as a plain file in a browser: Python functions can't run, and the Python tab says where they can
    plain = browser.new_page(viewport={"width": 1440, "height": 900})
    plain.goto((ROOT / "index.html").as_uri())
    plain.wait_for_timeout(800)
    plain.evaluate("t => { const c = document.querySelector('#py'); c.value = t; c.dispatchEvent(new Event('input')); }", "def twice(x):\n    return 2 * x\n")
    plain.click("#tabPy")
    plain.wait_for_timeout(500)
    check("opened as a plain file, the Python tab says to open PlanLab in VS Code", "PlanLab: Open" in plain.inner_text("#pyState"), plain.inner_text("#pyState"))
    plain.click("#tabAlgo")
    plain.evaluate("() => { const c = document.querySelector('#code'); c.value = 'x ← twice(2)'; c.dispatchEvent(new Event('input')); }")
    plain.wait_for_timeout(500)
    plain.click("#runBtn")
    plain.wait_for_timeout(800)
    check("…and running an algorithm that calls Python explains it", plain.evaluate("window.planlab.status") == "error"
          and "selected in VS Code" in plain.inner_text("#codeMsg"), plain.inner_text("#codeMsg"))
    browser.close()

if worker.process.poll() is None:
    worker.process.kill()
print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
