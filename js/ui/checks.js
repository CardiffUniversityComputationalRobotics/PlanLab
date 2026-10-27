/* checks.js — what must be true before a run, shown as the checklist in window 4,
 * and the "Before the planner can run" notice over the workspace when something is missing. */
const Checks = (() => {
  'use strict';
  const { $ } = Util;
  const list = $('#checks'), notice = $('#notice'), noticeList = $('#noticeList'), runButton = $('#runBtn');
  let noticeOpen = false;

  /** Each check is true, false, or null (not applicable yet). */
  function state() {
    const world = App.world, collider = Geometry.makeCollider(world.obstacles);
    const start = !!world.start, goalPlaced = world.goals.length > 0;
    const startClear = !world.start || collider.pointFree(world.start);
    const goalClear = world.goals.every((g) => g.kind !== 'point' || collider.pointFree(g));
    const hasSamples = !goalPlaced || GoalSamples.preview(world, RunPanel.seed(), App.goalSettings.perRegion).length > 0;
    return {
      start,
      goalPlaced,
      goal: goalPlaced,   // goal weights don't matter here: only sample_categorical uses them
      clear: start || goalPlaced ? startClear && goalClear && hasSamples : null,
      startClear,
      goalClear,
      hasSamples,
      code: !App.parseError,
    };
  }

  const ready = (c) => c.start && c.goal && c.clear !== false && c.code;

  /** What to do about each failed check (HTML). */
  function problems(c) {
    const out = [];
    if (!c.start) out.push('Drag <code>q_start</code> from <b>Objects</b> into the workspace.');
    if (!c.goalPlaced) out.push('Drag <code>q_goal</code> or a <b>Goal region</b> from <b>Objects</b> into the workspace.');
    if (c.start && !c.startClear) out.push('Move <code>q_start</code> out of the obstacle it is sitting in.');
    if (!c.goalClear) out.push('Move each <code>q_goal</code> out of the obstacle it is sitting in.');
    else if (!c.hasSamples) out.push('Obstacles cover every goal region, so there are no goal samples. Move a goal region so part of it is free.');
    if (!c.code) out.push(`Fix the pseudocode error on line ${App.parseError.line} of ${App.parseError.src === 'lib' ? 'Functions' : App.parseError.src === 'py' ? 'the Python tab' : 'the algorithm'}.`);
    return out;
  }

  /** Updates the checklist; closes the notice once everything is fixed. */
  function refresh() {
    const c = state();
    for (const li of list.children) {
      const ok = c[li.dataset.c];
      li.dataset.ok = ok === null ? '' : ok ? '1' : '0';
      if (ok !== false) li.classList.remove('flash');
    }
    if (!noticeOpen) return;
    if (ready(c)) {
      closeNotice();
      Toast.show('Everything is in place. Press Run planner.');
      runButton.classList.remove('ready');
      void runButton.offsetWidth;   // restart the pulse animation
      runButton.classList.add('ready');
    } else {
      noticeList.innerHTML = problems(c).map((p) => `<li>${p}</li>`).join('');
      ObjectsPanel.refresh();
    }
  }

  function openNotice(c) {
    noticeOpen = true;
    noticeList.innerHTML = problems(c).map((p) => `<li>${p}</li>`).join('');
    notice.hidden = false;
    for (const li of list.children) {
      li.classList.remove('flash');
      if (li.dataset.ok === '0') { void li.offsetWidth; li.classList.add('flash'); }
    }
    ObjectsPanel.refresh();
  }

  function closeNotice() {
    noticeOpen = false;
    notice.hidden = true;
    ObjectsPanel.refresh();
  }

  /** Before a run. Returns { ok: true }, or opens the notice and returns { ok: false, reason }. */
  function preflight() {
    PseudocodePanel.compile();
    const c = state();
    if (ready(c)) { closeNotice(); return { ok: true }; }
    openNotice(c);
    const missing = [!c.start && 'q_start', !c.goalPlaced && 'q_goal or a goal region'].filter(Boolean);
    let reason;
    if (missing.length) reason = `place ${missing.join(' and ')} in the workspace.`;
    else if (!c.code) reason = `fix the pseudocode error on line ${App.parseError.line}.`;
    else if (c.goalClear && !c.hasSamples) reason = 'obstacles cover every goal region, so there are no goal samples.';
    else reason = 'q_start or a q_goal is inside an obstacle.';
    return { ok: false, reason };
  }

  function init() { $('#noticeClose').addEventListener('click', closeNotice); }

  return { init, state, refresh, preflight, closeNotice, get noticeOpen() { return noticeOpen; } };
})();
