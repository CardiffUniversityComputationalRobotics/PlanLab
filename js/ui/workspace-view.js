/* workspace-view.js — window 1: sizing the canvas, converting coordinates, and drawing everything.
 *
 * Drawing order (back to front): grid · goal regions · obstacles · informed set (PHSs) · samples ·
 * trees and graphs · labels · last steer / blocked edge / newest edge · candidate paths · point variables ·
 * goal samples · final path · goal points · q_start · selection handles.
 * Colours come from the CSS tokens in theme.css, so the canvas follows light and dark mode.
 */
const WorkspaceView = (() => {
  'use strict';
  const { $, fixed } = Util;
  const { WIDTH: W, HEIGHT: H } = World;
  const { Tree, PseudoSet, isPoint, edgeKey, equal } = Values;
  const { polygonOf, distance } = Geometry;

  const canvas = $('#ws'), frame = $('#wsFrame'), body = $('#wsBody');
  const ctx = canvas.getContext('2d');

  /* ================================================================ size and coordinates */
  const PAD = { left: 30, right: 10, top: 10, bottom: 24 };   // room for the axis numbers
  const view = { size: 0, dpr: 1, scale: 1, originX: 0, originY: 0 };
  /** Workspace x, y → canvas pixels (y points up in the workspace, down on the canvas). */
  const X = (x) => view.originX + x * view.scale;
  const Y = (y) => view.originY - y * view.scale;

  /** Makes the canvas the largest square that fits (on phones: the full width). */
  function layout() {
    const stacked = matchMedia('(max-width: 860px)').matches;
    const cs = getComputedStyle(body);
    const availableW = body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availableH = body.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const size = Math.max(200, Math.floor(stacked ? availableW : Math.min(availableW, availableH)));
    const dpr = window.devicePixelRatio || 1;
    if (size === view.size && dpr === view.dpr) return;
    view.size = size;
    view.dpr = dpr;
    frame.style.width = frame.style.height = size + 'px';
    canvas.width = canvas.height = Math.round(size * dpr);
    view.scale = Math.min((size - PAD.left - PAD.right) / W, (size - PAD.top - PAD.bottom) / H);
    view.originX = PAD.left;
    view.originY = PAD.top + H * view.scale;
    draw();
  }

  /** Mouse position → workspace coordinates. */
  function toWorld(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return { x: (clientX - r.left - view.originX) / view.scale, y: (view.originY - (clientY - r.top)) / view.scale };
  }

  function isOverCanvas(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  /* ================================================================ colours */
  let C = null;
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const token = (name) => cs.getPropertyValue(name).trim();
    C = {
      canvas: token('--canvas'), grid: token('--grid'), gridStrong: token('--grid-strong'), ink: token('--ink'), muted: token('--muted'),
      accent: token('--accent'), tree2: token('--tree2'), start: token('--start'), goal: token('--goal'), path: token('--path'),
      obst: token('--obst'), hatch: token('--obst-hatch'), obstEdge: token('--obst-edge'), region: token('--region'),
      bad: token('--bad'), sample: token('--sample'), font: token('--font-code'),
      informed: token('--informed'), informedFill: token('--informed-fill'),
    };
  }

  /* ================================================================ selection handles */

  /** The resize handles (corners) and rotate handle of the selected object, in workspace coordinates. */
  function handlesFor(selection) {
    const o = WorldActions.objectOf(selection);
    if (!o) return [];
    const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    if (selection.kind === 'obstacle') {
      const c = Math.cos(o.a), s = Math.sin(o.a);
      const toWorkspace = (lx, ly) => ({ x: o.x + lx * c - ly * s, y: o.y + lx * s + ly * c });
      const handles = corners.map(([sx, sy]) => ({ type: 'resize', sx, sy, ...toWorkspace(sx * o.w / 2, sy * o.h / 2) }));
      handles.push({ type: 'rotate', ...toWorkspace(0, o.h / 2 + 18 / view.scale), base: toWorkspace(0, o.h / 2) });
      return handles;
    }
    if (selection.kind === 'goal' && o.kind === 'region') {
      return corners.map(([sx, sy]) => ({ type: 'resize', sx, sy, x: o.x + sx * o.w / 2, y: o.y + sy * o.h / 2 }));
    }
    return [];
  }

  /* ================================================================ drawing helpers */
  let drawQueued = false;
  /** Draws on the next animation frame (several requests in one frame draw once). */
  function requestDraw() {
    if (!drawQueued) { drawQueued = true; requestAnimationFrame(draw); }
  }

  function tracePolygon(points) {
    ctx.beginPath();
    points.forEach((p, k) => (k ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
    ctx.closePath();
  }

  function tracePath(points) {
    ctx.beginPath();
    points.forEach((p, k) => (k ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
  }

  /** Text with a halo, dx pixels right of (x, y); flipped to the left near the right edge. */
  function label(text, x, y, color, dx) {
    ctx.font = `600 11px ${C.font}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    let tx = x + dx;
    if (tx + ctx.measureText(text).width > view.size - 2) { tx = x - dx; ctx.textAlign = 'right'; }
    ctx.lineWidth = 3; ctx.strokeStyle = C.canvas; ctx.strokeText(text, tx, y);
    ctx.fillStyle = color; ctx.fillText(text, tx, y);
  }

  /** "q_goal" when there is one goal; "goal 2" when there are several, plus "· w 3" when its weight isn't 1. */
  function goalLabel(goal) {
    const goals = App.world.goals;
    const weight = goal.weight === 1 ? '' : ` · w ${goal.weight}`;
    if (goals.length === 1) return (goal.kind === 'region' ? 'goal region' : 'q_goal') + weight;
    return `goal ${goals.indexOf(goal) + 1}${weight}`;
  }

  /** Is this object the one being dragged off (so drawn faded)? */
  function isFading(kind, id) {
    const t = App.draggingOff;
    return !!t && t.kind === kind && (kind === 'start' || t.id === id);
  }

  /* ================================================================ drawing the workspace */
  function drawGrid() {
    const s = view.scale;
    ctx.fillStyle = C.canvas;
    ctx.fillRect(X(0), Y(H), W * s, H * s);
    ctx.lineWidth = 1; ctx.strokeStyle = C.grid;
    ctx.beginPath();
    for (let g = 10; g < W; g += 10) { ctx.moveTo(Math.round(X(g)) + .5, Y(0)); ctx.lineTo(Math.round(X(g)) + .5, Y(H)); }
    for (let g = 10; g < H; g += 10) { ctx.moveTo(X(0), Math.round(Y(g)) + .5); ctx.lineTo(X(W), Math.round(Y(g)) + .5); }
    ctx.stroke();
    ctx.font = `500 10px ${C.font}`; ctx.fillStyle = C.muted;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let g = 0; g <= W; g += 20) ctx.fillText(String(g), X(g), Y(0) + 6);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let g = 0; g <= H; g += 20) ctx.fillText(String(g), X(0) - 6, Y(g));
  }

  function drawRegion(r) {
    ctx.globalAlpha = isFading('goal', r.id) ? .3 : 1;
    const x0 = X(r.x - r.w / 2), y0 = Y(r.y + r.h / 2), w = r.w * view.scale, h = r.h * view.scale;
    ctx.fillStyle = C.region; ctx.fillRect(x0, y0, w, h);
    ctx.setLineDash([5, 4]); ctx.lineWidth = 1.6; ctx.strokeStyle = C.goal; ctx.strokeRect(x0, y0, w, h); ctx.setLineDash([]);
    ctx.font = `600 10px ${C.font}`; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = C.goal;
    const text = goalLabel(r);
    if (ctx.measureText(text).width + 8 < w) ctx.fillText(text, x0 + 4, y0 + 4);
    ctx.globalAlpha = 1;
  }

  function drawObstacle(o) {
    const poly = polygonOf(o);
    ctx.globalAlpha = isFading('obstacle', o.id) ? .3 : 1;
    ctx.save();
    tracePolygon(poly); ctx.fillStyle = C.obst; ctx.fill(); ctx.clip();
    // diagonal hatching, clipped to the outline
    const xs = poly.map((p) => X(p.x)), ys = poly.map((p) => Y(p.y));
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    ctx.strokeStyle = C.hatch; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = x0 - (y1 - y0); k < x1; k += 7) { ctx.moveTo(k, y1); ctx.lineTo(k + (y1 - y0), y0); }
    ctx.stroke();
    ctx.restore();
    tracePolygon(poly); ctx.lineWidth = 1.2; ctx.strokeStyle = C.obstEdge; ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawGoalPoint(g) {
    ctx.globalAlpha = isFading('goal', g.id) ? .3 : 1;
    const x = X(g.x), y = Y(g.y);
    ctx.lineWidth = 2.2; ctx.strokeStyle = C.goal;
    ctx.beginPath(); ctx.arc(x, y, 8, 0, 2 * Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 3, 0, 2 * Math.PI); ctx.fillStyle = C.goal; ctx.fill();
    ctx.beginPath();   // cross-hair ticks
    ctx.moveTo(x - 12, y); ctx.lineTo(x - 9, y); ctx.moveTo(x + 9, y); ctx.lineTo(x + 12, y);
    ctx.moveTo(x, y - 12); ctx.lineTo(x, y - 9); ctx.moveTo(x, y + 9); ctx.lineTo(x, y + 12);
    ctx.stroke();
    label(goalLabel(g), x, y + 1, C.goal, 15);
    ctx.globalAlpha = 1;
  }

  function drawStart(p) {
    ctx.globalAlpha = isFading('start') ? .3 : 1;
    ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 7, 0, 2 * Math.PI);
    ctx.fillStyle = C.start; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = C.canvas; ctx.stroke();
    label('q_start', X(p.x), Y(p.y) + 1, C.start, 11);
    ctx.globalAlpha = 1;
  }

  function drawSelection() {
    const sel = App.selection, o = WorldActions.objectOf(sel);
    if (!o) return;
    ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    if (sel.kind === 'obstacle') { tracePolygon(polygonOf(o)); ctx.stroke(); }
    else if (sel.kind === 'goal' && o.kind === 'region') {
      ctx.strokeRect(X(o.x - o.w / 2) - 3, Y(o.y + o.h / 2) - 3, o.w * view.scale + 6, o.h * view.scale + 6);
    } else { ctx.beginPath(); ctx.arc(X(o.x), Y(o.y), 14, 0, 2 * Math.PI); ctx.stroke(); }
    ctx.setLineDash([]);
    for (const h of handlesFor(sel)) {
      ctx.fillStyle = C.canvas;
      if (h.type === 'rotate') {
        ctx.beginPath(); ctx.moveTo(X(h.base.x), Y(h.base.y)); ctx.lineTo(X(h.x), Y(h.y)); ctx.stroke();
        ctx.beginPath(); ctx.arc(X(h.x), Y(h.y), 5.5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      } else {
        ctx.fillRect(X(h.x) - 4.5, Y(h.y) - 4.5, 9, 9); ctx.strokeRect(X(h.x) - 4.5, Y(h.y) - 4.5, 9, 9);
      }
    }
  }

  /* ================================================================ drawing a run */
  function strokeEdges(edges, color, dashed) {
    if (!edges.length) return;
    ctx.strokeStyle = color; ctx.lineWidth = dashed ? 1 : 1.15; ctx.globalAlpha = dashed ? .6 : 1;
    if (dashed) ctx.setLineDash([3, 3]);
    ctx.beginPath();
    for (const [a, b] of edges) { ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(b.x), Y(b.y)); }
    ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  /** A tree or graph. Trees rooted at q_start use the accent colour, other trees the second colour.
   *  Edges never checked with collision_free() are dashed. */
  function drawStructure(runner, structure) {
    const forward = !(structure instanceof Tree) || (runner.start && equal(structure.root, runner.start));
    const color = forward ? C.accent : C.tree2;
    const checked = [], unchecked = [];
    for (const edge of structure.edges()) (runner.checkedEdges.has(edgeKey(edge[0], edge[1])) ? checked : unchecked).push(edge);
    strokeEdges(unchecked, color, true);
    strokeEdges(checked, color, false);
    if (structure.vertices.length < 6000) {
      ctx.fillStyle = color;
      for (const v of structure.vertices) ctx.fillRect(X(v.x) - 1.4, Y(v.y) - 1.4, 2.8, 2.8);
    }
  }

  /** The ellipse of a PHS with foci s and f and transverse diameter c, in workspace units, or null if it is empty. */
  function ellipseOf(s, f, c) {
    const cMin = distance(s, f);
    if (!(c > cMin)) return null;
    return { cx: (s.x + f.x) / 2, cy: (s.y + f.y) / 2, a: c / 2, b: Math.sqrt(c * c - cMin * cMin) / 2, angle: Math.atan2(f.y - s.y, f.x - s.x) };
  }

  let informedDrawn = 0;   // how many PHSs the last frame drew (for the tests)

  /** The informed set that sample_informed() last sampled: the union of the PHSs (ellipses), shaded, with a dashed
   *  outline and a + on each focus. Clipped to the workspace, where samples can land. The header key gives its c. */
  function drawInformedSet(runner) {
    const s = runner.start;
    const shapes = s ? runner.lastInformed.phs.map(([f, c]) => ({ f, e: ellipseOf(s, f, c) })).filter((x) => x.e) : [];
    informedDrawn = shapes.length;
    if (!shapes.length) return;
    const trace = ({ cx, cy, a, b, angle }) => ctx.ellipse(X(cx), Y(cy), a * view.scale, b * view.scale, -angle, 0, 2 * Math.PI);
    ctx.save();
    ctx.beginPath(); ctx.rect(X(0), Y(H), W * view.scale, H * view.scale); ctx.clip();
    ctx.beginPath();                       // one path, so overlapping ellipses are shaded once: their union
    for (const { e } of shapes) { ctx.moveTo(X(e.cx + e.a * Math.cos(e.angle)), Y(e.cy + e.a * Math.sin(e.angle))); trace(e); }
    ctx.fillStyle = C.informedFill; ctx.fill();
    ctx.setLineDash([7, 5]); ctx.lineWidth = 1.6; ctx.strokeStyle = C.informed;
    for (const { e } of shapes) { ctx.beginPath(); trace(e); ctx.stroke(); }
    ctx.setLineDash([]); ctx.lineWidth = 1.4;
    const cross = (p) => { const x = X(p.x), y = Y(p.y); ctx.beginPath(); ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y); ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5); ctx.stroke(); };
    cross(s);
    for (const { f } of shapes) cross(f);
    ctx.restore();
  }

  /** The key in the Workspace header: shown while the canvas shows an informed set. */
  const informedKey = $('#informedKey');
  let informedKeyText = null;
  function refreshInformedKey() {
    const shown = Boolean(App.runner) && informedDrawn > 0;
    const text = shown ? `informed set (${informedDrawn === 1 ? 'PHS' : `${informedDrawn} PHSs`}) · c = ${fixed(App.runner.lastInformed.c, 1)}` : '';
    if (text === informedKeyText) return;
    informedKeyText = text;
    informedKey.hidden = !shown;
    informedKey.lastElementChild.textContent = text;
    informedKey.title = shown ? 'The points that could be on a path cheaper than c: for each goal, the prolate hyperspheroid (an ellipse) with foci q_start and the goal, each marked +.' : '';
  }

  function drawRun(runner) {
    const live = !runner.done;
    const variables = runner.visibleVariables();

    // the informed set, under the samples and trees; kept after the run ends
    if (runner.lastInformed) drawInformedSet(runner);
    // sets and plain lists of points: small circles (samples). goal_samples is drawn by drawGoalSamples().
    for (const [name, v] of variables) {
      if (Runner.WORKSPACE_NAMES.includes(name)) continue;
      const points = v instanceof PseudoSet ? [...v.items] : (Array.isArray(v) && !v.isPath ? v : null);
      if (!points || !points.length || !points.every(isPoint)) continue;
      ctx.strokeStyle = C.sample; ctx.lineWidth = 1;
      ctx.beginPath();
      for (const p of points.slice(0, 5000)) { ctx.moveTo(X(p.x) + 2.2, Y(p.y)); ctx.arc(X(p.x), Y(p.y), 2.2, 0, 2 * Math.PI); }
      ctx.stroke();
    }
    for (const structure of runner.structures()) drawStructure(runner, structure);
    // label(q, value): text under the point, kept after the run ends
    let shown = 0;
    for (const [p, text] of runner.labels) {
      if (++shown > 300) break;
      label(text, X(p.x), Y(p.y) + 9, C.ink, 4);
    }
    if (!live) return;

    if (runner.lastSteer) {   // dashed line from the vertex toward the sample it is steering to
      const { from, to } = runner.lastSteer;
      ctx.setLineDash([3, 4]); ctx.strokeStyle = C.muted; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(from.x), Y(from.y)); ctx.lineTo(X(to.x), Y(to.y)); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (runner.lastBlocked) {   // red dashed segment with a cross: the collision check failed
      const [a, b] = runner.lastBlocked;
      ctx.strokeStyle = C.bad; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(b.x), Y(b.y)); ctx.stroke();
      ctx.setLineDash([]);
      const x = X(b.x), y = Y(b.y);
      ctx.beginPath(); ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4); ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4); ctx.stroke();
    }
    if (runner.lastEdge) {   // the newest edge, thicker
      const [a, b] = runner.lastEdge;
      ctx.strokeStyle = C.accent; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(b.x), Y(b.y)); ctx.stroke();
    }
    // paths held in variables (e.g. P_best)
    for (const [, v] of variables) {
      if (!(Array.isArray(v) && v.isPath && v.length > 1 && v.every(isPoint))) continue;
      ctx.strokeStyle = C.path; ctx.lineWidth = 2.5; ctx.globalAlpha = .8;
      tracePath(v); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // point variables as labelled rings; variables at the same spot share one label
    const byPosition = new Map();
    for (const [name, v] of variables) {
      if (!isPoint(v) || name === 'q_start' || name === 'q_goal') continue;
      const key = fixed(v.x, 2) + ',' + fixed(v.y, 2);
      if (!byPosition.has(key)) byPosition.set(key, { p: v, names: [] });
      byPosition.get(key).names.push(name);
    }
    [...byPosition.values()].slice(0, 10).forEach(({ p, names }) => {
      const x = X(p.x), y = Y(p.y);
      ctx.beginPath(); ctx.arc(x, y, 5, 0, 2 * Math.PI); ctx.lineWidth = 1.8; ctx.strokeStyle = C.ink; ctx.stroke();
      label(names.join(' = '), x, y - 9, C.ink, 8);
    });
  }

  /** The goal samples: the run's, or before a run the ones a run would use. Numbered when sample_goal() takes them in order. */
  function drawGoalSamples() {
    const r = App.runner;
    const samples = r ? r.goalSamples : GoalSamples.preview(App.world, RunPanel.seed(), App.goalSettings.perRegion);
    const numbered = (r ? r.goalChoice : App.goalSettings.choice) === 'consecutive';
    const isGoalPoint = (s) => App.world.goals.some((g) => g.kind === 'point' && g.x === s.x && g.y === s.y);
    samples.forEach((s, k) => {
      const x = X(s.x), y = Y(s.y);
      if (!isGoalPoint(s)) {   // a goal point already has its own marker
        ctx.beginPath(); ctx.arc(x, y, 3.2, 0, 2 * Math.PI);
        ctx.fillStyle = C.goal; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = C.canvas; ctx.stroke();
      }
      if (numbered) label(String(k + 1), x, y - 8, C.goal, 3);
    });
    const picked = r && !r.done ? r.lastGoalSample : null;   // the latest pick of sample_goal()
    if (picked) {
      ctx.beginPath(); ctx.arc(X(picked.x), Y(picked.y), 7, 0, 2 * Math.PI);
      ctx.lineWidth = 2; ctx.strokeStyle = C.goal; ctx.stroke();
    }
  }

  function drawResultPath(points) {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    tracePath(points);
    ctx.strokeStyle = C.canvas; ctx.lineWidth = 7; ctx.stroke();   // halo
    ctx.strokeStyle = C.path; ctx.lineWidth = 3.5; ctx.stroke();
    ctx.fillStyle = C.path;
    for (const p of points) { ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 2.6, 0, 2 * Math.PI); ctx.fill(); }
    ctx.lineJoin = 'miter'; ctx.lineCap = 'butt';
  }

  function draw() {
    drawQueued = false;
    if (!view.size) return;
    if (!C) readColors();
    const world = App.world;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.size, view.size);
    drawGrid();
    for (const g of world.goals) if (g.kind === 'region') drawRegion(g);
    for (const o of world.obstacles) drawObstacle(o);
    informedDrawn = 0;
    if (App.runner) drawRun(App.runner);
    refreshInformedKey();
    drawGoalSamples();
    if (App.resultPath && App.resultPath.length > 1) drawResultPath(App.resultPath);
    for (const g of world.goals) if (g.kind === 'point') drawGoalPoint(g);
    if (world.start) drawStart(world.start);
    drawSelection();
    ctx.lineWidth = 1.5; ctx.strokeStyle = C.gridStrong;
    ctx.strokeRect(X(0), Y(H), W * view.scale, H * view.scale);
  }

  /* ================================================================ setup */
  function init() {
    readColors();
    new ResizeObserver(layout).observe(body);
    // Redraw when the theme changes (system setting or data-theme on <html>).
    const onTheme = () => { readColors(); requestDraw(); };
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onTheme);
    new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    layout();
  }

  return {
    init, layout, requestDraw, toWorld, isOverCanvas, handlesFor,
    /** Pixels per workspace unit. */
    get scale() { return view.scale; },
    /** How many PHSs of the informed set the last frame drew. */
    get informedDrawn() { return informedDrawn; },
  };
})();
