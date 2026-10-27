"""Checks the pseudocode language: the built-ins' pseudocode versions (they must give the same answers), sampling
(categorical, goal samples, informed sampling from the PHS), the reward-penalty heap, syntax, and error messages.

    python3 tests/test_language.py          # or add --dist to test dist/planlab.html
"""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / ("dist/planlab.html" if "--dist" in sys.argv else "index.html")
results = []


def check(name, ok, info=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{info}]" if info else ""), flush=True)


with sync_playwright() as p:
    browser = p.firefox.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(PAGE.as_uri())
    page.wait_for_timeout(400)

    def run(algorithm, library=None, seed=177, max_lines=2e7, choice="random", per_region=3):
        options = {"goalChoice": choice, "goalSamplesPerRegion": per_region}
        return page.evaluate("([a, l, s, m, o]) => window.planlab.runSource(a, l, s, m, o)", [algorithm, library, seed, max_lines, options])

    def layout(name):
        page.select_option("#preset", name)
        page.wait_for_timeout(50)

    CODE = page.evaluate("Object.fromEntries(Object.entries(window.planlab.algorithms).map(([k, a]) => [k, a.code]))")
    SNIPPETS = page.evaluate("window.planlab.snippets")
    LIBRARY = page.evaluate("document.querySelector('#lib').value")

    def with_snippet(name):
        """The default Functions tab plus the pseudocode version of one built-in (without defining it twice)."""
        base = "" if f"function {name}(" in LIBRARY else LIBRARY
        return base + "\n" + SNIPPETS[name]

    # 1. Each built-in written in pseudocode can replace the built-in inside real algorithms.
    uses = {"dist": ["rrt", "prm"], "steer": ["rrt", "connect"], "nearest": ["rrt", "lazyrrt"], "near": ["star", "prm"],
            "path": ["rrt", "bit"], "cost": ["star", "bit"], "sample": ["lazyrrt"], "sample_free": ["rrt", "prm"],
            "sample_in": ["prm"], "sample_goal": ["rrt", "star", "connect"], "in_goal": ["rrt", "informed"],
            "sample_informed": ["informed", "bit"], "shortest_path": ["prm", "lazyprm"], "subtree": ["ait"], "reverse": ["connect"]}
    for name, algorithms in uses.items():
        for layout_name in ["blocks", "weighted"]:
            layout(layout_name)
            for a in algorithms:
                r = run(CODE[a], with_snippet(name))
                ok = r["pathPoints"] > 0 and not r["error"] and not r["blocked"]
                check(f"pseudocode {name}() runs {a} on {layout_name}", ok, r["error"] or f"length {r['length'] and round(r['length'], 1)}")

    # ... and gives the same answers as the built-in (rounded where floating point could differ).
    layout("weighted")
    same_answer = {
        "dist_to_goal": "return [round(1000 * dist_to_goal((10, 50))), round(1000 * dist_to_goal((86, 16))), round(1000 * dist_to_goal((50, 95)))]",
        "norm": "return [round(1000 * norm((3, 4))), round(1000 * norm((-1, 2)))]",
        "point": "p ← point(2, 3)\nreturn [p.x, p.y]",
        "sample": "p ← sample()\nreturn [round(1000 * p.x), round(1000 * p.y)]",
        "children": "a ← (1, 1)\nT ← new_tree((0, 0))\nadd_edge(T, root(T), a)\nadd_edge(T, a, (2, 2))\nadd_edge(T, a, (3, 3))\nreturn [length(children(T, a)), length(children(T, root(T)))]",
        "subtree": "a ← (1, 1)\nb ← (2, 2)\nT ← new_tree((0, 0))\nadd_edge(T, root(T), a)\nadd_edge(T, a, b)\nadd_edge(T, b, (3, 3))\nadd_edge(T, root(T), (9, 9))\nreturn [length(subtree(T, a)), length(subtree(T, root(T)))]",
        "k_nearest": "K ← k_nearest([(0, 0), (5, 0), (1, 0), (3, 0)], (0, 0), 3)\nreturn [K[1].x, K[2].x, K[3].x, length(k_nearest([(1, 1)], (0, 0), 3))]",
        "reverse": "return reverse([1, 2, 3])",
        "sum": "return [sum([1, 2, 3.5]), sum([])]",
        "normalize": "return normalize([1, 3])",
        # informed sampling: the same random numbers in the same order, so the very same points
        "sample_unit_ball": "p ← sample_unit_ball()\nq ← sample_unit_ball()\nreturn [round(1000000 * p.x), round(1000000 * p.y), round(1000000 * q.x)]",
        "sample_phs": "p ← sample_phs((10, 20), (70, 60), 90)\nreturn [round(1000000 * p.x), round(1000000 * p.y)]",
        "informed_phs": "P ← informed_phs(95)\nreturn [length(P), P[1][1].x, round(1000 * P[1][2]), round(1000 * P[1][3]), P[2][1].x, round(1000 * P[2][2]), length(informed_phs(80))]",
        "informed_measure": "return [informed_measure(∞), round(informed_measure(95)), round(informed_measure(84))]",
        "sample_informed": "out ← []\nfor i ← 1 to 40 do\n  p ← sample_informed(92)\n  append(out, round(1000 * p.x))\nend for\nreturn out",
    }
    for name, program in same_answer.items():
        native, pseudo = run(program, ""), run(program, SNIPPETS[name])
        check(f"pseudocode {name}() gives the same answer as the built-in", not native["error"] and native["result"] == pseudo["result"],
              f"built-in {native['error'] or native['result']} · pseudocode {pseudo['error'] or pseudo['result']}")

    # Informed sampling covers the union of the goals' PHSs evenly (weighted layout: a goal point and a
    # goal region, so two overlapping PHSs), and every sample could be on a path cheaper than c_best.
    sampled = run("""out ← []
bad ← 0
for i ← 1 to 6000 do
  x ← sample_informed(100)
  if dist(q_start, x) + dist_to_goal(x) ≥ 100 or not is_free(x) then
    bad ← bad + 1
  end if
  append(out, round(100 * x.x))
  append(out, round(100 * x.y))
end for
return [bad] + out""", "")
    values = json.loads(sampled["result"]) if sampled["result"] and sampled["result"].startswith("[") else [None]
    bad, points = values[0], [values[k:k + 2] for k in range(1, len(values), 2)]
    check("every informed sample is free and could be on a path cheaper than c_best", bad == 0, sampled["error"] or bad)
    shares = page.evaluate("""(points) => {
      // what share of the informed set lies only in the goal point's PHS, only in the region's, or in both:
      // from a fine grid, and from the samples
      const w = App.world, col = Geometry.makeCollider(w.obstacles), s = w.start, goals = GoalSamples.goalObjects(w);
      const P = Builtins.table.informed_phs.fn.call({ start: s, goals }, [100], 1);
      const where = (x) => {
        const inside = P.map(([f, c]) => Geometry.distance(s, x) + Geometry.distance(x, f) < c);
        return inside[0] && inside[1] ? 'both' : inside[0] ? 'first' : 'second';
      };
      const grid = { first: 0, second: 0, both: 0 }, got = { first: 0, second: 0, both: 0 };
      let n = 0;
      for (let x = 0.25; x < 100; x += 0.5) for (let y = 0.25; y < 100; y += 0.5) {
        const q = { x, y };
        if (!col.pointFree(q) || Geometry.distance(s, q) + Math.min(...goals.map((g) => Geometry.distanceToGoal(q, g))) >= 100) continue;
        grid[where(q)]++; n++;
      }
      for (const [x, y] of points) got[where({ x: x / 100, y: y / 100 })]++;
      return Object.keys(grid).map((k) => [k, grid[k] / n, got[k] / points.length]);
    }""", points)
    check("…and covers it evenly: the shares in each PHS and in their overlap match the area (±3%)",
          len(points) == 6000 and all(abs(expected - got) < .03 for _, expected, got in shares),
          " ".join(f"{k} {e:.3f}/{g:.3f}" for k, e, g in shares))

    # The Workspace still knows the informed set when sample_informed() is your own pseudocode copy
    # (it calls informed_phs(), which records it for drawing).
    informed_with_copy = page.evaluate("""([src, lib]) => {
      const runner = new Runner(Program.parse(src, lib), App.world, 177, () => {}, {});
      while (runner.linesRun < 2e7 && runner.step()) { /* keep going */ }
      return runner.lastInformed ? [runner.lastInformed.phs.length, Math.round(runner.lastInformed.c)] : null;
    }""", [CODE["informed"], SNIPPETS["sample_informed"]])
    check("with your own sample_informed(), the informed set is still recorded for the Workspace",
          informed_with_copy and informed_with_copy[0] >= 1, informed_with_copy)

    # builtin.name(…) reaches the original even when you have replaced it.
    r = run("return dist((0, 0), (3, 4))", "function dist(a, b) = builtin.dist(a, b) * 2")
    check("builtin.dist(…) calls the original from inside your own dist()", r["result"] == "10", r["error"] or r["result"])
    wrapper = "function collision_free(a, b)\n  result ← builtin.collision_free(a, b)\n  return result\nend function"
    r = run(CODE["rrt"], LIBRARY + "\n" + wrapper)
    check("RRT still finds a path with collision_free() replaced by a wrapper", r["pathPoints"] > 0 and not r["blocked"], r["error"])
    layout("blocks")

    # BIT* prunes to the informed set (the PHS) at every batch, and its radius shrinks with the PHS's area.
    pruning = (CODE["bit"].replace("T ← new_tree(q_start)\n", "pruned ← 0\nradii ← []\nT ← new_tree(q_start)\n", 1)
               .replace("    prune()\n", """    before ← size(T)
    prune()
    pruned ← pruned + before - size(T)
    for each v in T do
      if f_hat(v) > c_best then
        return "a vertex outside the PHS"
      end if
    end for
    for each x in X_samples do
      if f_hat(x) ≥ c_best then
        return "a sample outside the PHS"
      end if
    end for
""", 1).replace("    r ← radius(size(T) + size(X_samples))\n", "    r ← radius(size(T) + size(X_samples))\n    append(radii, round(r))\n", 1)
               .replace("if q_best ≠ failure then\n  return path(T, q_best)", "if q_best ≠ failure then\n  return [pruned] + radii", 1))
    layout("blocks")
    r = run(pruning, "")
    result = json.loads(r["result"]) if r["result"] and r["result"].startswith("[") else None
    check("BIT* pruning leaves no vertex or sample outside the PHS, and prunes some vertices",
          pruning.count("pruned ←") == 2 and result and result[0] > 0, r["error"] or r["result"])
    radii = result[1:] if result else []
    check("…and its radius shrinks once the PHS is smaller than the workspace", len(radii) > 1 and radii[-1] < radii[0], radii)

    # 2. Categorical sampling picks items in proportion to their weights.
    counting = "counts ← [0, 0, 0]\nfor i ← 1 to 6000 do\n  k ← sample_categorical([1, 2, 3], [1, 3, 0])\n  counts[k] ← counts[k] + 1\nend for\nreturn counts"
    for label, library in [("pseudocode version", LIBRARY), ("built-in version", "")]:
        r = run(counting, library)
        counts = json.loads(r["result"]) if r["result"] and r["result"].startswith("[") else None
        check(f"categorical sampling ({label}) ≈ 25% / 75% / 0%",
              counts and abs(counts[0] / 6000 - .25) < .03 and abs(counts[1] / 6000 - .75) < .03 and counts[2] == 0, counts or r)
    layout("weighted")   # one goal point with weight 1, one goal region with weight 3
    share = "n ← 0\nfor i ← 1 to 4000 do\n  q ← PICK\n  if q.y < 40 then\n    n ← n + 1\n  end if\nend for\nreturn n / 4000"
    # sample_goal() picks one of the goal samples (here the goal point and 3 samples in the region)
    which = """out ← []
for i ← 1 to N do
  q ← sample_goal()
  for j ← 1 to length(goal_samples) do
    if goal_samples[j] = q then
      append(out, j)
      break
    end if
  end for
end for
return out"""
    for label, library in [("built-in", ""), ("pseudocode", SNIPPETS["sample_goal"])]:
        r = run(which.replace("N", "4000", 1), library)
        picks = json.loads(r["result"]) if r["result"] and r["result"].startswith("[") else []
        shares = [picks.count(j) / 4000 for j in (1, 2, 3, 4)]
        check(f"random sample_goal() ({label}) picks each of the 4 goal samples ≈ 25%, ignoring weights",
              len(picks) == 4000 and all(abs(x - .25) < .03 for x in shares), r["error"] or shares)
        r = run(which.replace("N", "10", 1), library, choice="consecutive")
        check(f"consecutive sample_goal() ({label}) takes the goal samples in order", r["result"] == "[1,2,3,4,1,2,3,4,1,2]", r["error"] or r["result"])
    native, pseudo = run(which.replace("N", "30", 1), ""), run(which.replace("N", "30", 1), SNIPPETS["sample_goal"])
    check("random sample_goal(): the pseudocode version picks exactly like the built-in", native["result"] == pseudo["result"] and not native["error"],
          native["error"] or pseudo["error"])
    r = run("return [length(goal_samples), length(goals)]", "", per_region=5)
    check("5 goal samples per region on the weighted layout gives 6 samples (point + 5)", r["result"] == "[6,2]", r["error"] or r["result"])
    r = run(share.replace("PICK", "sample_in(sample_categorical(goals, goal_weights))"), LIBRARY)
    check("sample_categorical(goals, goal_weights) still picks the weight-3 region ≈ 75%", r["result"] and abs(float(r["result"]) - .75) < .03, r["error"] or r["result"])
    weighted_rrt = CODE["rrt"].replace("q_rand ← sample_goal()", "q_rand ← sample_in(sample_categorical(goals, goal_weights))", 1)
    check("RRT can be switched to weighted goals with one line", weighted_rrt != CODE["rrt"])
    for label, library in [("pseudocode", LIBRARY), ("built-in", "")]:
        r = run(weighted_rrt, library)
        check(f"RRT with sample_categorical ({label}) finds a path", r["pathPoints"] > 0 and not r["error"] and not r["blocked"], r["error"])

    # No algorithm picks goals by categorical sampling: a sample_categorical() that fails if called is never reached.
    trap = LIBRARY.replace("function sample_categorical(items, weights)\n", "function sample_categorical(items, weights)\n  return categorical_sampling_was_called()\n", 1)
    check("the trap is in place", trap != LIBRARY)
    for name, code in CODE.items():
        r = run(code, trap)
        check(f"{name} never calls sample_categorical", not r["error"] and r["pathPoints"] > 0, r["error"])
    layout("blocks")

    # 3. Reward-penalty (Hernández et al. 2019): the binary max heap, the formulas, and resampling.
    #    The algorithm keeps the settings and the heap's variables; its functions are built-ins written in pseudocode.
    rp_names = ["heap_swap", "sift_up", "sift_down", "heap_push", "heap_set_weight", "reward", "penalize",
                "sample_goal_regions", "resample", "choose_goal_sample"]
    PSEUDOCODE = page.evaluate("Object.fromEntries(Object.values(window.planlab.builtins).filter(b => b.pseudocode).map(b => [b.name, b.pseudocode]))")
    check("the reward-penalty functions are built-ins written in pseudocode, not in the algorithm or the Functions tab",
          sorted(PSEUDOCODE) == sorted(rp_names) and "function " not in CODE["rewardpenalty"] and "heap_push" not in LIBRARY, sorted(PSEUDOCODE))
    check("each one's pseudocode (for Edit) is its comment and function, without the section headings",
          PSEUDOCODE["heap_swap"].startswith("// swap two heap entries") and PSEUDOCODE["heap_swap"].endswith("end function\n")
          and PSEUDOCODE["sample_goal_regions"].startswith("// More goal samples") and all("// ----" not in t for t in PSEUDOCODE.values()))
    r = run(CODE["rewardpenalty"], "")
    check("RRT reward-penalty runs with an empty Functions tab", not r["error"] and r["pathPoints"] > 0, r["error"])
    rp_functions = CODE["rewardpenalty"].split("T ← new_tree(q_start)")[0] + "\nturn ← 0\n"
    counting = PSEUDOCODE["heap_swap"].replace("  a ← heap[i]\n", "  global swaps\n  swaps ← swaps + 1\n  a ← heap[i]\n", 1)
    r = run("swaps ← 0\n" + rp_functions + "for i ← 1 to 20 do\n  heap_push((i, i), i / 20)\nend for\nreturn swaps", counting)
    check("your copy of heap_swap() in Functions is used by the built-in heap_push() too",
          counting != PSEUDOCODE["heap_swap"] and not r["error"] and r["result"] not in (None, "0"), r["error"] or r["result"])
    r = run(rp_functions + "q ← (1, 1)\nheap_push(q, 0.5)\nx ← reward(q)\nbuiltin.reward(q)\nreturn [x, weight[q]]",
            "function reward(q)\n  return 99\nend function")
    check("builtin.reward(…) reaches the built-in when you have your own reward()", r["result"] == "[99,1]", r["error"] or r["result"])
    r = run("x ← 1\nheap_set_weight((1, 1), 0.5)", "")
    check("an error inside one of them is reported at the line that called it",
          r["error"] and r["error"].startswith("algo:2: heap_set_weight(): 'weight'"), r["error"])
    heap_check = rp_functions + """
for i ← 1 to 40 do
  heap_push((random(0, 100), random(0, 100)), random())
end for
for step ← 1 to 1500 do
  q ← heap[floor(random() * length(heap)) + 1]
  if random() < 0.5 then
    reward(q)
  else
    penalize(q)
  end if
  if step mod 300 = 0 then
    heap_push((random(0, 100), random(0, 100)), random())
  end if
  best ← 0
  for i ← 1 to length(heap) do
    if i > 1 and weight[heap[i]] > weight[heap[floor(i / 2)]] then
      return "heap order broken"
    end if
    if slot[heap[i]] ≠ i then
      return "slot map broken"
    end if
    best ← max(best, weight[heap[i]])
  end for
  if weight[heap[1]] ≠ best then
    return "the top is not the largest weight"
  end if
end for
return "ok"
"""
    for seed in (1, 2):
        r = run(heap_check, LIBRARY, seed)
        check(f"reward-penalty heap stays a valid max heap through 1500 rewards and penalties (seed {seed})", r["result"] == '"ok"', r["error"] or r["result"])
    formulas = rp_functions + """
q ← (1, 1)
heap_push(q, 1.0)
out ← []
for each act in ["p", "p", "r", "r", "r"] do
  if act = "p" then
    penalize(q)
  else
    reward(q)
  end if
  append(out, round(1000 * weight[q]))
end for
return out
"""
    r = run(formulas, LIBRARY)
    check("penalty w/(w+1) and reward w/(1−w): 1 → 0.5 → 0.333 → 0.5 → 1 → 1", r["result"] == "[500,333,500,1000,1000]", r["error"] or r["result"])
    layout("regions")
    resampling = rp_functions + """
for each q in goal_samples do
  heap_push(q, 1.0)
end for
n_before ← length(heap)
q ← heap[1]
while weight[q] > W_MIN do
  penalize(q)
end while
old ← to_list(slot)
resample()
not_half ← 0
for each s in old do
  if weight[s] ≠ 0.5 then
    not_half ← not_half + 1
  end if
end for
return [n_before, length(heap), weight[heap[1]], not_half]
"""
    r = run(resampling, LIBRARY)
    check("resampling: old samples go to 0.5, new ones join at 1.0 on top (9 → 15 samples)", r["result"] == "[9,15,1,0]", r["error"] or r["result"])
    for strategy in ("reward-penalty", "consecutive", "random"):
        code = CODE["rewardpenalty"].replace('STRATEGY ← "reward-penalty"', f'STRATEGY ← "{strategy}"')
        runs = [run(code, LIBRARY, seed) for seed in (177, 3, 42)]
        check(f"RRT reward-penalty with STRATEGY \"{strategy}\" finds paths on the three-region layout",
              all(x["pathPoints"] > 0 and not x["blocked"] and not x["error"] for x in runs), [x["error"] for x in runs])
    layout("blocks")

    # 4. Language features: (code, expected result)
    cases = [
        ("(a, b) ← (3, 4)\nreturn a + b", "7"),
        ("(a, b) ← [10, 20]\n(a, b) ← (b, a)\nreturn a", "20"),
        ("function sq(x) = x * x\nreturn sq(7)", "49"),
        ("S ← new_set([1, 2])\nadd(S, 5)\nremove(S, 1)\nif 5 in S and 1 ∉ S then\n  return size(S)\nend if\nreturn -1", "2"),
        ("M ← new_map(∞)\nM[3] ← 2\nif M[4] = ∞ then\n  return M[3]\nend if\nreturn -1", "2"),
        ("Q ← new_queue()\npush(Q, 'b', [2, 5])\npush(Q, 'a', [1, 9])\npush(Q, 'c', [2, 1])\nreturn pop_min(Q) + pop_min(Q) + pop_min(Q)", '"acb"'),
        ("x ← 1\nfunction bump()\n  global x\n  x ← x + 1\nend function\nbump()\nbump()\nreturn x", "3"),
        ("x ← 1\nfunction local_only()\n  x ← 99\n  return x\nend function\ny ← local_only()\nreturn x + y", "100"),
        ("L ← [1, 2, 3]\nreturn 2 ∉ L or 4 not in L", "true"),
        ("total ← 0\nfor i ← 1 to 10 do\n  if i mod 2 = 0 then\n    continue\n  end if\n  if i > 7 then\n    break\n  end if\n  total ← total + i\nend for\nreturn total", "16"),
        ("function f(n)\n  if n ≤ 1 then\n    return 1\n  end if\n  return n * f(n - 1)\nend function\nreturn f(6)", "720"),
        ("i ← 0\nrepeat\n  i ← i + 1\n  if i = 2 then\n    continue\n  end if\nuntil i ≥ 4\nreturn i", "4"),
    ]
    for code, expected in cases:
        r = run(code, "")
        check(f"language: {code.splitlines()[-1][:40]}", not r["error"] and r["result"] == expected, r["error"] or r["result"])

    # 5. Errors point at the right editor and line.
    r = run("x ← broken(1)", "function broken(a)\n  return a + q_rnd\nend function")
    check("a runtime error inside a Functions-tab function points at Functions, line 2", r["error"] and r["error"].startswith("lib:2:"), r["error"])
    for source, library, expected in [("x ← 1", "y ← 2", "can only hold functions"), ("if x then", "", "missing its 'end'")]:
        try:
            page.evaluate("([a, l]) => window.planlab.parse(a, l)", [source, library])
            check(f"syntax error reported: {expected}", False)
        except Exception as e:
            check(f"syntax error reported: {expected}", expected in str(e), str(e)[:80])
    check("no page errors", not errors, errors[:3])
    browser.close()

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
