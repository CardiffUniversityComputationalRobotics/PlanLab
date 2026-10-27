/* test-hooks.js — window.planlab: what the automated tests in tests/ read and call. The app doesn't use it. */
window.planlab = {
  get world() { return App.world; },
  get status() { return App.status; },
  get runner() { return App.runner; },
  get resultPath() { return App.resultPath; },
  get currentAlgorithm() { return AlgorithmLibrary.current(); },
  get informedDrawn() { return WorkspaceView.informedDrawn; },
  parse: Program.parse,
  algorithms: Object.fromEntries(Algorithms.list.map((a) => [a.id, a])),
  snippets: Library.snippets,
  builtins: Builtins.table,

  /** The goal samples the Workspace shows before a run. */
  goalSamplePreview: () => GoalSamples.preview(App.world, RunPanel.seed(), App.goalSettings.perRegion),

  /** Runs pseudocode to the end, without drawing, on the current workspace. A promise, as Python functions answer
   *  later. goalOptions: { goalSamplesPerRegion, goalChoice }, else the Objects window's settings. */
  async runSource(algorithmSource, librarySource = null, seed = 1, maxLines = 5e7, goalOptions = null) {
    const options = goalOptions || { goalSamplesPerRegion: App.goalSettings.perRegion, goalChoice: App.goalSettings.choice };
    const program = Program.parse(algorithmSource, librarySource ?? App.editors.lib.value, App.editors.py.value);
    const printed = [];
    const runner = new Runner(program, App.world, seed, (kind, text) => printed.push(text), options);
    if (program.usesPython) runner.waitFor(PythonFunctions.prepare(program.pythonSource, runner));
    const started = performance.now();
    while (runner.linesRun < maxLines && runner.step()) {
      if (runner.isWaiting) await runner.waiting.promise;   // a Python function is working
    }
    const r = runner.result;
    const isPath = Array.isArray(r) && r.length > 0 && r.every(Values.isPoint);
    return {
      ms: performance.now() - started,
      lines: runner.linesRun,
      error: runner.error && `${runner.error.src}:${runner.error.line}: ${runner.error.message}`,
      returned: runner.returned,
      pathPoints: isPath ? r.length : 0,
      length: isPath ? Geometry.pathLength(r) : null,
      blocked: isPath ? r.some((q, k) => k > 0 && !runner.collider.segmentFree(r[k - 1], q)) : false,
      result: isPath ? null : (Array.isArray(r) && r.every(Values.isNumber) ? JSON.stringify(r) : Values.format(r, 1)),
      printed,
    };
  },
};
