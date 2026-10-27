/* pseudocode-panel.js — window 3, Pseudocode: its three editors and four tabs, compiling the code as you type, and
 * the line under the editors (a syntax error, or which of your functions the algorithm uses).
 *
 * The tabs' own controls are in algorithm-tab.js, functions-tab.js and python-tab.js; the Reference tab is
 * reference.js. A line of code is found by its editor: src 'algo' (Algorithm), 'lib' (Functions) or 'py' (Python).
 */
const PseudocodePanel = (() => {
  'use strict';
  const { $ } = Util;
  const { PseudoError } = Values;

  const el = {
    tabs: { algo: $('#tabAlgo'), lib: $('#tabLib'), py: $('#tabPy'), ref: $('#tabRef') },
    tools: { algo: $('#toolsAlgo'), lib: $('#toolsLib'), py: $('#toolsPy') },
    reference: $('#ref'), message: $('#codeMsg'),
  };
  const editorFor = (src) => (src === 'lib' ? App.editors.lib : src === 'py' ? App.editors.py : App.editors.algo);
  const tabName = (src) => (src === 'lib' ? 'Functions' : src === 'py' ? 'Python' : 'Algorithm');

  /** Makes the editors (before anything reads App.editors). */
  function createEditors(librarySource, pythonSource) {
    App.editors = {
      algo: CodeEditor.create($('#edAlgo'), 'code', 'Algorithm pseudocode. Press Escape, then Tab, to leave the editor.', onType),
      lib: CodeEditor.create($('#edLib'), 'lib', 'Function library pseudocode. Press Escape, then Tab, to leave the editor.', onType),
      py: CodeEditor.create($('#edPy'), 'py', 'Python functions. Press Escape, then Tab, to leave the editor.', onType, 'python'),
    };
    App.editors.algo.value = AlgorithmLibrary.current().code;
    App.editors.lib.value = librarySource;
    App.editors.py.value = pythonSource;
  }

  /* ================================================================ compiling, and the line under the editors */

  /** Parses the editors into App.program (or sets App.parseError) and shows the result under the editors. */
  function compile() {
    const algoSource = App.editors.algo.value, libSource = App.editors.lib.value, pySource = App.editors.py.value;
    try {
      App.program = Program.parse(algoSource, libSource, pySource);
      App.parseError = null;
    } catch (e) {
      App.program = null;
      App.parseError = e instanceof PseudoError ? e : new PseudoError(String(e.message || e), 1, 'algo');
    }

    // colour your function names in the editors
    const names = FunctionsTab.functionLinesIn(algoSource + '\n' + libSource).map(([name]) => name);
    if (CodeEditor.setUserFunctions(names)) { App.editors.algo.render(); App.editors.lib.render(); }
    if (CodeEditor.setPythonFunctions(PythonFunctions.scan(pySource).keys())) App.editors.py.render();

    if (App.parseError) {
      showError(App.parseError);
    } else {
      el.message.className = 'code-msg ok';
      el.message.textContent = `No syntax errors.${describeFunctions(App.program)}`;
      if (App.status !== 'error') clearErrors();
    }
    if (App.codeTab === 'ref') Reference.render();
    Checks.refresh();
    return !App.parseError;
  }

  /** " Uses from Functions: … · Not called: …." — which of your functions the algorithm calls. */
  function describeFunctions(program) {
    const lib = [...program.libraryFunctions.keys()], algo = [...program.algorithmFunctions.keys()], py = [...program.pythonFunctions.keys()];
    const called = Program.calledFunctions(program);
    const describe = (f) => `${f}()${Builtins.table[f] ? ' (replaces the built-in)' : ''}`;
    const some = (names) => (names.length <= 3 ? names.map(describe).join(', ') : `${names.slice(0, 2).map(describe).join(', ')} and ${names.length - 2} more`);
    const usedPython = py.filter((f) => called.has(f) || Builtins.table[f]);   // one that replaces a built-in is always used
    const notCalled = [...lib, ...algo].filter((f) => !called.has(f)).concat(py.filter((f) => !usedPython.includes(f)));
    const parts = [];
    if (lib.some((f) => called.has(f))) parts.push(`Uses from Functions: ${some(lib.filter((f) => called.has(f)))}`);
    if (usedPython.length) parts.push(`Uses from Python: ${some(usedPython)}`);
    if (algo.length) parts.push(`in the algorithm: ${some(algo)}`);
    if (notCalled.length) parts.push(`Not called: ${some(notCalled)}`);
    return parts.length ? ` ${parts.join(' · ')}.` : '';
  }

  /** Shows a PseudoError under the editors and marks its line. */
  function showError(error) {
    el.message.className = 'code-msg bad';
    el.message.innerHTML = `<b>${tabName(error.src)} · line ${error.line}</b><span></span><button type="button">Show</button>`;
    el.message.querySelector('span').textContent = error.message;
    el.message.querySelector('button').addEventListener('click', () => revealLine(error.src, error.line));
    for (const src of ['algo', 'lib', 'py']) editorFor(src).setError(src === (error.src || 'algo') ? error.line : 0);
    if (error.pythonLine) App.editors.py.setError(error.pythonLine);   // an error inside a Python function: mark its line too
  }

  function clearErrors() { App.editors.algo.setError(0); App.editors.lib.setError(0); App.editors.py.setError(0); }

  /** Switches to the editor holding the line and scrolls to it. */
  function revealLine(src, line) {
    showTab(src === 'lib' || src === 'py' ? src : 'algo');
    editorFor(src).scrollTo(line);
  }

  /** Marks the line being run in each editor (0 hides it). Only the visible editor scrolls. */
  function showActiveLines(algoLine, libLine, scroll) {
    App.editors.algo.setActive(algoLine, scroll && App.codeTab === 'algo');
    App.editors.lib.setActive(libLine, scroll && App.codeTab === 'lib');
  }

  /** Jumps to one of your functions, wherever it is defined. */
  function showFunction(name) {
    const inLibrary = FunctionsTab.functionLines().find(([n]) => n === name);
    if (inLibrary) { showTab('lib'); App.editors.lib.goToLine(inLibrary[1]); return; }
    const fn = App.program && App.program.functions.get(name);
    if (fn) { showTab('algo'); App.editors.algo.goToLine(fn.line); return; }
    const py = App.program && App.program.pythonFunctions.get(name);
    if (py) { showTab('py'); App.editors.py.goToLine(py.line); }
  }

  /* ================================================================ typing */
  let compileTimer = 0;

  /** After every keystroke: keep the text, clear the run now, re-parse once typing pauses. */
  function onType(editor) {
    if (editor === App.editors.algo) {
      AlgorithmLibrary.update(editor.value);
      AlgorithmTab.refresh();
    }
    clearErrors();
    if (App.runner) RunPanel.invalidate('Pseudocode changed, so the run was cleared.');
    SavedState.save();
    clearTimeout(compileTimer);
    compileTimer = setTimeout(() => { compile(); FunctionsTab.refreshChips(); }, 250);
  }

  /** After the app replaced the code (switching algorithm, Undo, edits arriving from functions.py, …). */
  function codeReplaced() {
    if (App.runner) RunPanel.invalidate('Pseudocode changed, so the run was cleared.');
    clearErrors();
    compile();
    SavedState.save();
    FunctionsTab.refreshChips();
  }

  /* ================================================================ tabs */

  /** Shows a tab: 'algo' | 'lib' | 'py' | 'ref'. keepForms: leave a form (+ New …) open. */
  function showTab(tab, keepForms = false) {
    App.codeTab = tab;
    for (const [name, button] of Object.entries(el.tabs)) button.setAttribute('aria-selected', String(name === tab));
    for (const src of ['algo', 'lib', 'py']) {
      App.editors[src].host.hidden = tab !== src;
      el.tools[src].hidden = tab !== src;
    }
    el.reference.hidden = tab !== 'ref';
    if (!keepForms || tab === 'ref') { FunctionsTab.closeForm(); AlgorithmTab.closeForm(); }
    if (tab === 'py') PythonTab.refreshState();
    if (tab === 'ref') Reference.render();
    RunPanel.refreshActiveLines(true);
    SavedState.save();
  }

  function init() {
    for (const [name, button] of Object.entries(el.tabs)) button.addEventListener('click', () => showTab(name));
    AlgorithmTab.init();
    FunctionsTab.init();
    PythonTab.init();
  }

  return { createEditors, init, compile, codeReplaced, showError, clearErrors, revealLine, showActiveLines, showFunction, showTab };
})();
