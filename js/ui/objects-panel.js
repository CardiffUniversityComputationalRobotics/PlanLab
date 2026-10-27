/* objects-panel.js — window 2: the items you drag into the workspace, the selected object, and layouts.
 *
 * An item can be dragged onto the canvas, or clicked (or pressed with Enter) to place it at a
 * free spot. q_start moves the one start; q_goal and Goal region add another goal each time.
 */
const ObjectsPanel = (() => {
  'use strict';
  const { $, clamp, fixed, escapeHtml } = Util;
  const { SHAPES, LAYOUTS, WIDTH: W, HEIGHT: H } = World;

  const el = {
    robotItems: $('#itemsRobot'), obstacleItems: $('#itemsObst'), ghost: $('#ghost'), frame: $('#wsFrame'),
    inspector: $('#inspector'), what: $('#insWhat'), dims: $('#insDims'),
    weightRow: $('#insWeightRow'), weight: $('#insWeight'), share: $('#insProb'),
    rotateLeft: $('#rotL'), rotateRight: $('#rotR'), remove: $('#insDel'),
    layout: $('#preset'), clearObstacles: $('#clearObs'), clearAll: $('#clearAll'),
    goalCount: $('#goalCount'), pickRandom: $('#pickRandom'), pickConsecutive: $('#pickConsecutive'), goalNote: $('#goalNote'),
  };

  const ROBOT_ITEMS = [
    { kind: 'start', label: 'q_start', mono: true },
    { kind: 'goal', label: 'q_goal', mono: true },
    { kind: 'region', label: 'Goal region' },
  ];

  /* ================================================================ icons (colours come from CSS variables) */
  function iconSvg(kind, size = 28) {
    const svg = (inner) => `<svg viewBox="0 0 28 28" width="${size}" height="${size}" aria-hidden="true">${inner}</svg>`;
    if (kind === 'start') return svg('<circle cx="14" cy="14" r="7" style="fill:var(--start);stroke:var(--canvas)" stroke-width="2"/>');
    if (kind === 'goal') {
      return svg('<g style="stroke:var(--goal)" stroke-width="2.2" fill="none"><circle cx="14" cy="14" r="8"/><path d="M2 14h3M23 14h3M14 2v3M14 23v3"/></g><circle cx="14" cy="14" r="3" style="fill:var(--goal)"/>');
    }
    if (kind === 'region') return svg('<rect x="4" y="4" width="20" height="20" style="fill:var(--region);stroke:var(--goal)" stroke-width="1.6" stroke-dasharray="4 3"/>');
    const shape = SHAPES[kind], m = Math.max(shape.w, shape.h);
    const points = shape.points.map(([x, y]) => `${14 + x * shape.w / m * 22},${14 - y * shape.h / m * 22}`).join(' ');
    return svg(`<polygon points="${points}" style="fill:var(--obst);stroke:var(--obst-edge)" stroke-width="1"/>`);
  }

  /* ================================================================ the item buttons */
  function build() {
    el.robotItems.innerHTML = ROBOT_ITEMS.map((it) => `
      <button type="button" class="item" data-kind="${it.kind}" id="pal-${it.kind}" aria-label="${it.label}. Drag into the workspace, or press to place it.">
        ${iconSvg(it.kind)}<span class="lbl${it.mono ? ' mono' : ''}">${it.label}</span><span class="st" id="st-${it.kind}"></span>
      </button>`).join('');
    el.obstacleItems.innerHTML = Object.entries(SHAPES).map(([kind, shape]) => `
      <button type="button" class="item" data-kind="${kind}" aria-label="${shape.name} obstacle. Drag into the workspace, or press to place it.">
        ${iconSvg(kind)}<span class="lbl">${shape.name}</span><span class="st">${shape.w} × ${shape.h}</span>
      </button>`).join('');
    document.querySelectorAll('.item').forEach(makeDraggable);
  }

  /** "Placed", "2 placed" or "Not placed" under the robot and goal items; highlights what a run is missing. */
  function refreshItems() {
    const setCount = (kind, n) => {
      const st = document.getElementById('st-' + kind);
      st.textContent = n === 0 ? 'Not placed' : n === 1 ? 'Placed' : `${n} placed`;
      st.classList.toggle('ok', n > 0);
    };
    const goals = App.world.goals;
    setCount('start', App.world.start ? 1 : 0);
    setCount('goal', goals.filter((g) => g.kind === 'point').length);
    setCount('region', goals.filter((g) => g.kind === 'region').length);

    const missing = Checks.noticeOpen ? Checks.state() : null;
    $('#pal-start').classList.toggle('attention', !!missing && !missing.start);
    $('#pal-goal').classList.toggle('attention', !!missing && !missing.goalPlaced);
    $('#pal-region').classList.toggle('attention', !!missing && !missing.goalPlaced);
  }

  /* ================================================================ dragging from the panel */
  let pending = null;   // { kind, x0, y0, moved, pointerId }

  function makeDraggable(item) {
    item.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      item.setPointerCapture(e.pointerId);
      pending = { kind: item.dataset.kind, x0: e.clientX, y0: e.clientY, moved: false, pointerId: e.pointerId };
    });
    item.addEventListener('pointermove', (e) => {
      if (!pending || e.pointerId !== pending.pointerId) return;
      if (!pending.moved && Math.hypot(e.clientX - pending.x0, e.clientY - pending.y0) > 5) { pending.moved = true; showGhost(pending.kind); }
      if (pending.moved) {
        el.ghost.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -50%)`;
        el.frame.classList.toggle('drop-target', WorkspaceView.isOverCanvas(e.clientX, e.clientY));
      }
    });
    const finish = (e, cancelled) => {
      if (!pending || e.pointerId !== pending.pointerId) return;
      const done = pending;
      pending = null;
      el.ghost.hidden = true;
      el.frame.classList.remove('drop-target');
      if (cancelled) return;
      if (!done.moved) { WorldActions.placeDefault(done.kind); return; }   // a click
      if (WorkspaceView.isOverCanvas(e.clientX, e.clientY)) {
        const p = WorkspaceView.toWorld(e.clientX, e.clientY);
        WorldActions.place(done.kind, clamp(p.x, 0, W), clamp(p.y, 0, H));
      }
    };
    item.addEventListener('pointerup', (e) => finish(e, false));
    item.addEventListener('pointercancel', (e) => finish(e, true));
    item.addEventListener('lostpointercapture', (e) => finish(e, true));
    item.addEventListener('click', (e) => { if (e.detail === 0) WorldActions.placeDefault(item.dataset.kind); });   // Enter or Space
  }

  /** The object that follows the pointer, drawn at its real size in the workspace. */
  function showGhost(kind) {
    const s = WorkspaceView.scale || 5;
    if (kind === 'start' || kind === 'goal') {
      el.ghost.innerHTML = iconSvg(kind, 30);
    } else if (kind === 'region') {
      const size = 20 * s;
      el.ghost.innerHTML = `<svg width="${size}" height="${size}"><rect x="1" y="1" width="${size - 2}" height="${size - 2}" style="fill:var(--region);stroke:var(--goal)" stroke-width="1.6" stroke-dasharray="5 4"/></svg>`;
    } else {
      const shape = SHAPES[kind], w = shape.w * s, h = shape.h * s;
      const points = shape.points.map(([x, y]) => `${w / 2 + x * w},${h / 2 - y * h}`).join(' ');
      el.ghost.innerHTML = `<svg width="${w + 2}" height="${h + 2}" style="overflow:visible"><polygon points="${points}" style="fill:var(--obst);stroke:var(--obst-edge)"/></svg>`;
    }
    el.ghost.hidden = false;
  }

  /* ================================================================ the selected object */
  function refreshInspector() {
    const sel = App.selection, o = WorldActions.objectOf(sel);
    el.inspector.hidden = !o;
    if (!o) return;
    const isObstacle = sel.kind === 'obstacle', isGoal = sel.kind === 'goal';
    el.rotateLeft.hidden = el.rotateRight.hidden = !isObstacle;
    el.weightRow.hidden = !isGoal;
    const at = `(${fixed(o.x)}, ${fixed(o.y)})`;
    if (isObstacle) {
      const degrees = ((Math.round(o.a * 180 / Math.PI) % 360) + 360) % 360;
      el.what.textContent = SHAPES[o.shape].name;
      el.dims.textContent = `${fixed(o.w)} × ${fixed(o.h)} at ${at} · ${degrees}°`;
    } else if (isGoal) {
      el.what.textContent = o.kind === 'region' ? 'Goal region' : 'q_goal';
      el.dims.textContent = o.kind === 'region' ? `${fixed(o.w)} × ${fixed(o.h)} at ${at}` : `at ${at}`;
      if (document.activeElement !== el.weight) el.weight.value = o.weight;
      el.share.textContent = `Only used if your pseudocode calls sample_categorical(goals, goal_weights), which would pick this goal ${Math.round(WorldActions.goalShare(o) * 100)}% of the time.`;
    } else {
      el.what.textContent = 'q_start';
      el.dims.textContent = `at ${at}`;
    }
  }

  /* ================================================================ goal samples */

  /** Shows the goal-sample settings, and how many samples the current goals give. */
  function refreshGoalSettings() {
    const { perRegion, choice } = App.goalSettings;
    if (document.activeElement !== el.goalCount) el.goalCount.value = perRegion;
    el.pickRandom.setAttribute('aria-checked', String(choice === 'random'));
    el.pickConsecutive.setAttribute('aria-checked', String(choice === 'consecutive'));
    const count = GoalSamples.preview(App.world, RunPanel.seed(), perRegion).length;
    el.goalNote.innerHTML = `${count} sample${count === 1 ? '' : 's'}, shown as dots${choice === 'consecutive' ? ' with their order' : ''}. `
      + (choice === 'random' ? '<code>sample_goal()</code> picks any of them.' : '<code>sample_goal()</code> takes them in turn: 1, 2, 3, …')
      + ' RRT reward-penalty picks by weight instead; BIT*, ABIT* and AIT* aim for all of them at once.';
  }

  /** After a goal-sample setting changed: the run no longer matches, so clear it, then save and redraw. */
  function goalSettingsChanged() {
    RunPanel.invalidate('Goal samples changed, so the run was cleared.');
    SavedState.save();
    Checks.refresh();
    refreshGoalSettings();
    WorkspaceView.requestDraw();
  }

  /** Item counts, highlights, the goal-sample note and the inspector. Called after the world changes. */
  function refresh() { refreshItems(); refreshGoalSettings(); refreshInspector(); }

  /* ================================================================ setup */
  function init() {
    build();
    el.layout.innerHTML = '<option value="">Load layout…</option>'
      + Object.entries(LAYOUTS).map(([key, layout]) => `<option value="${key}">${escapeHtml(layout.name)}</option>`).join('');

    el.weight.addEventListener('input', () => {
      const goal = WorldActions.objectOf(App.selection), w = parseFloat(el.weight.value);
      if (goal && App.selection.kind === 'goal' && Number.isFinite(w) && w >= 0) WorldActions.setWeight(goal, w);
    });
    el.goalCount.addEventListener('input', () => {
      const n = parseInt(el.goalCount.value, 10);
      if (!Number.isInteger(n) || n < 1 || n > 20 || n === App.goalSettings.perRegion) return;
      App.goalSettings.perRegion = n;
      goalSettingsChanged();
    });
    for (const [button, choice] of [[el.pickRandom, 'random'], [el.pickConsecutive, 'consecutive']]) {
      button.addEventListener('click', () => {
        if (App.goalSettings.choice === choice) return;
        App.goalSettings.choice = choice;
        goalSettingsChanged();
      });
    }
    el.rotateLeft.addEventListener('click', () => WorldActions.rotateSelected(15));
    el.rotateRight.addEventListener('click', () => WorldActions.rotateSelected(-15));
    el.remove.addEventListener('click', WorldActions.removeSelected);

    el.layout.addEventListener('change', () => {
      const key = el.layout.value;
      el.layout.value = '';
      if (!LAYOUTS[key]) return;
      const before = World.snapshot(App.world);
      WorldActions.replace(LAYOUTS[key]);
      Toast.show(`Loaded the ${LAYOUTS[key].name} layout.`, () => WorldActions.replace(before));
    });
    el.clearObstacles.addEventListener('click', () => {
      const before = World.snapshot(App.world);
      WorldActions.replace({ ...before, obstacles: [] });
      Toast.show('Removed all obstacles.', () => WorldActions.replace(before));
    });
    el.clearAll.addEventListener('click', () => {
      const before = World.snapshot(App.world);
      WorldActions.replace({ start: null, goals: [], obstacles: [] });
      Toast.show('Cleared the workspace.', () => WorldActions.replace(before));
    });
    refresh();
  }

  return { init, refresh, refreshInspector, refreshGoalSettings };
})();
