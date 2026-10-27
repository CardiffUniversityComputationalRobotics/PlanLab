/* host.js — what the page can ask of the place it runs in.
 *
 * In the PlanLab VS Code extension (vscode/extension.js) the page runs in a VS Code webview. It then saves your work
 * through the extension (in a file) and runs your Python functions through it. Opened as a plain file in a browser,
 * none of this is there: work is saved in the browser and Python functions can't run. (Following VS Code's light or
 * dark theme is ui/theme.js.)
 */
const Host = (() => {
  'use strict';
  const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
  const waiting = new Map();   // request id → resolve
  const listeners = [];
  let nextId = 1;

  if (vscode) {
    window.addEventListener('message', (e) => {
      const message = e.data;
      if (!message || typeof message !== 'object') return;
      if (message.replyTo && waiting.has(message.replyTo)) {
        const resolve = waiting.get(message.replyTo);
        waiting.delete(message.replyTo);
        resolve(message);
        return;
      }
      for (const f of listeners) f(message);
    });
  }

  /** Asks the extension; the promise gives its answer. */
  function request(type, data = {}) {
    if (!vscode) return Promise.reject(new Error('PlanLab is not running in VS Code.'));
    return new Promise((resolve) => {
      const id = nextId++;
      waiting.set(id, resolve);
      vscode.postMessage({ ...data, type, id });
    });
  }

  return {
    inVSCode: Boolean(vscode),
    /** Your saved work, as the extension had it when it opened the page (null if there is none yet). */
    saved: vscode ? (window.PLANLAB_SAVED ?? null) : null,
    /** The file the Python tab is saved in (python/functions.py in your PlanLab folder), or null. */
    pythonFile: vscode ? (window.PLANLAB_PYTHON_FILE ?? null) : null,
    request,
    /** Tells the extension something, without waiting for an answer. */
    tell(type, data = {}) { if (vscode) vscode.postMessage({ ...data, type }); },
    /** Messages the extension sends by itself (not answers), e.g. that the Python interpreter changed. */
    onMessage(f) { listeners.push(f); },
  };
})();
