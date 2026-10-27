/* world-actions.js — every change to the workspace goes through here.
 *
 * A change clears the current run (it was planned for the old workspace), then saves and
 * refreshes everything that shows the workspace. Removals and layout changes can be undone.
 */
const WorldActions = (() => {
  'use strict';
  const { clamp } = Util;
  const { WIDTH: W, HEIGHT: H, SHAPES } = World;
  const CLEARED = 'Workspace changed, so the run was cleared.';

  /* ---------------------------------------------------------------- looking things up */

  /** The world object a selection points at, or null. */
  function objectOf(target) {
    if (!target) return null;
    const world = App.world;
    if (target.kind === 'start') return world.start || null;
    if (target.kind === 'obstacle') return world.obstacles.find((o) => o.id === target.id) || null;
    return world.goals.find((g) => g.id === target.id) || null;
  }

  /** A short name for messages: "q_start", "the goal region", "the circle". */
  function describe(target) {
    const o = objectOf(target);
    if (!target) return '';
    if (target.kind === 'start') return 'q_start';
    if (target.kind === 'goal') return o && o.kind === 'region' ? 'the goal region' : 'q_goal';
    return o ? `the ${SHAPES[o.shape].name.toLowerCase()}` : 'the obstacle';
  }

  /** The chance that sample_categorical(goals, goal_weights) picks this goal: its weight over the sum of all weights. */
  function goalShare(goal) {
    const total = App.world.goals.reduce((sum, g) => sum + Math.max(0, g.weight), 0);
    return total > 0 ? Math.max(0, goal.weight) / total : 0;
  }

  /* ---------------------------------------------------------------- the edit cycle */

  /** Call before changing the world. */
  function beginEdit() { RunPanel.invalidate(CLEARED); }

  /** Call after changing the world. */
  function endEdit() {
    SavedState.save();
    Checks.refresh();
    ObjectsPanel.refresh();
    WorkspaceView.requestDraw();
  }

  function edit(change) { beginEdit(); change(App.world); endEdit(); }

  /* ---------------------------------------------------------------- changes */

  /** Adds an object of kind ('start', 'goal', 'region' or an obstacle shape) at (x, y), and selects it. */
  function place(kind, x, y) {
    edit((world) => {
      if (kind === 'start') {
        world.start = { x, y };   // there is only one start: this moves it
        App.selection = { kind: 'start' };
      } else if (kind === 'goal' || kind === 'region') {
        const goal = World.makeGoal(kind === 'goal' ? { kind: 'point', x, y } : { kind: 'region', x, y, w: 20, h: 20 });
        world.goals.push(goal);
        App.selection = { kind: 'goal', id: goal.id };
      } else {
        const obstacle = World.makeObstacle({ shape: kind, x, y });
        world.obstacles.push(obstacle);
        App.selection = { kind: 'obstacle', id: obstacle.id };
      }
    });
  }

  /** Places an object without dragging (a click or the keyboard), at a sensible free spot. */
  function placeDefault(kind) {
    let x = 50, y = 50;
    if (kind === 'start') {
      [x, y] = [10, 10];
    } else if (kind === 'goal' || kind === 'region') {
      const spots = kind === 'goal' ? [[90, 90], [90, 10], [10, 90], [50, 90], [90, 50]] : [[86, 86], [86, 14], [14, 86], [50, 86]];
      [x, y] = spots.find(([sx, sy]) => !App.world.goals.some((g) => Math.hypot(g.x - sx, g.y - sy) < 6)) || spots[0];
    } else {
      for (let k = 0; k < 20 && App.world.obstacles.some((o) => Math.abs(o.x - x) < 1 && Math.abs(o.y - y) < 1); k++) { x += 4; y -= 4; }
    }
    place(kind, x, y);
    const what = kind === 'start' ? 'q_start' : kind === 'goal' ? 'q_goal' : kind === 'region' ? 'a goal region' : `a ${SHAPES[kind].name.toLowerCase()}`;
    Toast.show(`Placed ${what} at (${x}, ${y}). Drag it to move it.`);
  }

  /** Removes an object. undoTo is the world to go back to on Undo (by default, the world before this removal). */
  function remove(target, undoTo = World.snapshot(App.world)) {
    const what = describe(target);
    edit((world) => {
      if (target.kind === 'start') world.start = null;
      else if (target.kind === 'goal') world.goals = world.goals.filter((g) => g.id !== target.id);
      else world.obstacles = world.obstacles.filter((o) => o.id !== target.id);
      const sel = App.selection;
      if (sel && sel.kind === target.kind && sel.id === target.id) App.selection = null;
    });
    Toast.show(`Removed ${what}.`, () => replace(undoTo));
  }

  function removeSelected() { if (App.selection) remove(App.selection); }

  /** Replaces the whole world (a layout, Clear all, or Undo). */
  function replace(data) {
    edit(() => { App.world = World.build(data); App.selection = null; });
  }

  function rotateSelected(degrees) {
    const o = objectOf(App.selection);
    if (o && App.selection.kind === 'obstacle') edit(() => { o.a += degrees * Math.PI / 180; });
  }

  function moveSelected(dx, dy) {
    const o = objectOf(App.selection);
    if (o) edit(() => { o.x = clamp(o.x + dx, 0, W); o.y = clamp(o.y + dy, 0, H); });
  }

  function setWeight(goal, weight) { edit(() => { goal.weight = weight; }); }

  return { objectOf, describe, goalShare, beginEdit, endEdit, place, placeDefault, remove, removeSelected, replace, rotateSelected, moveSelected, setWeight };
})();
