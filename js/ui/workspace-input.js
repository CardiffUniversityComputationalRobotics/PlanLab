/* workspace-input.js — window 1: mouse, touch and keyboard on the canvas.
 *
 * Press on an object to select it, then drag to move it. The corner squares of the selected
 * object resize it and the round handle rotates it (hold Shift to snap to 15°). Dragging an
 * object off the canvas removes it. With the canvas focused, Delete removes the selection,
 * the arrow keys nudge it (Shift for bigger steps) and Escape deselects.
 */
const WorkspaceInput = (() => {
  'use strict';
  const { $, clamp, fixed } = Util;
  const { WIDTH: W, HEIGHT: H } = World;
  const { polygonOf, pointInPolygon } = Geometry;

  const canvas = $('#ws'), coords = $('#coords'), dropHint = $('#dropHint');

  /** The drag in progress: { target, mode: 'move'|'resize'|'rotate', sx, sy, offset, pointerId, changed, removing, before } */
  let drag = null;

  /** What is under workspace point p, in order: handles of the selection, q_start, goal points, obstacles, goal regions. */
  function hitTest(p) {
    const near = (q, pixels) => Math.hypot(q.x - p.x, q.y - p.y) <= pixels / WorkspaceView.scale;
    const world = App.world;
    for (const h of WorkspaceView.handlesFor(App.selection)) {
      if (near(h, 10)) return { target: App.selection, mode: h.type, sx: h.sx, sy: h.sy };
    }
    if (world.start && near(world.start, 12)) return { target: { kind: 'start' }, mode: 'move' };
    for (const g of [...world.goals].reverse()) {
      if (g.kind === 'point' && near(g, 12)) return { target: { kind: 'goal', id: g.id }, mode: 'move' };
    }
    for (const o of [...world.obstacles].reverse()) {
      if (pointInPolygon(p, polygonOf(o))) return { target: { kind: 'obstacle', id: o.id }, mode: 'move' };
    }
    for (const g of [...world.goals].reverse()) {
      if (g.kind === 'region' && Math.abs(p.x - g.x) <= g.w / 2 && Math.abs(p.y - g.y) <= g.h / 2) return { target: { kind: 'goal', id: g.id }, mode: 'move' };
    }
    return null;
  }

  function cursorFor(hit) {
    if (!hit) return 'crosshair';
    if (hit.mode === 'move') return 'grab';
    if (hit.mode === 'rotate') return 'alias';
    return hit.sx * hit.sy > 0 ? 'nesw-resize' : 'nwse-resize';
  }

  /* ---------------------------------------------------------------- pointer */
  function onPointerDown(e) {
    if (e.button !== 0) return;
    canvas.focus({ preventScroll: true });
    const p = WorkspaceView.toWorld(e.clientX, e.clientY);
    const hit = hitTest(p);
    App.selection = hit ? hit.target : null;
    ObjectsPanel.refreshInspector();
    WorkspaceView.requestDraw();
    if (!hit) return;
    const o = WorldActions.objectOf(hit.target);
    drag = { ...hit, pointerId: e.pointerId, offset: { x: o.x - p.x, y: o.y - p.y }, changed: false, removing: false, before: World.snapshot(App.world) };
    canvas.setPointerCapture(e.pointerId);
    if (hit.mode === 'move') canvas.style.cursor = 'grabbing';
  }

  function onPointerMove(e) {
    const p = WorkspaceView.toWorld(e.clientX, e.clientY);
    coords.textContent = p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H ? `x ${fixed(p.x)}  y ${fixed(p.y)}` : '';
    if (!drag || e.pointerId !== drag.pointerId) { canvas.style.cursor = cursorFor(hitTest(p)); return; }

    const o = WorldActions.objectOf(drag.target);
    if (!o) return;
    if (!drag.changed) { drag.changed = true; WorldActions.beginEdit(); }
    if (drag.mode === 'move') moveTo(e, p, o);
    else if (drag.mode === 'resize') resizeTo(p, o);
    else rotateTo(e, p, o);
    ObjectsPanel.refreshInspector();
    WorkspaceView.requestDraw();
  }

  /** Moving; off the canvas, the object is marked for removal instead. */
  function moveTo(e, p, o) {
    drag.removing = !WorkspaceView.isOverCanvas(e.clientX, e.clientY);
    App.draggingOff = drag.removing ? drag.target : null;
    dropHint.hidden = !drag.removing;
    if (drag.removing) { dropHint.textContent = `Release to remove ${WorldActions.describe(drag.target)}`; return; }
    o.x = clamp(p.x + drag.offset.x, 0, W);
    o.y = clamp(p.y + drag.offset.y, 0, H);
  }

  /** Resizing keeps the opposite corner where it is (in the object's own, possibly rotated, frame). */
  function resizeTo(p, o) {
    const a = o.a || 0, c = Math.cos(a), s = Math.sin(a), { sx, sy } = drag;
    const fixedX = o.x + c * (-sx * o.w / 2) - s * (-sy * o.h / 2);
    const fixedY = o.y + s * (-sx * o.w / 2) + c * (-sy * o.h / 2);
    const dx = p.x - fixedX, dy = p.y - fixedY;
    const w = Math.max(2, sx * (c * dx + s * dy)), h = Math.max(2, sy * (-s * dx + c * dy));
    o.w = w; o.h = h;
    o.x = fixedX + c * (sx * w / 2) - s * (sy * h / 2);
    o.y = fixedY + s * (sx * w / 2) + c * (sy * h / 2);
  }

  function rotateTo(e, p, o) {
    let angle = Math.atan2(p.y - o.y, p.x - o.x) - Math.PI / 2;
    if (e.shiftKey) angle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12);
    o.a = angle;
  }

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const finished = drag;
    drag = null;
    App.draggingOff = null;
    dropHint.hidden = true;
    if (finished.removing) WorldActions.remove(finished.target, finished.before);
    else if (finished.changed) WorldActions.endEdit();
    WorkspaceView.requestDraw();
  }

  /* ---------------------------------------------------------------- keyboard */
  function onKeyDown(e) {
    if (!App.selection) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); WorldActions.removeSelected(); return; }
    if (e.key === 'Escape') { App.selection = null; ObjectsPanel.refreshInspector(); WorkspaceView.requestDraw(); return; }
    const step = e.shiftKey ? 5 : 1;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (move) { e.preventDefault(); WorldActions.moveSelected(move[0], move[1]); }
  }

  function init() {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('lostpointercapture', endDrag);   // released outside the window
    canvas.addEventListener('pointerleave', () => { if (!drag) coords.textContent = ''; });
    canvas.addEventListener('keydown', onKeyDown);
  }

  return { init };
})();
