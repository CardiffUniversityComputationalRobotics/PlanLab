"""Drives the app in a real browser like a user would, and checks the results.

Covers: running, the checks before a run, dragging objects in and out, goal weights and goal samples,
+ New function, Edit a built-in, stepping over and into functions, error messages, editing and keeping
algorithms, every algorithm from the menu (and the informed set they draw), the reward-penalty built-ins,
Randomise each run, Run repeatedly, resizing the windows, and the layout at desktop, tablet and phone sizes.
Screenshots go to tests/output/. Python functions are checked by test_python.py.

    python3 tests/test_app.py          # or add --dist to test dist/planlab.html
"""
import re
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / ("dist/planlab.html" if "--dist" in sys.argv else "index.html")
SHOTS = ROOT / "tests" / "output"
SHOTS.mkdir(exist_ok=True)
results = []


def check(name, ok, info=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{info}]" if info else ""), flush=True)


# ---------------------------------------------------------------- helpers
def screen_xy(page, x, y):
    """Workspace coordinates → screen pixels (matches the padding in workspace-view.js)."""
    r = page.eval_on_selector("#ws", "c => { const b = c.getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width }; }")
    s = (r["w"] - 40) / 100
    return r["l"] + 30 + x * s, r["t"] + 10 + 100 * s - y * s


def status(page):
    return page.evaluate("window.planlab.status")


def wait_done(page, timeout=60000):
    page.wait_for_function("['found', 'nopath', 'error', 'done'].includes(window.planlab.status)", timeout=timeout)
    return status(page)


def set_speed(page, index):
    page.eval_on_selector("#speed", f"e => {{ e.value = {index}; e.dispatchEvent(new Event('input')); }}")


def drag(page, x0, y0, x1, y1):
    page.mouse.move(x0, y0)
    page.mouse.down()
    page.mouse.move(x1, y1, steps=12)
    page.mouse.up()


def drag_item(page, selector, x, y):
    b = page.locator(selector).bounding_box()
    drag(page, b["x"] + b["width"] / 2, b["y"] + b["height"] / 2, *screen_xy(page, x, y))
    page.wait_for_timeout(150)


def set_code(page, selector, text):
    page.evaluate("([s, t]) => { const c = document.querySelector(s); c.value = t; c.dispatchEvent(new Event('input')); }", [selector, text])
    page.wait_for_timeout(400)


def goals(page):
    return page.evaluate("window.planlab.world.goals")


def options(page):
    """The names in the Algorithm menu."""
    return page.eval_on_selector_all("#algo option", "os => os.map(o => o.textContent)")


def type_at_line_end(page, editor, line_number, text):
    """Scrolls the editor to a line (as the scroll wheel would), clicks on it, and types at its end."""
    line = page.locator(f"{editor} .hl .cl").nth(line_number - 1)
    line.evaluate("e => { const ed = e.closest('.editor'); ed.scrollIntoView({ block: 'center' }); ed.scrollLeft = 0; ed.scrollTop = e.offsetTop - ed.clientHeight / 2; }")
    page.wait_for_timeout(100)
    box = line.bounding_box()
    page.mouse.click(box["x"] + 30, box["y"] + box["height"] / 2)
    page.keyboard.press("End")
    page.keyboard.type(text)
    page.wait_for_timeout(300)


EDITOR_SIZES = """(editor) => {
  const ed = document.querySelector(editor), pre = ed.querySelector('.hl'), ta = ed.querySelector('textarea');
  const p = pre.getBoundingClientRect(), t = ta.getBoundingClientRect();
  return { codeHeight: Math.round(p.height), boxHeight: Math.round(t.height), codeWidth: Math.round(p.width), boxWidth: Math.round(t.width) };
}"""


with sync_playwright() as p:
    browser = p.firefox.launch()
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    errors = []
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(PAGE.as_uri())
    page.wait_for_timeout(800)

    # ---------------------------------------------------------------- start up and run
    check("starts ready", status(page) == "idle")
    check("all checks pass at the start", page.eval_on_selector_all("#checks li", "ls => ls.every(l => l.dataset.ok === '1')"))
    code = page.input_value("#code")
    check("the default RRT samples goals with sample_goal(), not by weight", "q_rand ← sample_goal()" in code and "g ← sample_categorical" not in code)
    check("sample_categorical() is still in the Functions tab", "function sample_categorical(items, weights)" in page.input_value("#lib"))

    # ---------------------------------------------------------------- the editors take typing on every line
    sizes = page.evaluate(EDITOR_SIZES, "#edAlgo")
    check("the editor's typing box covers all of the code", sizes["boxHeight"] >= sizes["codeHeight"] and sizes["boxWidth"] >= sizes["codeWidth"], sizes)
    type_at_line_end(page, "#edAlgo", 27, "   // typed far down")
    typed = page.input_value("#code").split("\n")[26]
    check("typing on a line below the first screen works", typed.endswith("// typed far down"), typed)
    check("the coloured copy shows the typed text on the same line", page.locator("#edAlgo .hl .cl").nth(26).text_content() == typed)
    check("the typing box never scrolls on its own", page.eval_on_selector("#code", "t => t.scrollTop === 0 && t.scrollLeft === 0"))
    page.click("#tabLib")
    type_at_line_end(page, "#edLib", 22, "   // typed in Functions")
    check("typing on a low line of the Functions tab works", page.input_value("#lib").split("\n")[21].endswith("// typed in Functions"))
    page.click("#tabAlgo")
    page.click("#runBtn")
    page.wait_for_timeout(1200)
    check("Run starts the planner", status(page) == "running")
    page.screenshot(path=str(SHOTS / "01-running.png"))
    set_speed(page, 11)
    check("RRT finds a path", wait_done(page) == "found")

    # ---------------------------------------------------------------- the checks before a run
    page.mouse.click(*screen_xy(page, 10, 10))
    page.keyboard.press("Delete")
    page.wait_for_timeout(150)
    check("Delete removes the selected q_start", page.evaluate("window.planlab.world.start") is None)
    page.click("#runBtn")
    page.wait_for_timeout(300)
    check("no run without q_start, and the notice asks for it", status(page) == "idle" and page.is_visible("#notice") and "q_start" in page.inner_text("#noticeList"))
    check("the q_start item is highlighted", "attention" in page.get_attribute("#pal-start", "class"))
    page.screenshot(path=str(SHOTS / "02-missing-start.png"))
    drag_item(page, "#pal-start", 8, 12)
    check("q_start placed by dragging it in", page.evaluate("window.planlab.world.start") is not None)
    check("the notice closes", not page.is_visible("#notice"))

    gx, gy = screen_xy(page, 90, 90)
    target = page.locator("#itemsObst").bounding_box()
    page.mouse.move(gx, gy)
    page.mouse.down()
    page.mouse.move(target["x"] + 40, target["y"] + 40, steps=15)
    check("dragging off the workspace shows the remove hint", page.is_visible("#dropHint"))
    page.mouse.up()
    page.wait_for_timeout(150)
    check("dragging q_goal off removes it", len(goals(page)) == 0)
    page.click("#runBtn")
    page.wait_for_timeout(300)
    check("no run without a goal, and the notice asks for one", status(page) == "idle" and "q_goal" in page.inner_text("#noticeList"))

    # ---------------------------------------------------------------- several goals with weights
    drag_item(page, "#pal-region", 88, 88)
    check("a goal region is placed and the notice closes", len(goals(page)) == 1 and not page.is_visible("#notice"))
    drag_item(page, "#pal-goal", 90, 40)
    check("q_goal adds a second goal", len(goals(page)) == 2)
    check("the inspector shows the goal's weight", page.is_visible("#insWeightRow"))
    page.fill("#insWeight", "3")
    page.wait_for_timeout(150)
    check("the weight shows what sample_categorical would do with it", "75%" in page.inner_text("#insProb"), page.inner_text("#insProb"))
    page.fill("#insWeight", "0")
    page.mouse.click(*screen_xy(page, 88, 88))
    page.wait_for_timeout(100)
    page.fill("#insWeight", "0")
    page.wait_for_timeout(150)
    check("weights of 0 don't block a run (only sample_categorical uses them)", page.get_attribute('#checks li[data-c="goal"]', "data-ok") == "1")
    page.click("#runBtn")
    check("RRT reaches one of the two goals", wait_done(page) == "found")
    check("the notice stays closed", not page.is_visible("#notice"))
    page.screenshot(path=str(SHOTS / "03-weighted-goals.png"))

    # ---------------------------------------------------------------- obstacles
    before = page.evaluate("window.planlab.world.obstacles.length")
    drag_item(page, '.item[data-kind="circle"]', 50, 50)
    check("dragging a circle in adds it and clears the run",
          page.evaluate("window.planlab.world.obstacles.length") == before + 1 and page.evaluate("window.planlab.runner") is None)

    # ---------------------------------------------------------------- + New function
    page.click("#newFnA")
    page.wait_for_timeout(150)
    check("+ New function opens the Functions tab and the form", page.is_visible("#newFnForm") and page.is_visible("#edLib"))
    page.fill("#fnName", "2bad")
    page.click('#newFnForm button[type="submit"]')
    check("a bad name is refused with a reason", "starts with a letter" in page.inner_text("#fnMsg"))
    page.fill("#fnName", "wall_margin")
    page.fill("#fnParams", "q, extra")
    page.click('#newFnForm button[type="submit"]')
    page.wait_for_timeout(500)
    lib = page.input_value("#lib")
    check("the outline is added to Functions", "function wall_margin(q, extra)" in lib and "end function" in lib.split("function wall_margin")[1])
    check("the cursor is put inside it", page.evaluate("document.activeElement.id") == "lib")
    check("a Jump to: button appears", "wall_margin()" in page.inner_text("#fnChips"))
    check("still no syntax errors", "code-msg ok" in page.get_attribute("#codeMsg", "class"), page.inner_text("#codeMsg"))
    page.click("#newFn")
    page.fill("#fnName", "wall_margin")
    page.click('#newFnForm button[type="submit"]')
    check("a duplicate name is refused", "already has wall_margin" in page.inner_text("#fnMsg"))
    page.click("#fnCancel")
    page.click("#tabRef")
    page.wait_for_timeout(150)
    check("Reference lists your functions", "wall_margin(q, extra)" in page.inner_text("#ref") and "sample_categorical(items, weights)" in page.inner_text("#ref"))
    page.screenshot(path=str(SHOTS / "04-reference.png"))

    # ---------------------------------------------------------------- Copy a built-in
    page.click("#tabLib")
    page.select_option("#editBuiltin", "steer")
    page.wait_for_timeout(500)
    check("steer() is copied in as pseudocode", "function steer(a, b, step)" in page.input_value("#lib"))
    page.click("#tabRef")
    page.wait_for_timeout(100)
    check("Reference marks the built-in steer as replaced", "replaced by yours" in page.inner_text("#ref").lower())
    page.click("#tabLib")
    page.screenshot(path=str(SHOTS / "05-functions.png"))
    page.click("#tabAlgo")
    page.click("#runBtn")
    check("RRT runs with the pseudocode steer()", wait_done(page) == "found")

    # ---------------------------------------------------------------- stepping over and into functions
    set_code(page, "#code", "x ← steer((0, 0), (10, 0), 3)\ny ← x.x\nreturn y")
    page.click("#tabAlgo")
    page.click("#stepBtn"); page.wait_for_timeout(100)
    page.click("#stepBtn"); page.wait_for_timeout(100)
    where = page.evaluate("({ src: window.planlab.runner.src, line: window.planlab.runner.algoLine })")
    check("on the Algorithm tab, Step line goes over Functions code", where == {"src": "algo", "line": 2}, where)
    page.click("#resetBtn")
    page.click("#tabLib")
    page.click("#stepBtn"); page.wait_for_timeout(100)
    page.click("#stepBtn"); page.wait_for_timeout(100)
    check("on the Functions tab, Step line goes into Functions code", page.evaluate("window.planlab.runner.src") == "lib")
    check("the running line is marked in the Functions editor", page.is_visible("#edLib .line-bar.act"))
    page.click("#resetBtn")

    # ---------------------------------------------------------------- errors
    lib = page.input_value("#lib")
    set_code(page, "#lib", lib.replace("  d ← dist(a, b)", "  d ← dist(a, bb)"))
    page.click("#tabAlgo")
    page.click("#runBtn")
    check("a mistake inside a Functions-tab function stops the run", wait_done(page) == "error")
    check("the error opens the Functions tab and marks the line",
          page.get_attribute("#tabLib", "aria-selected") == "true" and page.is_visible("#edLib .line-bar.err"))
    check("the message names Functions", "Functions" in page.inner_text("#codeMsg"))
    page.screenshot(path=str(SHOTS / "06-error.png"))
    set_code(page, "#lib", lib + "\noops ← 1\n")
    check("a stray line in Functions is a syntax error", "can only hold functions" in page.inner_text("#codeMsg"))
    page.click("#runBtn")
    page.wait_for_timeout(200)
    check("the syntax error blocks the run", status(page) != "running" and "Functions" in page.inner_text("#noticeList"))
    set_code(page, "#lib", lib.split("\n// Move from a toward b")[0] + "\n")
    check("Functions restored without the copied steer()", "function steer" not in page.input_value("#lib"))

    # ---------------------------------------------------------------- editing algorithms and keeping the edits
    page.click("#tabAlgo")
    check("RRT is marked edited after the stepping tests changed it", any("RRT · edited" in o for o in options(page)))
    page.click("#algoRestore")
    page.wait_for_timeout(300)
    check("Restore original brings back the built-in RRT", page.input_value("#code") == page.evaluate("window.planlab.algorithms.rrt.code"))
    check("…and the edited mark goes", not any("edited" in o for o in options(page)) and not page.is_visible("#algoRestore"))

    line = page.locator("#edAlgo .hl .cl").nth(4).bounding_box()   # type into the editor like a person
    page.mouse.click(line["x"] + 60, line["y"] + 10)
    page.keyboard.press("End")
    page.keyboard.type("   // my change")
    page.wait_for_timeout(400)
    check("typing into a built-in algorithm marks it edited", any("RRT · edited" in o for o in options(page)) and page.is_visible("#algoRestore"))
    page.select_option("#algo", "prm")
    page.wait_for_timeout(300)
    page.select_option("#algo", "rrt")
    page.wait_for_timeout(300)
    check("the edit is still there after switching away and back", "// my change" in page.input_value("#code"))
    page.wait_for_timeout(500)
    page.reload()
    page.wait_for_timeout(800)
    check("the edit is still there after reloading the page", "// my change" in page.input_value("#code"))
    page.click("#tabAlgo")
    page.click("#algoRestore")
    page.wait_for_timeout(200)
    page.click("#toastAct")   # Undo
    page.wait_for_timeout(300)
    check("Undo after Restore original brings the edit back", "// my change" in page.input_value("#code"))
    page.click("#algoRestore")
    page.wait_for_timeout(200)

    page.click("#algoCopy")
    check("Save a copy suggests a name", page.input_value("#algoName") == "RRT copy")
    page.fill("#algoName", "rrt")
    page.click("#algoFormOk")
    check("a name already in use is refused", "already an algorithm called" in page.inner_text("#algoFormMsg"))
    page.fill("#algoName", "RRT my version")
    page.click("#algoFormOk")
    page.wait_for_timeout(300)
    current = page.evaluate("window.planlab.currentAlgorithm")
    check("the copy becomes the current algorithm, under My algorithms", current["name"] == "RRT my version" and current["group"] == "My algorithms")
    check("Rename and Delete appear for your own algorithms", page.is_visible("#algoRename") and page.is_visible("#algoDelete"))
    set_code(page, "#code", page.input_value("#code").replace("GOAL_BIAS ← 0.05", "GOAL_BIAS ← 0.5"))
    page.select_option("#algo", "rrt")
    page.wait_for_timeout(300)
    check("editing the copy leaves the built-in RRT unchanged", "GOAL_BIAS ← 0.05" in page.input_value("#code") and not page.is_visible("#algoRestore"))
    page.select_option("#algo", current["id"])
    page.wait_for_timeout(300)
    check("the copy keeps its own edit", "GOAL_BIAS ← 0.5" in page.input_value("#code"))
    page.click("#algoRename")
    page.fill("#algoName", "RRT (my version)")
    page.click("#algoFormOk")
    page.wait_for_timeout(200)
    check("Rename changes the name in the menu", "RRT (my version)" in options(page))
    page.click("#algoDelete")
    page.wait_for_timeout(200)
    check("Delete removes it and goes back to RRT", "RRT (my version)" not in options(page) and page.evaluate("window.planlab.currentAlgorithm.id") == "rrt")
    page.click("#toastAct")   # Undo
    page.wait_for_timeout(300)
    check("Undo after Delete brings it back", page.evaluate("window.planlab.currentAlgorithm.name") == "RRT (my version)")

    page.click("#algoNew")
    page.fill("#algoName", "My planner")
    page.click("#algoFormOk")
    page.wait_for_timeout(300)
    check("+ New starts an algorithm of your own from an outline",
          page.evaluate("window.planlab.currentAlgorithm.name") == "My planner" and "// write the steps here" in page.input_value("#code"))
    page.click("#runBtn")
    check("the outline runs (and reports no path)", wait_done(page) == "nopath")
    page.click("#algoDelete")
    page.wait_for_timeout(200)

    # ---------------------------------------------------------------- editing and replacing built-in functions
    page.click("#tabRef")
    page.wait_for_timeout(200)
    check("Reference offers Edit for built-ins written in pseudocode", page.locator('#ref [data-edit="k_nearest"]').inner_text() == "Edit")
    check("Reference offers Replace for core built-ins", page.locator('#ref [data-edit="is_free"]').inner_text() == "Replace")
    page.locator('#ref [data-edit="is_free"]').click()
    page.wait_for_timeout(500)
    check("Replace adds your own is_free() that calls builtin.is_free", "function is_free(q)" in page.input_value("#lib") and "builtin.is_free(q)" in page.input_value("#lib"))
    page.select_option("#editBuiltin", "k_nearest")
    page.wait_for_timeout(500)
    check("Edit a built-in… adds k_nearest() in pseudocode", "function k_nearest(T, q, k)" in page.input_value("#lib"))
    page.click("#tabRef")
    page.wait_for_timeout(200)
    check("Reference then says Show yours", page.locator('#ref [data-show="is_free"]').count() == 1)
    page.click("#tabAlgo")
    page.select_option("#algo", "rrt")
    page.wait_for_timeout(300)
    page.click("#runBtn")
    check("RRT runs with your is_free() in place", wait_done(page) == "found")
    page.screenshot(path=str(SHOTS / "07-replaced-builtins.png"))
    page.click("#tabLib")
    set_code(page, "#lib", lib.split("\n// Move from a toward b")[0] + "\n")

    # ---------------------------------------------------------------- reward-penalty on the three-region layout
    page.select_option("#preset", "regions")
    page.wait_for_timeout(200)
    page.click("#tabAlgo")
    page.select_option("#algo", "rewardpenalty")
    page.wait_for_timeout(300)
    set_speed(page, 11)
    page.click("#runBtn")
    check("RRT reward-penalty finds a path on the three-region layout", wait_done(page) == "found")
    check("every goal sample has its weight written next to it", page.evaluate("window.planlab.runner.labels.size") >= 9)
    page.screenshot(path=str(SHOTS / "08-reward-penalty.png"))

    # ---------------------------------------------------------------- goal samples for every planner
    def preview_count():
        return len(page.evaluate("window.planlab.goalSamplePreview()"))
    page.click("#resetBtn")
    check("goal samples are shown before a run: 3 per region on the three-region layout", preview_count() == 9)
    page.fill("#goalCount", "5")
    page.wait_for_timeout(200)
    check("5 per region gives 15 samples, and the note says so", preview_count() == 15 and "15 samples" in page.inner_text("#goalNote"))
    page.click("#pickConsecutive")
    page.wait_for_timeout(200)
    check("Consecutive can be chosen", page.get_attribute("#pickConsecutive", "aria-checked") == "true" and page.get_attribute("#pickRandom", "aria-checked") == "false")
    page.select_option("#algo", "star")
    page.wait_for_timeout(300)
    set_speed(page, 11)
    page.click("#runBtn")
    check("RRT* runs with goal samples taken in order", wait_done(page) == "found")
    check("…it used the consecutive choice and the 15 samples",
          page.evaluate("window.planlab.runner.goalChoice") == "consecutive" and page.evaluate("window.planlab.runner.goalSamples.length") == 15
          and page.evaluate("window.planlab.runner.globals.get('goal_turn')") > 0)
    page.screenshot(path=str(SHOTS / "09-goal-samples-consecutive.png"))
    page.wait_for_timeout(500)
    page.reload()
    page.wait_for_timeout(800)
    check("the goal-sample settings are kept after reloading", page.input_value("#goalCount") == "5" and page.get_attribute("#pickConsecutive", "aria-checked") == "true")
    page.fill("#goalCount", "3")
    page.click("#pickRandom")
    page.wait_for_timeout(200)
    check("back to 3 per region, Random", preview_count() == 9 and page.get_attribute("#pickRandom", "aria-checked") == "true")

    # ---------------------------------------------------------------- every algorithm from the menu
    page.select_option("#preset", "blocks")
    page.wait_for_timeout(200)
    page.click("#tabAlgo")
    for algorithm in page.evaluate("Object.keys(window.planlab.algorithms)"):
        page.select_option("#algo", algorithm)
        page.wait_for_timeout(300)
        set_speed(page, 11)
        page.click("#runBtn")
        result = wait_done(page, 90000)
        check(f"{algorithm} from the menu finds a path", result == "found", result)
        if algorithm in ("informed", "bit", "abit", "ait"):   # the informed set stays on the Workspace after the run
            check(f"{algorithm}: the informed set (PHS) is drawn, and the header key gives its c",
                  page.evaluate("window.planlab.informedDrawn") >= 1 and page.is_visible("#informedKey")
                  and page.inner_text("#informedKey").startswith("informed set (PHS) · c = "), page.inner_text("#informedKey"))
        else:
            check(f"{algorithm}: no informed set is drawn", page.evaluate("window.planlab.informedDrawn") == 0 and page.is_hidden("#informedKey"))
        page.screenshot(path=str(SHOTS / f"10-{algorithm}.png"))
    page.select_option("#preset", "regions")   # three goal regions: the informed set is the union of three PHSs
    page.select_option("#algo", "bit")
    page.wait_for_timeout(300)
    set_speed(page, 11)
    page.click("#runBtn")
    check("BIT* on three goal regions finds a path", wait_done(page, 90000) == "found")
    check("…and draws the union of three PHSs", page.evaluate("window.planlab.informedDrawn") == 3
          and page.inner_text("#informedKey").startswith("informed set (3 PHSs) · c = "), page.inner_text("#informedKey"))
    page.screenshot(path=str(SHOTS / "10-bit-regions.png"))
    page.click("#resetBtn")
    page.wait_for_timeout(200)
    check("Reset takes the informed set and its key away", page.evaluate("window.planlab.informedDrawn") == 0 and page.is_hidden("#informedKey"))
    check("no console errors", not errors, errors[:5])
    context.close()

    # ---------------------------------------------------------------- the reward-penalty functions are built-ins
    # They are not in the Functions tab: Edit a built-in… adds one, or all of them, when you pick it.
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(PAGE.as_uri())
    page.wait_for_timeout(800)
    functions = page.input_value("#lib")
    chips = lambda: page.evaluate("document.querySelector('#fnChips').textContent")
    check("the Functions tab starts with only sample_categorical()", "heap_push" not in functions and chips() == "Jump to:sample_categorical()", chips())
    page.click("#tabLib")
    groups = page.eval_on_selector_all("#editBuiltin optgroup", "gs => gs.map(g => [g.label, g.children.length])")
    check("Edit a built-in… lists them under RRT reward-penalty, with an option for all of them",
          ["RRT reward-penalty", 11] in groups and page.locator("#editBuiltin option[value='group:RRT reward-penalty']").count() == 1, groups)
    page.select_option("#editBuiltin", "reward")
    page.wait_for_timeout(400)
    lib = page.input_value("#lib")
    check("picking reward() adds just that function to the Functions tab",
          "function reward(q)" in lib and "function penalize(" not in lib and "Added reward() in pseudocode" in page.inner_text("#toastMsg"))
    page.click("#tabAlgo")
    page.select_option("#preset", "regions")
    page.select_option("#algo", "rewardpenalty")
    page.wait_for_timeout(300)
    message = page.inner_text("#codeMsg")
    check("the line under the editors says your reward() replaces the built-in", "Uses from Functions: reward() (replaces the built-in)" in message, message)
    set_speed(page, 11)
    page.click("#runBtn")
    check("RRT reward-penalty runs with your reward() and the other built-ins", wait_done(page) == "found")
    page.click("#tabLib")
    page.select_option("#editBuiltin", "group:RRT reward-penalty")
    page.wait_for_timeout(400)
    lib = page.input_value("#lib")
    check("All 10 … adds the other 9, without a second reward()",
          all(f"function {n}(" in lib for n in ["heap_swap", "sift_down", "heap_push", "penalize", "resample", "choose_goal_sample"])
          and lib.count("function reward(") == 1 and "Added 9 RRT reward-penalty functions" in page.inner_text("#toastMsg"))
    page.wait_for_timeout(500)
    page.reload()
    page.wait_for_timeout(800)
    check("copies you picked stay after reloading", page.input_value("#lib") == lib)
    page.click("#tabAlgo")
    set_speed(page, 11)
    page.click("#runBtn")
    check("RRT reward-penalty runs with all of them copied to Functions", wait_done(page) == "found")
    check("no console errors with the reward-penalty built-ins", not errors, errors[:5])
    context.close()

    # ---------------------------------------------------------------- Randomise each run
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(PAGE.as_uri())
    page.wait_for_timeout(800)
    page.select_option("#preset", "regions")
    page.wait_for_timeout(200)
    set_speed(page, 11)

    def run_and_seed():
        page.click("#runBtn")
        wait_done(page)
        return page.input_value("#seed"), page.evaluate("window.planlab.runner.seed")
    check("Randomise each run is off at first, next to the seed", not page.is_checked("#seedRandom") and page.is_visible("#seedRandom"))
    first, second = run_and_seed(), run_and_seed()
    check("unticked: every run keeps the seed in the box", first == second == ("177", 177), [first, second])
    preview_before = page.evaluate("window.planlab.goalSamplePreview()")
    page.check("#seedRandom")
    seeds = [run_and_seed() for _ in range(3)]
    check("ticked: every run picks a new seed and shows it in the box",
          all(box == str(used) for box, used in seeds) and len({used for _, used in seeds} | {177}) == 4, seeds)
    check("…the goal samples follow the new seed", page.evaluate("window.planlab.goalSamplePreview()") != preview_before)
    log = page.evaluate("document.querySelector('#boxLog').textContent")
    check("…and the Output says which seed each run used", f"Run started with a new random seed, {seeds[-1][1]}." in log, log[-160:])
    page.click("#resetBtn")
    page.click("#stepBtn")
    page.wait_for_timeout(200)
    check("Step line starting a new run also picks a new seed", page.evaluate("window.planlab.runner.seed") != seeds[-1][1])
    page.wait_for_timeout(500)
    page.reload()
    page.wait_for_timeout(800)
    check("the tick is kept after reloading", page.is_checked("#seedRandom"))
    set_speed(page, 11)
    page.uncheck("#seedRandom")
    kept = page.input_value("#seed")
    again = [run_and_seed() for _ in range(2)]
    check("unticked again: runs repeat the last seed", all(box == kept and str(used) == kept for box, used in again), [kept, again])
    page.screenshot(path=str(SHOTS / "11-randomise-seed.png"))
    check("no console errors with Randomise each run", not errors, errors[:5])
    context.close()

    # ---------------------------------------------------------------- Run repeatedly
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(PAGE.as_uri())
    page.wait_for_timeout(800)
    page.select_option("#preset", "blocks")
    page.select_option("#algo", "rrt")
    page.wait_for_timeout(300)
    set_speed(page, 11)
    log = lambda: page.evaluate("document.querySelector('#boxLog').textContent")
    started = lambda: log().count(" started with ")
    run_status = lambda: page.evaluate("window.planlab.status")
    speed_box, repeat_box = page.locator("label[for=speed]").bounding_box(), page.locator(".repeat-row").bounding_box()
    check("Run repeatedly is a box below the speed, off at first",
          page.is_visible("#runRepeat") and not page.is_checked("#runRepeat") and repeat_box["y"] >= speed_box["y"] + speed_box["height"] - 1)
    page.click("#runBtn")
    page.wait_for_function("window.planlab.status === 'found'", timeout=60000)
    page.check("#runRepeat")   # after a run has ended, without Randomise each run
    check("ticking it also ticks Randomise each run, so every run plans with a new seed",
          page.is_checked("#seedRandom") and "new seed" in page.inner_text("#toastMsg"))
    page.wait_for_function("/next run/.test(document.querySelector('#statusPill').textContent)", timeout=30000)
    check("ticking it starts planning at once, and between runs the status says the next run is coming", True)
    page.wait_for_function("/^([3-9]|\\d\\d) runs/.test(document.querySelector('#repeatStats').textContent)", timeout=60000)
    tally = page.inner_text("#repeatStats")
    seeds = re.findall(r"started with a new random seed, (\d+)", log())
    check("the planner plans again and again, and the tally counts the runs and their paths",
          re.match(r"^\d+ runs · \d+ with a path · best \d+\.\d\d · mean \d+\.\d\d$", tally) is not None, tally)
    check("…every run with a new seed, numbered in the Output", len(seeds) >= 3 and len(set(seeds)) == len(seeds) and "Run 3 started with a new random seed" in log(), seeds)
    page.uncheck("#seedRandom")
    check("unticking Randomise each run while repeating warns that every run will be the same", "same seed every run" in page.inner_text("#repeatStats"))
    page.check("#seedRandom")
    page.uncheck("#runRepeat")
    before = started()
    page.wait_for_timeout(2500)
    check("unticking it lets the current run end and starts no more", started() <= before + 1 and run_status() == "found"
          and page.inner_text("#repeatStats") == "" and "next run" not in page.inner_text("#statusPill"))
    page.check("#runRepeat")
    page.wait_for_function("window.planlab.status === 'found'", timeout=60000)
    check("ticking it again starts a new tally", page.inner_text("#repeatStats").startswith("1 run · "), page.inner_text("#repeatStats"))
    page.click("#resetBtn")
    before = started()
    page.wait_for_timeout(2000)
    check("Reset between two runs stops running repeatedly", started() == before and run_status() == "idle")
    set_speed(page, 5)
    page.click("#runBtn")
    page.wait_for_timeout(400)
    page.click("#runBtn")   # Pause
    page.wait_for_timeout(1500)
    check("Pause stops it too: the run stays paused", run_status() == "paused")
    page.click("#runBtn")   # Resume
    set_speed(page, 11)
    page.wait_for_function("/^[1-9]\\d* runs?/.test(document.querySelector('#repeatStats').textContent)", timeout=60000)
    set_code(page, "#code", page.input_value("#code").replace("STEP ← 4", "STEP ← 5"))
    page.wait_for_timeout(1500)
    check("changing the code clears the run and the tally, and no next run starts", run_status() == "idle"
          and page.inner_text("#repeatStats") == "each run gets a new seed", page.inner_text("#repeatStats"))
    page.wait_for_timeout(500)
    page.reload()
    page.wait_for_timeout(800)
    check("the tick is kept after reloading, without starting a run by itself", page.is_checked("#runRepeat") and run_status() == "idle")
    page.uncheck("#runRepeat")
    page.uncheck("#seedRandom")
    check("no console errors with Run repeatedly", not errors, errors[:5])
    context.close()

    # ---------------------------------------------------------------- resizing the windows with the dividers
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(PAGE.as_uri())
    page.wait_for_timeout(800)

    def size(selector):
        r = page.locator(selector).bounding_box()
        return round(r["width"]), round(r["height"])

    def drag_divider(name, dx=0, dy=0, to_x=None, to_y=None):
        divider = page.locator(f".splitter[data-split='{name}']")
        divider.scroll_into_view_if_needed()
        page.wait_for_timeout(100)
        r = divider.bounding_box()
        x, y = r["x"] + r["width"] / 2, r["y"] + r["height"] / 2
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(to_x if to_x is not None else x + dx, to_y if to_y is not None else y + dy, steps=6)
        page.mouse.up()
        page.wait_for_timeout(300)

    shown = lambda: page.eval_on_selector_all(".splitter", "els => els.filter(e => !e.hidden).map(e => e.dataset.split)")
    check("wide layout: dividers between Workspace | Objects | Pseudocode, and between Pseudocode and Run", shown() == ["ws-obj", "obj-code", "code-run"], shown())
    start = {w: size(f".win-{w}") for w in ("ws", "obj", "code", "run")}
    canvas = size("#ws")
    drag_divider("obj-code", dx=-150)
    check("dragging the Pseudocode/Run divider left widens that column by as much and narrows the Workspace",
          abs(size(".win-code")[0] - start["code"][0] - 150) <= 2 and abs(start["ws"][0] - size(".win-ws")[0] - 150) <= 2 and size(".win-obj") == start["obj"])
    check("…and the Workspace drawing follows its window, still square", size("#ws")[0] < canvas[0] and size("#ws")[0] == size("#ws")[1], [canvas, size("#ws")])
    drag_divider("ws-obj", dx=-60)
    check("the Workspace/Objects divider trades their widths", abs(size(".win-obj")[0] - start["obj"][0] - 60) <= 2)
    code_before, run_before = size(".win-code")[1], size(".win-run")[1]   # Run's height follows its width until you set it
    drag_divider("code-run", dy=-60)
    check("the Pseudocode/Run divider trades their heights", abs(size(".win-run")[1] - run_before - 60) <= 2 and abs(code_before - size(".win-code")[1] - 60) <= 2,
          [(code_before, run_before), size(".win-code"), size(".win-run")])
    run_height = size(".win-run")[1]
    page.focus(".splitter[data-split='code-run']")
    page.keyboard.press("ArrowDown")
    page.keyboard.press("Shift+ArrowDown")
    page.wait_for_timeout(200)
    check("arrow keys move a divider too (16 px, Shift 64 px)", abs(run_height - size(".win-run")[1] - 80) <= 2, [run_height, size(".win-run")])
    drag_divider("obj-code", to_x=5)
    check("windows keep a usable size: the Workspace stops at 320 px, Objects at 160 px",
          abs(size(".win-ws")[0] - 320) <= 1 and abs(size(".win-obj")[0] - 160) <= 1, [size(".win-ws"), size(".win-obj")])
    drag_divider("code-run", to_y=895)
    check("…and Run stops at 190 px high", abs(size(".win-run")[1] - 190) <= 1, size(".win-run"))
    line = page.locator("#edAlgo .hl .cl").nth(1).bounding_box()
    page.mouse.click(line["x"] + 60, line["y"] + line["height"] / 2)
    page.keyboard.press("End")
    page.keyboard.type("   // typed after resizing")
    page.wait_for_timeout(300)
    check("the editor still takes typing after resizing", "// typed after resizing" in page.input_value("#code"))
    page.keyboard.press("Control+z")
    page.click("#algoRestore") if page.is_visible("#algoRestore") else None
    sizes = {w: size(f".win-{w}") for w in ("ws", "obj", "code", "run")}
    page.wait_for_timeout(500)
    page.reload()
    page.wait_for_timeout(800)
    check("the sizes are kept after reloading", {w: size(f".win-{w}") for w in ("ws", "obj", "code", "run")} == sizes)
    for name in ("obj-code", "ws-obj", "code-run"):
        page.dblclick(f".splitter[data-split='{name}']")
    page.wait_for_timeout(300)
    check("double-clicking the dividers brings back the default sizes", {w: size(f".win-{w}") for w in ("ws", "obj", "code", "run")} == start,
          {w: size(f".win-{w}") for w in ("ws", "obj", "code", "run")})
    page.set_viewport_size({"width": 1000, "height": 800})
    page.wait_for_timeout(500)
    check("medium layout: dividers beside Objects, below the Workspace, and between Pseudocode and Run", shown() == ["ws-obj", "code-run", "top-bottom"], shown())
    ws_height = size(".win-ws")[1]
    drag_divider("top-bottom", dy=-100)
    check("the divider below the Workspace sets its height", abs(ws_height - size(".win-ws")[1] - 100) <= 2, [ws_height, size(".win-ws")])
    code_height = size(".win-code")[1]
    drag_divider("code-run", dy=80)
    check("…and the one below Pseudocode sets its height", abs(size(".win-code")[1] - code_height - 80) <= 2, [code_height, size(".win-code")])
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(500)
    check("narrow layout (one column): no dividers", shown() == [], shown())
    check("no console errors while resizing", not errors, errors[:5])
    context.close()

    # ---------------------------------------------------------------- the light/dark switch next to the status
    context = browser.new_context(viewport={"width": 1440, "height": 900}, color_scheme="light")
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(PAGE.as_uri())
    page.wait_for_timeout(700)
    theme = lambda: page.evaluate("document.documentElement.dataset.theme || null")
    switch_on = lambda: page.get_attribute("#themeSwitch", "aria-checked") == "true"
    background = lambda: page.evaluate("getComputedStyle(document.body).backgroundColor")

    def workspace_colour():
        """The colour of an empty spot of the workspace, as drawn on the canvas."""
        x, y = screen_xy(page, 53, 97)
        return page.evaluate("""([x, y]) => { const c = document.querySelector('#ws'), b = c.getBoundingClientRect(), k = c.width / b.width;
          return [...c.getContext('2d').getImageData(Math.round((x - b.left) * k), Math.round((y - b.top) * k), 1, 1).data.slice(0, 3)]; }""", [x, y])

    check("the light/dark switch sits next to the status", page.evaluate("document.querySelector('#statusPill').nextElementSibling.id") == "themeSwitch"
          and page.is_visible("#themeSwitch"))
    check("until it is used, PlanLab follows the system's light setting", theme() is None and not switch_on() and background() == "rgb(230, 233, 236)")
    page.click("#themeSwitch")
    page.wait_for_timeout(300)
    check("the switch turns PlanLab dark", theme() == "dark" and switch_on() and background() == "rgb(13, 17, 21)", background())
    check("the Workspace is redrawn in the dark colours", workspace_colour() == [15, 20, 25], workspace_colour())
    page.reload()
    page.wait_for_timeout(700)
    check("dark is kept after reloading", theme() == "dark" and switch_on() and workspace_colour() == [15, 20, 25])
    page.click("#themeSwitch")
    page.wait_for_timeout(300)
    check("the switch turns PlanLab light again", theme() == "light" and not switch_on() and workspace_colour() == [253, 254, 254], workspace_colour())
    page.emulate_media(color_scheme="dark")
    page.wait_for_timeout(300)
    check("your choice wins over the system's dark setting", theme() == "light" and background() == "rgb(230, 233, 236)")
    page.evaluate("localStorage.clear()")
    page.reload()
    page.wait_for_timeout(700)
    check("without a choice, PlanLab follows the system's dark setting", theme() is None and switch_on() and background() == "rgb(13, 17, 21)")
    check("no errors with the switch", not errors, errors[:3])
    context.close()

    # ---------------------------------------------------------------- layout at different sizes and themes
    for name, (w, h), scheme in [("desktop-dark", (1440, 900), "dark"), ("laptop", (1280, 720), "light"),
                                 ("tablet", (1000, 800), "light"), ("phone", (390, 844), "light"), ("phone-dark", (390, 844), "dark")]:
        context = browser.new_context(viewport={"width": w, "height": h}, color_scheme=scheme)
        page = context.new_page()
        page_errors = []
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        page.goto(PAGE.as_uri())
        page.wait_for_timeout(700)
        page.select_option("#preset", "weighted")
        page.wait_for_timeout(100)
        page.select_option("#algo", "bit")
        page.wait_for_timeout(200)
        set_speed(page, 11)
        page.click("#runBtn")
        wait_done(page)
        overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(f"{name}: no sideways scrolling", overflow <= 0, overflow)
        check(f"{name}: no errors", not page_errors, page_errors[:3])
        page.screenshot(path=str(SHOTS / f"20-{name}.png"), full_page=True)
        context.close()
    browser.close()

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
