"""Runs every algorithm on every layout with several seeds, without drawing, and checks each finds a valid path.

    python3 tests/test_algorithms.py                    # everything
    python3 tests/test_algorithms.py rrt,bit maze       # some algorithms, some layouts
    python3 tests/test_algorithms.py --dist             # test dist/planlab.html instead of index.html
"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
args = [a for a in sys.argv[1:] if a != "--dist"]
PAGE = ROOT / ("dist/planlab.html" if "--dist" in sys.argv else "index.html")
ALGORITHMS = args[0].split(",") if len(args) > 0 and args[0] else None
LAYOUTS = args[1].split(",") if len(args) > 1 else ["blocks", "passage", "trap", "maze", "weighted"]
SEEDS = [177, 3, 42]
MAX_LINES = 1e7

# The shortest path from q_start to a goal point, or to any point of a goal region (a grid over it):
# Dijkstra over a visibility graph of the obstacle corners, pushed out a little so they are free.
SHORTEST = """() => {
  const w = App.world, col = Geometry.makeCollider(w.obstacles);
  const nodes = [{ x: w.start.x, y: w.start.y }];
  for (const o of w.obstacles) {
    const poly = Geometry.polygonOf(o), cx = poly.reduce((s, p) => s + p.x, 0) / poly.length, cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
    for (const p of poly) for (const eps of [0.05, 0.3]) {
      const dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy) || 1, q = { x: p.x + dx / d * eps, y: p.y + dy / d * eps };
      if (col.pointFree(q)) nodes.push(q);
    }
  }
  const first = nodes.length;
  for (const g of w.goals) {
    if (g.kind === 'point') { nodes.push({ x: g.x, y: g.y }); continue; }
    for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) {
      const q = { x: g.x - g.w / 2 + g.w * i / 12, y: g.y - g.h / 2 + g.h * j / 12 };
      if (col.pointFree(q)) nodes.push(q);
    }
  }
  const dist = nodes.map(() => Infinity), done = nodes.map(() => false);
  dist[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < nodes.length; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0) break;
    done[u] = true;
    for (let v = 0; v < nodes.length; v++) {
      const c = dist[u] + Math.hypot(nodes[u].x - nodes[v].x, nodes[u].y - nodes[v].y);
      if (!done[v] && c < dist[v] && col.segmentFree(nodes[u], nodes[v])) dist[v] = c;
    }
  }
  return Math.min(...dist.slice(first));
}"""

with sync_playwright() as p:
    browser = p.firefox.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(PAGE.as_uri())
    page.wait_for_timeout(500)
    ids = ALGORITHMS or page.evaluate("Object.keys(window.planlab.algorithms)")
    failures = 0
    for layout in LAYOUTS:
        page.select_option("#preset", layout)
        page.wait_for_timeout(100)
        for algorithm in ids:
            cells = []
            for seed in SEEDS:
                r = page.evaluate("([id, seed, max]) => { const w = window.planlab; return w.runSource(w.algorithms[id].code, null, seed, max); }",
                                  [algorithm, seed, MAX_LINES])
                ok = r["pathPoints"] > 0 and not r["error"] and not r["blocked"]
                failures += not ok
                outcome = f"{r['length']:.1f}" if r["pathPoints"] else ("ERROR " + r["error"] if r["error"] else "no path")
                cells.append(f"seed {seed}: {outcome}, {r['lines'] // 1000}k lines, {r['ms'] / 1000:.1f}s" + ("" if ok else "  <-- FAIL"))
            print(f"{layout:9s} {algorithm:9s} | " + " | ".join(cells), flush=True)
    # The same with goal samples taken in order (Objects → Goal samples → Consecutive)
    if len(args) < 2:
        for layout in ["blocks", "maze", "weighted"]:
            page.select_option("#preset", layout)
            page.wait_for_timeout(100)
            for algorithm in ids:
                cells = []
                for seed in SEEDS:
                    r = page.evaluate("([id, seed, max]) => { const w = window.planlab; return w.runSource(w.algorithms[id].code, null, seed, max, { goalChoice: 'consecutive', goalSamplesPerRegion: 3 }); }",
                                      [algorithm, seed, MAX_LINES])
                    ok = r["pathPoints"] > 0 and not r["error"] and not r["blocked"]
                    failures += not ok
                    outcome = f"{r['length']:.1f}" if r["pathPoints"] else ("ERROR " + r["error"] if r["error"] else "no path")
                    cells.append(f"seed {seed}: {outcome}, {r['lines'] // 1000}k lines" + ("" if ok else "  <-- FAIL"))
                print(f"{layout + ' seq':13s} {algorithm:9s} | " + " | ".join(cells), flush=True)

    # Layouts with several goal regions, some unreachable: only for algorithms that aim at every goal
    # (the others commit to one sampled goal, which may be the unreachable one). Seed 7 once made the
    # batch planners pick a goal sample in the walled-in region.
    if len(args) < 2:
        page.select_option("#preset", "regions")
        page.wait_for_timeout(100)
        for algorithm in [a for a in ["rrt", "rewardpenalty", "star", "informed", "lazyrrt", "bit", "abit", "ait"] if a in ids]:
            cells = []
            for seed in SEEDS + [7]:
                r = page.evaluate("([id, seed, max]) => { const w = window.planlab; return w.runSource(w.algorithms[id].code, null, seed, max); }",
                                  [algorithm, seed, MAX_LINES])
                ok = r["pathPoints"] > 0 and not r["error"] and not r["blocked"]
                failures += not ok
                outcome = f"{r['length']:.1f}" if r["pathPoints"] else ("ERROR " + r["error"] if r["error"] else "no path")
                cells.append(f"seed {seed}: {outcome}, {r['lines'] // 1000}k lines" + ("" if ok else "  <-- FAIL"))
            print(f"{'regions':9s} {algorithm:9s} | " + " | ".join(cells), flush=True)

    # The informed planners against the shortest possible path (a visibility graph over the obstacle
    # corners, to a goal point or anywhere in a goal region): within 8% after their default batches.
    if len(args) < 2:
        print("\nInformed planners: cost / shortest possible")
        for layout in ["blocks", "passage", "weighted", "regions"]:
            page.select_option("#preset", layout)
            page.wait_for_timeout(100)
            best = page.evaluate(SHORTEST)
            for algorithm in [a for a in ["informed", "bit", "abit", "ait"] if a in ids]:
                cells = []
                for seed in SEEDS:
                    r = page.evaluate("([id, seed, max]) => { const w = window.planlab; return w.runSource(w.algorithms[id].code, null, seed, max); }",
                                      [algorithm, seed, MAX_LINES])
                    ok = r["pathPoints"] > 0 and not r["error"] and r["length"] <= 1.08 * best
                    failures += not ok
                    cells.append(f"seed {seed}: {r['length'] / best:.3f}" if r["pathPoints"] else f"seed {seed}: {r['error'] or 'no path'}")
                    cells[-1] += "" if ok else "  <-- FAIL"
                print(f"{layout:9s} {algorithm:9s} | shortest {best:.1f} | " + " | ".join(cells), flush=True)
    browser.close()

print("page errors:", errors or "none")
print("FAILED:" if failures else "All runs found a valid path.", failures or "")
sys.exit(1 if failures or errors else 0)
