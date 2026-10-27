/* run-panel.js — window 4: Run / Pause / Resume, Step line, Next expansion, Reset, the speed
 * and seed, the numbers, and the Variables and Output tabs. Also the animation loop.
 *
 * A run is a Runner (runner.js). Running means calling runner.step() many times per frame;
 * the speed slider sets how many lines of pseudocode that is per second.
 * "Run repeatedly" starts the next run by itself when one ends, and keeps a tally of the results.
 */
const RunPanel = (() => {
  'use strict';
  const { $, fixed, escapeHtml } = Util;
  const { FAILURE, isPoint, format } = Values;

  /** Lines per second for each position of the speed slider. */
  const SPEEDS = [1, 3, 8, 20, 60, 150, 400, 1000, 3000, 10000, 50000, Infinity];
  /** Above this speed the current line is not highlighted (it would only flicker). */
  const HIGHLIGHT_UP_TO = 150;
  /** "Step line" and "Next expansion" give up after this many lines. */
  const STEP_LIMIT = 500000;
  /** With "Run repeatedly", how long a finished run stays on screen before the next one starts (ms). */
  const REPEAT_PAUSE = 900;

  const el = {
    run: $('#runBtn'), runLabel: $('#runLbl'), runIcon: $('#runIcon'), step: $('#stepBtn'), expand: $('#expandBtn'), reset: $('#resetBtn'),
    speed: $('#speed'), speedLabel: $('#speedOut'), seed: $('#seed'), newSeed: $('#seedNew'), randomSeed: $('#seedRandom'), repeat: $('#runRepeat'), repeatStats: $('#repeatStats'), pill: $('#statusPill'),
    lines: $('#stLines'), vertices: $('#stVerts'), edges: $('#stExp'), pathLength: $('#stPath'),
    variables: $('#boxVars'), output: $('#boxLog'), variablesTab: $('#tabVars'), outputTab: $('#tabLog'), outputDot: $('#logDot'),
  };
  const PLAY_ICON = '<path d="M3 1.5v11l9-5.5z" fill="currentColor"/>';
  const PAUSE_ICON = '<path d="M3 1.5h3v11H3zM8 1.5h3v11H8z" fill="currentColor"/>';
  const STATUS_TEXT = { idle: 'Ready', running: 'Running', paused: 'Paused', found: 'Path found', nopath: 'No path found', done: 'Finished', error: 'Error' };

  /* ================================================================ speed and seed */
  const speedIndex = () => +el.speed.value;
  const linesPerSecond = () => SPEEDS[speedIndex()];
  const speedText = () => (linesPerSecond() === Infinity ? 'Max' : `${linesPerSecond().toLocaleString()} lines/s`);

  function setSpeedIndex(i) {
    if (Number.isInteger(i) && i >= 0 && i < SPEEDS.length) el.speed.value = i;
    el.speedLabel.value = speedText();
  }

  /** Raises the speed to at least lps lines per second. Returns the new speed's label, or '' if unchanged. */
  function suggestSpeed(lps) {
    const index = SPEEDS.findIndex((s) => s >= lps);
    if (index < 0 || speedIndex() >= index) return '';
    setSpeedIndex(index);
    SavedState.save();
    return speedText();
  }

  const seed = () => Math.max(0, Math.floor(+el.seed.value || 0));
  function setSeed(value) { if (Number.isFinite(value)) el.seed.value = value; }

  /** "Randomise each run": when ticked, every new run picks a new seed first. */
  const randomSeed = () => el.randomSeed.checked;
  function setRandomSeed(on) { el.randomSeed.checked = on === true; }

  // The goal samples come from the seed, so a new seed shows new ones.
  function seedChanged() { SavedState.save(); Checks.refresh(); ObjectsPanel.refreshGoalSettings(); WorkspaceView.requestDraw(); }

  /** Puts a new random seed (not the current one) in the seed box. */
  function pickNewSeed() {
    let next;
    do next = Math.floor(Math.random() * 1000); while (next === seed());
    el.seed.value = next;
    seedChanged();
  }

  /* ================================================================ running repeatedly */
  const repeating = () => el.repeat.checked;
  function setRepeat(on) { el.repeat.checked = on === true; refreshTally(); }

  /** The results since "Run repeatedly" was ticked (or the code or workspace last changed). */
  const tally = { runs: 0, found: 0, lengths: [] };
  let nextRunTimer = 0;

  function resetTally() { tally.runs = 0; tally.found = 0; tally.lengths = []; refreshTally(); }

  /** The line next to the checkbox, e.g. "5 runs · 4 with a path · best 117.92 · mean 119.40". */
  function refreshTally() {
    let text = '';
    if (repeating()) {
      const sameSeed = randomSeed() ? '' : 'same seed every run: tick Randomise each run to vary them';
      if (!tally.runs) {
        text = sameSeed || 'each run gets a new seed';
      } else {
        const { runs, found, lengths } = tally;
        text = `${runs} run${runs === 1 ? '' : 's'} · ${found} with a path`;
        if (found) text += ` · best ${fixed(Math.min(...lengths), 2)} · mean ${fixed(lengths.reduce((a, b) => a + b, 0) / found, 2)}`;
        if (sameSeed) text += ' · same seed every run';
      }
    }
    el.repeatStats.textContent = text;
  }

  /** Counts a finished run; if it was playing (not stepped by hand), the next one starts after REPEAT_PAUSE. */
  function afterRun(playing) {
    if (!repeating()) return;
    tally.runs++;
    if (App.status === 'found') { tally.found++; tally.lengths.push(Geometry.pathLength(App.resultPath)); }
    refreshTally();
    if (App.status === 'error') { log('warn', 'Stopped running repeatedly: the run ended with an error.'); return; }
    if (!playing) return;
    el.pill.textContent = `${STATUS_TEXT[App.status]} · next run…`;
    nextRunTimer = setTimeout(startNextRun, REPEAT_PAUSE);
  }

  function startNextRun() {
    nextRunTimer = 0;
    if (!repeating() || !App.runner || !App.runner.done) return;   // unticked, reset, or a run is going already
    startRepeating();
  }

  function startRepeating() {
    if (!startRunner()) { log('warn', 'Stopped running repeatedly.'); return; }
    setStatus('running');
    play();
  }

  /** The box was ticked: every run gets a new seed (with one seed every run would plan the same path), and the
   *  runs start now unless one is going or paused. Unticked: the current run ends and no next one starts. */
  function repeatChanged() {
    if (repeating()) {
      if (!randomSeed()) {
        setRandomSeed(true);
        Toast.show('Randomise each run is ticked too, so every run plans with a new seed.');
      }
      resetTally();
      if (App.status !== 'running' && App.status !== 'paused') { cancelNextRun(); startRepeating(); }
    } else {
      cancelNextRun();
      refreshTally();
      if (App.runner && App.runner.done) setStatus(App.status);   // drop "· next run…"
    }
    SavedState.save();
  }

  function cancelNextRun() { clearTimeout(nextRunTimer); nextRunTimer = 0; }

  /* ================================================================ status */
  function setStatus(status, text) {
    App.status = status;
    el.pill.dataset.s = status;
    el.pill.textContent = text || STATUS_TEXT[status];
    el.runLabel.textContent = status === 'running' ? 'Pause' : status === 'paused' ? 'Resume' : status === 'idle' ? 'Run planner' : 'Run again';
    el.runIcon.innerHTML = status === 'running' ? PAUSE_ICON : PLAY_ICON;
    el.reset.disabled = !App.runner;
  }

  /* ================================================================ starting, pausing, stepping */

  /** A new Runner, if the checks pass. Returns false (and shows the notice) if they do not. */
  function startRunner() {
    if (randomSeed()) pickNewSeed();   // before the checks: they look at the goal samples, which come from the seed
    const check = Checks.preflight();
    if (!check.ok) { log('warn', `Can't run yet: ${check.reason}`); return false; }
    const goalOptions = { goalSamplesPerRegion: App.goalSettings.perRegion, goalChoice: App.goalSettings.choice };
    App.runner = new Runner(App.program, App.world, seed(), (kind, text) => log(kind, text), goalOptions);
    App.resultPath = null;
    PseudocodePanel.clearErrors();
    if (App.program.usesPython) App.runner.waitFor(PythonFunctions.prepare(App.program.pythonSource, App.runner));   // the run waits for it
    const which = repeating() ? `Run ${tally.runs + 1}` : 'Run';   // with Run repeatedly: "Run 4 started …"
    log('info', randomSeed()
      ? `${which} started with a new random seed, ${seed()}. Untick "Randomise each run" to keep it.`
      : `${which} started with seed ${seed()}.`);
    return true;
  }

  /** The current run, or a new one if there is none (or it has finished). */
  function ensureRunner() {
    if (App.runner && !App.runner.done) return true;
    return startRunner();
  }

  function onRun() {
    cancelNextRun();
    if (App.status === 'running') { setStatus('paused'); afterSteps(true); return; }
    if (App.status === 'paused' && App.runner && !App.runner.done) { setStatus('running'); play(); return; }
    if (!startRunner()) return;
    setStatus('running');
    play();
  }

  /** Runs one line. On the Algorithm tab, lines inside Functions-tab functions are run through (stepped over). */
  function onStep() {
    cancelNextRun();
    if (!ensureRunner()) return;
    setStatus('paused');
    const r = App.runner;
    let k = 0;
    const more = () => {   // one line; on the Algorithm tab, lines inside Functions-tab functions run through too
      for (;;) {
        if (!r.step()) break;
        if (r.isWaiting) { whenAnswered(r, more); return; }   // a Python function is working: go on when it answers
        k++;
        if (!(App.codeTab !== 'lib' && r.src === 'lib' && k < STEP_LIMIT)) break;
      }
      afterSteps(true);
      showOutputTab(false);
    };
    more();
  }

  /** The run r is waiting for Python: carry on with then() once it has answered, if r is still the current run. */
  function whenAnswered(r, then) {
    refreshActiveLines(true);
    r.waiting.promise.then(() => { if (App.runner === r && !r.done) then(); else if (App.runner === r) afterSteps(true); });
  }

  /** Runs until a tree or graph gains an edge. */
  function onNextExpansion() {
    cancelNextRun();
    if (!ensureRunner()) return;
    setStatus('paused');
    const r = App.runner, before = r.edgesAdded;
    let k = 0;
    const more = () => {
      while (r.edgesAdded === before && k < STEP_LIMIT && r.step()) {
        if (r.isWaiting) { whenAnswered(r, more); return; }
        k++;
      }
      if (k >= STEP_LIMIT) log('warn', `No new edge in ${STEP_LIMIT.toLocaleString()} lines. Paused.`);
      afterSteps(true);
    };
    more();
  }

  function onReset() { invalidate(null); log('info', 'Reset.'); }

  /** Throws the current run away, e.g. because the workspace or the code changed (message), or Reset (no message). */
  function invalidate(message) {
    cancelNextRun();
    if (message && tally.runs) resetTally();   // the results so far were for something else
    if (!App.runner) return;
    cancelAnimationFrame(frameRequest);
    frameRequest = 0;
    App.runner = null;
    App.resultPath = null;
    PseudocodePanel.showActiveLines(0, 0, false);
    if (App.status === 'error') { PseudocodePanel.clearErrors(); if (!App.parseError) PseudocodePanel.compile(); }
    setStatus('idle');
    updatePanels();
    if (message) log('info', message);
    WorkspaceView.requestDraw();
  }

  /** After stepping by hand: finish if done, otherwise refresh the line marks, panels and drawing. */
  function afterSteps(scroll) {
    if (App.runner && App.runner.done) { finish(false); return; }
    refreshActiveLines(scroll);
    updatePanels();
    WorkspaceView.requestDraw();
  }

  /** Marks the line about to run, when paused or running slowly enough to follow. */
  function refreshActiveLines(scroll) {
    const r = App.runner;
    const show = !!r && !r.done && (App.status === 'paused' || (App.status === 'running' && linesPerSecond() <= HIGHLIGHT_UP_TO));
    PseudocodePanel.showActiveLines(show ? r.algoLine : 0, show && r.src === 'lib' ? r.line : 0, scroll);
  }

  /* ================================================================ the animation loop */
  let frameRequest = 0, lastTime = 0, budget = 0, lastPanelUpdate = 0;

  function play() {
    lastTime = 0;
    budget = 0;
    if (!frameRequest) frameRequest = requestAnimationFrame(tick);
  }

  function tick(time) {
    frameRequest = 0;
    const r = App.runner;
    if (App.status !== 'running' || !r) return;
    const elapsed = lastTime ? Math.min(100, time - lastTime) : 16;
    lastTime = time;

    // How many lines this frame: speed × time, at most ~14 ms of work.
    const lps = linesPerSecond();
    let lines;
    if (lps === Infinity) lines = Infinity;
    else { budget += lps * elapsed / 1000; lines = Math.floor(budget); budget -= lines; }
    const started = performance.now();
    for (let k = 0; k < lines; k++) {
      if (!r.step()) break;
      if (r.isWaiting) break;   // a Python function is working
      if ((k & 63) === 63 && performance.now() - started > 14) { budget = 0; break; }
    }

    if (r.done) { finish(true); return; }
    if (r.isWaiting) {   // carry on when Python answers (Pause or Reset meanwhile still work)
      refreshActiveLines(lps <= HIGHLIGHT_UP_TO);
      r.waiting.promise.then(() => { if (App.runner === r && App.status === 'running' && !frameRequest) frameRequest = requestAnimationFrame(tick); });
      return;
    }
    refreshActiveLines(lps <= HIGHLIGHT_UP_TO);
    if (lps <= HIGHLIGHT_UP_TO || time - lastPanelUpdate > 150) { lastPanelUpdate = time; updatePanels(); }
    WorkspaceView.requestDraw();
    frameRequest = requestAnimationFrame(tick);
  }

  /** The program has finished: show its error, its path, or what it returned. */
  /** The run has ended: show the result. playing: it ended while playing, not while stepping by hand. */
  function finish(playing) {
    const r = App.runner;
    PseudocodePanel.showActiveLines(0, 0, false);
    const returnedPath = r.returned && Array.isArray(r.result) && r.result.length > 0 && r.result.every(isPoint);
    if (r.error) {
      setStatus('error', `Error on line ${r.error.line}`);
      PseudocodePanel.showError(r.error);
      PseudocodePanel.revealLine(r.error.src, r.error.line);
      log('err', r.error.message, r.error.line, r.error.src);
      showOutputTab(true);
    } else if (returnedPath) {
      App.resultPath = r.result.length === 1 ? [r.result[0], r.result[0]] : r.result;
      const blocked = App.resultPath.some((q, k) => k > 0 && !r.collider.segmentFree(App.resultPath[k - 1], q));
      setStatus('found');
      log('ok', `Path found: ${App.resultPath.length} waypoints, length ${fixed(Geometry.pathLength(App.resultPath), 2)}, after ${r.linesRun.toLocaleString()} lines.`);
      if (blocked) log('warn', 'Warning: the returned path passes through an obstacle.');
    } else if (r.returned && (r.result === FAILURE || r.result === null)) {
      setStatus('nopath');
      log('err', `No path found after ${r.linesRun.toLocaleString()} lines. Try more iterations or samples, or a different seed.`);
    } else if (r.returned) {
      setStatus('done');
      log('info', `Finished and returned ${format(r.result, 1)}.`);
    } else {
      setStatus('done');
      log('info', 'Finished without returning anything. Return a path (a list of points) to draw it.');
    }
    updatePanels();
    WorkspaceView.requestDraw();
    afterRun(playing);
  }

  /* ================================================================ numbers, variables, output */
  function updatePanels() {
    const r = App.runner;
    el.lines.textContent = r ? r.linesRun.toLocaleString() : '0';
    el.vertices.textContent = r ? r.structures().reduce((sum, s) => sum + s.vertices.length, 0).toLocaleString() : '0';
    el.edges.textContent = r ? r.edgesAdded.toLocaleString() : '0';
    el.pathLength.textContent = App.resultPath ? fixed(Geometry.pathLength(App.resultPath), 2) : '–';
    renderVariables();
  }

  let previousValues = new Map();   // to highlight values that changed since the last step

  function renderVariables() {
    const r = App.runner;
    if (!r) {
      el.variables.innerHTML = '<p class="empty">Variables appear here while the pseudocode runs. Use Step line to watch them change.</p>';
      previousValues = new Map();
      return;
    }
    const rows = [], values = new Map();
    const addFrame = (frame, title) => {
      if (title) rows.push(`<tr class="frame"><td colspan="2">${escapeHtml(title)}</td></tr>`);
      for (const [name, v] of frame.vars) {
        if (Runner.WORKSPACE_NAMES.includes(name)) continue;
        const text = format(v), key = (title || '') + name;
        values.set(key, text);
        const changed = App.status === 'paused' && previousValues.get(key) !== text;
        rows.push(`<tr${changed ? ' class="changed"' : ''}><td>${escapeHtml(name)}</td><td>${escapeHtml(text)}</td></tr>`);
      }
    };
    const top = r.frame;
    if (r.frames.length > 1) { addFrame(top, `inside ${top.name}()`); addFrame(r.frames[0], 'main'); }
    else addFrame(top, null);
    previousValues = values;
    el.variables.innerHTML = rows.length ? `<table class="vars"><tbody>${rows.join('')}</tbody></table>` : '<p class="empty">No variables yet.</p>';
  }

  function showOutputTab(output) {
    el.variablesTab.setAttribute('aria-selected', String(!output));
    el.outputTab.setAttribute('aria-selected', String(output));
    el.variables.hidden = output;
    el.output.hidden = !output;
    if (output) el.outputDot.hidden = true;
  }

  /** Adds a line to the Output tab. kind: 'info' | 'ok' | 'warn' | 'err' | 'print'. A line number becomes a link. */
  function log(kind, text, line, src) {
    const row = document.createElement('div');
    row.className = kind;
    if (line) {
      const link = document.createElement('a');
      link.textContent = src === 'lib' ? `Functions line ${line}: ` : src === 'py' ? `Python line ${line}: ` : `Line ${line}: `;
      link.addEventListener('click', () => PseudocodePanel.revealLine(src, line));
      row.appendChild(link);
    }
    row.appendChild(document.createTextNode(text));
    el.output.appendChild(row);
    while (el.output.children.length > 200) el.output.firstChild.remove();
    el.output.scrollTop = el.output.scrollHeight;
    if (el.output.hidden && kind !== 'info') el.outputDot.hidden = false;
  }

  /* ================================================================ setup */
  function init() {
    el.run.addEventListener('click', onRun);
    el.step.addEventListener('click', onStep);
    el.expand.addEventListener('click', onNextExpansion);
    el.reset.addEventListener('click', onReset);
    el.speed.addEventListener('input', () => { setSpeedIndex(); SavedState.save(); if (App.status === 'running') refreshActiveLines(false); });
    el.seed.addEventListener('change', seedChanged);
    el.newSeed.addEventListener('click', pickNewSeed);
    el.randomSeed.addEventListener('change', () => { refreshTally(); SavedState.save(); });
    el.repeat.addEventListener('change', repeatChanged);
    el.variablesTab.addEventListener('click', () => showOutputTab(false));
    el.outputTab.addEventListener('click', () => showOutputTab(true));
    setSpeedIndex();
    setStatus('idle');
    updatePanels();
  }

  return { init, invalidate, log, refreshActiveLines, speedIndex, setSpeedIndex, suggestSpeed, seed, setSeed, randomSeed, setRandomSeed, repeating, setRepeat };
})();
