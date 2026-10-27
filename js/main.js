/* main.js — starts PlanLab: restores your saved work, sets up each window, and draws.
 * The order matters: the editors come before anything that compiles, saves or draws, and the window sizes come
 * before the Workspace, so it is drawn at its size. */
(() => {
  'use strict';

  // 1. Your saved work (from the VS Code extension, or this browser), checked as it goes in.
  const saved = SavedState.read() || {};
  if (saved.algorithms) AlgorithmLibrary.load(saved.algorithms);
  if (saved.world && Array.isArray(saved.world.goals) && Array.isArray(saved.world.obstacles)) App.world = World.build(saved.world);
  if (['algo', 'lib', 'py', 'ref'].includes(saved.tab)) App.codeTab = saved.tab;
  const goalSamples = saved.goalSamples || {};
  if (Number.isInteger(goalSamples.perRegion) && goalSamples.perRegion >= 1 && goalSamples.perRegion <= 20) App.goalSettings.perRegion = goalSamples.perRegion;
  if (goalSamples.choice === 'random' || goalSamples.choice === 'consecutive') App.goalSettings.choice = goalSamples.choice;

  // 2. The editors.
  PseudocodePanel.createEditors(typeof saved.lib === 'string' ? saved.lib : Library.defaultSource,
    typeof saved.python === 'string' ? saved.python : Library.defaultPython);

  // 3. The light/dark switch (the colours are already set: theme.js), then the windows.
  Theme.init();
  RunPanel.init();
  RunPanel.setSpeedIndex(saved.speed);
  RunPanel.setSeed(saved.seed);
  RunPanel.setRandomSeed(saved.randomSeed);
  RunPanel.setRepeat(saved.runRepeat);
  Checks.init();
  ObjectsPanel.init();
  PseudocodePanel.init();
  Reference.init();
  Splitters.init(saved.layout);
  WorkspaceInput.init();
  WorkspaceView.init();

  // 4. Parse the code, show the right tab, say hello.
  PseudocodePanel.compile();
  PseudocodePanel.showTab(App.codeTab);
  RunPanel.log('info', 'Ready. Press Run planner to grow the tree, or Step line to go one line at a time.');
})();
