/* saved-state.js — keeps the workspace, your algorithms and edits, the Functions and Python tabs and the run
 * settings. In the PlanLab VS Code extension the extension keeps them, in a file (host.js); opened in a browser,
 * they are kept in its localStorage. Storage can be unavailable (private windows, blocked storage); then nothing
 * is saved and nothing breaks. */
const SavedState = (() => {
  'use strict';
  const KEY = 'planlab';   // the localStorage key, when PlanLab runs in a browser

  /** The saved state { world, algorithms, lib, python, goalSamples, speed, seed, randomSeed, runRepeat, layout, tab, theme }, or null. */
  function read() {
    if (Host.inVSCode) return Host.saved;
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  let timer = 0;
  /** Saves shortly after the last change (changes often come in bursts, e.g. while dragging). */
  function save() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const state = {
        world: App.world,
        algorithms: AlgorithmLibrary.toJSON(),
        lib: App.editors.lib.value,
        python: App.editors.py.value,
        goalSamples: App.goalSettings,
        speed: RunPanel.speedIndex(),
        seed: RunPanel.seed(),
        randomSeed: RunPanel.randomSeed(),
        runRepeat: RunPanel.repeating(),
        layout: Splitters.toJSON(),   // window sizes from the dividers, or null for the defaults
        tab: App.codeTab,
        theme: Theme.choice(),        // 'light' | 'dark' from the switch in the header, or null to follow VS Code
      };
      if (Host.inVSCode) { Host.tell('save', { state }); return; }
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable: skip */ }
    }, 300);
  }

  return { read, save };
})();
