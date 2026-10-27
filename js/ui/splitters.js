/* splitters.js — the dividers between the windows, for resizing them.
 *
 * The four windows sit in one CSS grid (base.css). Its sizes are CSS variables on .grid, and each divider
 * changes one of them:
 *   ws-obj      between the Workspace and Objects       --obj-w    the Objects window's width
 *   obj-code    between Objects and Pseudocode / Run     --code-w   the Pseudocode and Run column's width (a % of the grid)
 *   code-run    between Pseudocode and Run               --run-h    the Run window's height (wide layout)
 *                                                        --code-h   the Pseudocode window's height (medium layout)
 *   top-bottom  below the Workspace (medium layout)      --ws-h     the Workspace window's height
 * A divider sits over the gap between its windows; place() moves it there whenever anything changes size.
 * Drag it, or focus it and use the arrow keys (Shift for bigger steps). Double-click it, or press Enter,
 * to go back to the default size. Narrow screens (one column) have no dividers.
 */
const Splitters = (() => {
  'use strict';
  const { $, clamp } = Util;

  const grid = $('.grid');
  const win = { ws: $('.win-ws'), obj: $('.win-obj'), code: $('.win-code'), run: $('.win-run') };
  const dividers = [...document.querySelectorAll('.splitter')];
  const wide = matchMedia('(min-width: 1181px)'), medium = matchMedia('(min-width: 861px) and (max-width: 1180px)');

  /** The smallest a window may get, in pixels, so its controls stay usable. */
  const MIN = { wsW: 320, objW: 160, codeW: 420, codeH: 320, runH: 190, wsH: 320 };
  const MAX = { objW: 420, codeH: 1400, wsH: 1400 };
  const KEY_STEP = 16, BIG_STEP = 64;

  /** Your sizes; null means the default from base.css. codeW is a fraction of the grid's width, the others pixels. */
  const size = { objW: null, codeW: null, runH: null, codeH: null, wsH: null };

  const gap = () => parseFloat(getComputedStyle(grid).columnGap) || 0;
  const box = (el) => el.getBoundingClientRect();
  const layoutNow = () => (wide.matches ? 'wide' : medium.matches ? 'medium' : 'narrow');

  /** Which dividers each layout has. */
  const IN_LAYOUT = { wide: ['ws-obj', 'obj-code', 'code-run'], medium: ['ws-obj', 'code-run', 'top-bottom'], narrow: [] };

  function apply() {
    const set = (name, value) => (value == null ? grid.style.removeProperty(name) : grid.style.setProperty(name, value));
    set('--obj-w', size.objW == null ? null : `${Math.round(size.objW)}px`);
    set('--code-w', size.codeW == null ? null : `${(size.codeW * 100).toFixed(2)}%`);
    set('--run-h', size.runH == null ? null : `${Math.round(size.runH)}px`);
    set('--code-h', size.codeH == null ? null : `${Math.round(size.codeH)}px`);
    set('--ws-h', size.wsH == null ? null : `${Math.round(size.wsH)}px`);
  }

  /* ================================================================ moving a divider */

  /** The sizes after moving divider `name` by (dx, dy) pixels from where the drag started (`from`, measured then). */
  function moved(name, from, dx, dy) {
    const g = gap(), next = {};
    if (name === 'ws-obj') {
      // the Workspace and Objects trade width; Pseudocode / Run keeps its width
      const room = wide.matches ? from.gridW - from.codeW - 2 * g : from.gridW - g;
      next.objW = clamp(from.objW - dx, MIN.objW, Math.max(MIN.objW, Math.min(MAX.objW, room - MIN.wsW)));
    } else if (name === 'obj-code') {
      // Pseudocode / Run grows or shrinks; the Workspace gives or takes the difference, then Objects once the Workspace is at its smallest
      const codeW = clamp(from.codeW - dx, MIN.codeW, Math.max(MIN.codeW, from.gridW - 2 * g - MIN.wsW - MIN.objW));
      next.codeW = codeW / from.gridW;
      const wsW = from.gridW - 2 * g - codeW - from.objW;
      if (wsW < MIN.wsW) next.objW = Math.max(MIN.objW, from.objW - (MIN.wsW - wsW));
    } else if (name === 'code-run') {
      if (wide.matches) next.runH = clamp(from.runH - dy, MIN.runH, Math.max(MIN.runH, from.gridH - g - MIN.codeH));
      else next.codeH = clamp(from.codeH + dy, MIN.codeH, MAX.codeH);
    } else if (name === 'top-bottom') {
      next.wsH = clamp(from.wsH + dy, MIN.wsH, MAX.wsH);
    }
    return next;
  }

  /** The sizes right now, measured from the windows. */
  function measure() {
    const g = box(grid);
    return { gridW: g.width, gridH: g.height, objW: box(win.obj).width, codeW: box(win.code).width,
      runH: box(win.run).height, codeH: box(win.code).height, wsH: box(win.ws).height };
  }

  function moveBy(name, from, dx, dy) {
    Object.assign(size, moved(name, from, dx, dy));
    apply();
    place();
  }

  /** Double-click or Enter: this divider's sizes go back to the defaults. */
  function reset(name) {
    const keys = { 'ws-obj': ['objW'], 'obj-code': ['codeW'], 'code-run': [wide.matches ? 'runH' : 'codeH'], 'top-bottom': ['wsH'] }[name];
    for (const k of keys) size[k] = null;
    apply();
    place();
    SavedState.save();
  }

  /* ================================================================ placing the dividers over the gaps */

  let placeQueued = false;
  function place() {
    if (placeQueued) return;
    placeQueued = true;
    requestAnimationFrame(() => {
      placeQueued = false;
      if (fit()) { place(); return; }
      const shown = IN_LAYOUT[layoutNow()], g = box(grid);
      const ws = box(win.ws), obj = box(win.obj), code = box(win.code), run = box(win.run);
      const at = (el, left, top, width, height) => Object.assign(el.style, { left: `${left - g.left}px`, top: `${top - g.top}px`, width: `${width}px`, height: `${height}px` });
      for (const el of dividers) {
        const name = el.dataset.split;
        el.hidden = !shown.includes(name);
        if (el.hidden) continue;
        if (name === 'ws-obj') at(el, ws.right, Math.min(ws.top, obj.top), obj.left - ws.right, Math.max(ws.bottom, obj.bottom) - Math.min(ws.top, obj.top));
        if (name === 'obj-code') at(el, obj.right, obj.top, code.left - obj.right, obj.height);
        if (name === 'code-run') at(el, code.left, code.bottom, code.width, run.top - code.bottom);
        if (name === 'top-bottom') at(el, ws.left, Math.max(ws.bottom, obj.bottom), obj.right - ws.left, code.top - Math.max(ws.bottom, obj.bottom));
        // what a screen reader announces: the size of the window this divider mainly changes
        const now = { 'ws-obj': obj.width, 'obj-code': code.width, 'code-run': wide.matches ? run.height : code.height, 'top-bottom': ws.height }[name];
        el.setAttribute('aria-valuenow', String(Math.round(now)));
      }
    });
  }

  /** After the browser window got smaller: shrink your sizes so the Workspace and Pseudocode windows keep their
   *  minimum size (the Pseudocode / Run column first, then Objects). Returns true if it changed anything. */
  function fit() {
    if (!wide.matches) return false;
    const before = JSON.stringify(size), m = measure(), wsW = box(win.ws).width;
    let short = MIN.wsW - wsW;
    if (short > 1 && size.codeW != null) {
      const codeW = Math.max(MIN.codeW, m.codeW - short);
      short -= m.codeW - codeW;
      size.codeW = codeW / m.gridW;
    }
    if (short > 1 && size.objW != null) size.objW = Math.max(MIN.objW, m.objW - short);
    const tooLow = MIN.codeH - m.codeH;
    if (tooLow > 1 && size.runH != null) size.runH = Math.max(MIN.runH, m.runH - tooLow);
    if (JSON.stringify(size) === before) return false;
    apply();
    return true;
  }

  /* ================================================================ setup */

  function init(saved) {
    if (saved && typeof saved === 'object') {
      for (const k of Object.keys(size)) if (Number.isFinite(saved[k]) && saved[k] > 0) size[k] = saved[k];
      if (size.codeW != null && size.codeW >= 0.9) size.codeW = null;   // a fraction of the grid, so it must be well under 1
    }
    apply();
    for (const el of dividers) {
      const name = el.dataset.split, vertical = el.getAttribute('aria-orientation') === 'vertical';
      el.title = 'Drag to resize the windows · double-click to go back to the default · arrow keys move it too';
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        const from = measure(), x0 = e.clientX, y0 = e.clientY;
        document.body.classList.add('resizing', vertical ? 'resizing-col' : 'resizing-row');
        el.classList.add('dragging');
        const onMove = (m) => moveBy(name, from, m.clientX - x0, m.clientY - y0);
        const onEnd = () => {
          el.removeEventListener('pointermove', onMove);
          el.removeEventListener('pointerup', onEnd);
          el.removeEventListener('lostpointercapture', onEnd);
          el.removeEventListener('pointercancel', onEnd);
          document.body.classList.remove('resizing', 'resizing-col', 'resizing-row');
          el.classList.remove('dragging');
          SavedState.save();
        };
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerup', onEnd);
        el.addEventListener('lostpointercapture', onEnd);
        el.addEventListener('pointercancel', onEnd);
      });
      el.addEventListener('dblclick', () => reset(name));
      el.addEventListener('keydown', (e) => {
        const step = e.shiftKey ? BIG_STEP : KEY_STEP;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (e.key === 'Enter') { e.preventDefault(); reset(name); return; }
        if (!d || (vertical ? d[0] === 0 : d[1] === 0)) return;
        e.preventDefault();
        moveBy(name, measure(), d[0], d[1]);
        SavedState.save();
      });
    }
    new ResizeObserver(place).observe(grid);
    for (const el of Object.values(win)) new ResizeObserver(place).observe(el);
    wide.addEventListener('change', place);
    medium.addEventListener('change', place);
    place();
  }

  /** For saved-state.js: your sizes, or null if all are the defaults. */
  function toJSON() {
    return Object.values(size).some((v) => v != null) ? { ...size } : null;
  }

  return { init, toJSON };
})();
