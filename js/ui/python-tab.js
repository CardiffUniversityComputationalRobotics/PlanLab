/* python-tab.js — the Pseudocode window's Python tab: your Python functions (python.js runs them).
 *
 *   + New Python function   the Functions tab's form, making a Python function (functions-tab.js)
 *   Check Python            which Python runs them, shown in the line below the buttons
 *   Open functions.py       in the VS Code extension, when PlanLab runs from your PlanLab folder, the tab is saved as
 *                           python/functions.py there; this opens it in VS Code, and edits made to it there show here
 */
const PythonTab = (() => {
  'use strict';
  const { $ } = Util;

  const el = { state: $('#pyState'), check: $('#pyCheck'), newButton: $('#newPyFn'), openFile: $('#pyOpenFile') };

  /** The line below the buttons: the Python (and virtual environment) that runs your functions, or what's wrong. */
  async function refreshState() {
    el.state.textContent = 'Checking Python…';
    const info = await PythonFunctions.check();
    el.state.classList.toggle('bad', Boolean(info.problem));
    el.state.textContent = info.problem
      || `Python ${info.python}${info.venv ? ' · virtual environment' : ''} · ${info.executable}`
        + (Host.pythonFile ? ` · this tab is saved in ${Host.pythonFile}` : '');
    el.state.title = info.problem ? ''
      : `Your Python functions run in ${info.executable}${info.venv ? ` (the virtual environment in ${info.prefix})` : ''}. To use another, run "Python: Select Interpreter" in VS Code.`;
  }

  /** python/functions.py was edited in VS Code: the tab shows it (the run, if any, is cleared). */
  function showFileEdits(source) {
    if (typeof source !== 'string' || source === App.editors.py.value) return;
    App.editors.py.value = source;
    PseudocodePanel.codeReplaced();
    Toast.show('The Python tab now shows your edits to functions.py.');
  }

  function init() {
    el.newButton.addEventListener('click', () => FunctionsTab.openForm('python'));
    el.check.addEventListener('click', refreshState);
    el.openFile.hidden = !Host.pythonFile;
    el.openFile.title = Host.pythonFile ? `Open ${Host.pythonFile} in VS Code. Edits there show here, and the other way round.` : '';
    el.openFile.addEventListener('click', () => Host.tell('openPythonFile'));
    Host.onMessage((m) => {
      if (m.type === 'pythonChanged') refreshState();   // another interpreter was selected in VS Code
      if (m.type === 'pythonFile') showFileEdits(m.source);
    });
  }

  return { init, refreshState };
})();
