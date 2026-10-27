/* test_extension.js — checks vscode/extension.js without VS Code: a stand-in for VS Code's API, and a real Python.
 *
 *   node tests/test_extension.js [python]        # python: the interpreter to treat as "selected in VS Code"
 *
 * No Node.js? VS Code includes one:  ELECTRON_RUN_AS_NODE=1 <VS Code's code binary> tests/test_extension.js
 * (tests/run_extension_test.py finds it for you).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const PYTHON = process.argv[2] || 'python3';
const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'planlab-ext-'));
const results = [];
function check(name, ok, info = '') {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? `  [${String(info).slice(0, 300)}]` : ''}`);
}

/* ---------------------------------------------------------------- a stand-in for VS Code's API */
const config = {};
const commands = new Map();
const logs = [];
let panels = [];
let pythonExtension;                 // set per test: what ms-python.python's API says
let interpreterCommand = null;       // what the command python.interpreterPath answers

function uri(fsPath) { return { fsPath, toString: () => `vscode-webview-resource://${fsPath}` }; }
const watchers = [];                 // file watchers the extension made: { base, pattern, fire(file) }
const vscode = {
  Uri: { joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)), file: uri },
  ViewColumn: { Active: -1, Beside: -2 },
  RelativePattern: class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } },
  workspace: {
    workspaceFolders: [{ uri: uri(storage) }],
    getConfiguration: () => ({ get: (key) => config[key] }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    createFileSystemWatcher: (pattern) => {
      const listeners = [];
      const watcher = { base: pattern.base.fsPath, pattern: pattern.pattern, disposed: false, fire: (file) => listeners.forEach((f) => f(uri(file))),
        onDidChange: (f) => listeners.push(f), onDidCreate: (f) => listeners.push(f), onDidDelete: (f) => listeners.push(f), dispose() { watcher.disposed = true; } };
      watchers.push(watcher);
      return watcher;
    },
  },
  extensions: { getExtension: (id) => (id === 'ms-python.python' ? pythonExtension : undefined) },
  commands: {
    registerCommand: (id, f) => { commands.set(id, f); return { dispose() {} }; },
    executeCommand: async (id) => { if (id === 'python.interpreterPath' && interpreterCommand) return interpreterCommand; throw new Error(`no command ${id}`); },
  },
  window: {
    createOutputChannel: () => ({ append: (t) => logs.push(t), appendLine: (t) => logs.push(t), dispose() {} }),
    createTreeView: () => ({ visible: false, onDidChangeVisibility: () => ({ dispose() {} }), dispose() {} }),
    showInformationMessage() {},
    shown: [],
    showTextDocument: async (u, options) => { vscode.window.shown.push({ file: u.fsPath, options }); },
    createWebviewPanel: (viewType, title, column, options) => {
      const panel = {
        viewType, title, options, posted: [], listeners: [], disposeListeners: [],
        webview: {
          cspSource: 'vscode-webview-resource:',
          html: '',
          asWebviewUri: (u) => u.toString(),
          postMessage: async (m) => { panel.posted.push(m); return true; },
          onDidReceiveMessage: (f) => { panel.listeners.push(f); return { dispose() {} }; },
        },
        reveal() { panel.revealed = true; },
        onDidDispose: (f) => { panel.disposeListeners.push(f); return { dispose() {} }; },
        dispose() { panel.disposeListeners.forEach((f) => f()); },
      };
      panels.push(panel);
      return panel;
    },
  },
};
const load = Module._load;
Module._load = function (request, ...rest) { return request === 'vscode' ? vscode : load.call(this, request, ...rest); };

process.env.PLANLAB_CALL_TIMEOUT = '2000';   // the extension's time limit for one call, short for the test
const extension = require(path.join(ROOT, 'vscode', 'extension.js'));
const context = { extensionPath: ROOT, extensionUri: uri(ROOT), globalStorageUri: uri(path.join(storage, 'global')), subscriptions: [] };

/** Sends the page's message and waits for the extension's answer to it. */
async function send(panel, message) {
  const before = panel.posted.length;
  await Promise.all(panel.listeners.map((f) => f(message)));
  return panel.posted.slice(before).find((m) => m.replyTo === message.id);
}

(async () => {
  // which Python: the interpreter selected in VS Code (the Python extension's API)
  pythonExtension = {
    isActive: true,
    exports: { environments: {
      getActiveEnvironmentPath: () => ({ path: PYTHON }),
      resolveEnvironment: async () => ({ executable: { uri: { fsPath: PYTHON } } }),
      onDidChangeActiveEnvironmentPath: (f) => { pythonExtension.fire = f; return { dispose() {} }; },
    } },
  };
  extension.activate(context);
  await new Promise((resolve) => setTimeout(resolve, 50));   // it subscribes to interpreter changes
  check('the extension registers PlanLab: Open, Reload and Restart Python', commands.has('planlab.open') && commands.has('planlab.reload') && commands.has('planlab.restartPython'));
  commands.get('planlab.open')();
  const panel = panels[0];
  check('with no PlanLab folder open in VS Code, the copy installed with the extension runs, unwatched',
    logs.some((l) => l.includes(`PlanLab runs from ${ROOT} (the copy installed with the extension)`)) && watchers.length === 0);
  check('PlanLab: Open opens PlanLab in a tab, with scripts on and kept while hidden',
    panel && panel.title === 'PlanLab' && panel.options.enableScripts && panel.options.retainContextWhenHidden);
  commands.get('planlab.open')();
  check('opening it again shows the same tab', panels.length === 1 && panel.revealed);

  const html = panel.webview.html;
  const scripts = html.match(/<script[^>]*>/g) || [];
  const nonce = (/script-src 'nonce-([^']+)'/.exec(html) || [])[1];
  check('the page gets a content security policy that only allows its own scripts',
    /Content-Security-Policy/.test(html) && nonce && scripts.length > 30 && scripts.every((s) => s.includes(`nonce="${nonce}"`)), scripts.length);
  check('every script and stylesheet points at the extension\'s files', !/(src|href)="(js|css|media)\//.test(html) && html.includes(`vscode-webview-resource://${ROOT}/js/main.js`));
  check('no saved work yet: the page gets null', html.includes('window.PLANLAB_SAVED = null;'));

  let status = await send(panel, { type: 'pythonStatus', id: 1 });
  check('Python runs in the interpreter selected in VS Code', status && status.executable && status.from === 'the interpreter selected in VS Code', JSON.stringify(status));
  let reply = await send(panel, { type: 'pythonLoad', id: 2, source: 'import random\ndef double(x):\n    print("doubling", x)\n    return 2 * x\ndef roll():\n    return random.random()\n', seed: 5 });
  check('loading the Python tab works', reply && !reply.error && !reply.problem && reply.functions.includes('double'), JSON.stringify(reply));
  reply = await send(panel, { type: 'pythonCall', id: 3, name: 'double', args: [21] });
  check('a call comes back with its result and what it printed', reply.result === 42 && reply.output === 'doubling 21\n', JSON.stringify(reply));
  const first = (await send(panel, { type: 'pythonCall', id: 4, name: 'roll', args: [] })).result;
  await send(panel, { type: 'pythonLoad', id: 5, source: 'import random\ndef roll():\n    return random.random()\n', seed: 5 });
  const again = (await send(panel, { type: 'pythonCall', id: 6, name: 'roll', args: [] })).result;
  check('each run seeds Python\'s random module with its seed', first === again, `${first} ${again}`);
  reply = await send(panel, { type: 'pythonLoad', id: 7, source: 'def bad(:\n    pass\n', seed: 1 });
  check('a syntax error in the Python tab comes back with its line', reply.error && reply.error.line === 1, JSON.stringify(reply));

  // another interpreter selected in VS Code: the worker restarts with it, and the page is told
  const posted = panel.posted.length;
  pythonExtension.fire();
  check('selecting another interpreter tells the page', panel.posted.slice(posted).some((m) => m.type === 'pythonChanged'));

  // the setting planlab.pythonPath wins
  config.pythonPath = PYTHON;
  extension._forTests.stopWorker();
  status = await send(panel, { type: 'pythonStatus', id: 8 });
  check('the setting planlab.pythonPath is used first', status.from === 'the setting planlab.pythonPath', JSON.stringify(status));
  config.pythonPath = path.join(storage, 'no-such-python');
  extension._forTests.stopWorker();
  status = await send(panel, { type: 'pythonStatus', id: 9 });
  check('a Python that can\'t start is explained', status.problem && /could not start Python/.test(status.problem), status.problem);
  delete config.pythonPath;

  // no Python extension: the command python.interpreterPath, then python3
  pythonExtension = undefined;
  interpreterCommand = PYTHON;
  extension._forTests.stopWorker();
  status = await send(panel, { type: 'pythonStatus', id: 10 });
  check('without the Python extension\'s API, the command python.interpreterPath is asked', status.from === 'the interpreter selected in VS Code' && !status.problem, JSON.stringify(status));
  interpreterCommand = null;
  const fallback = await extension._forTests.interpreter();
  check('with neither, python3 on the PATH', fallback.path === (process.platform === 'win32' ? 'python' : 'python3'), JSON.stringify(fallback));
  interpreterCommand = PYTHON;

  // a call that never ends: stopped, and the next request starts a fresh worker
  process.env.PLANLAB_CALL_LIMIT = '60';   // so the worker's own limit doesn't stop it first
  extension._forTests.stopWorker();
  await send(panel, { type: 'pythonLoad', id: 11, source: 'def forever():\n    while True:\n        pass\ndef one():\n    return 1\n', seed: 1 });
  const started = Date.now();
  reply = await send(panel, { type: 'pythonCall', id: 12, name: 'forever', args: [] });
  check('a call that never ends is stopped after the time limit', reply.problem && /longer than/.test(reply.problem) && Date.now() - started < 20000, reply.problem);
  await send(panel, { type: 'pythonLoad', id: 13, source: 'def one():\n    return 1\n', seed: 1 });
  reply = await send(panel, { type: 'pythonCall', id: 14, name: 'one', args: [] });
  check('…and Python starts again for the next request', reply.result === 1, JSON.stringify(reply));

  // your work: saved in a file, and handed back when PlanLab opens again
  await send(panel, { type: 'save', state: { lib: 'kept', seed: 42 } });
  const file = path.join(storage, 'global', 'planlab-work.json');
  check('saving writes your work to a file', fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).seed === 42);
  panel.dispose();
  commands.get('planlab.open')();
  check('PlanLab opened again gets your work back', panels.length === 2 && panels[1].webview.html.includes('window.PLANLAB_SAVED = {"lib":"kept","seed":42};'));

  // your PlanLab folder open in VS Code: it runs from there, and saved changes show straight away
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'planlab-workspace-'));
  const mine = path.join(workspace, 'PlanLab');
  for (const f of ['index.html', 'js', 'css', 'media', 'tools']) fs.cpSync(path.join(ROOT, f), path.join(mine, f), { recursive: true });
  vscode.workspace.workspaceFolders = [{ uri: uri(workspace) }];   // like opening ~/Downloads, with PlanLab inside
  panels[1].dispose();
  commands.get('planlab.open')();
  const live = panels[2];
  check('your PlanLab folder inside the open folder is found, and the tab shows its files',
    live.webview.html.includes(`vscode-webview-resource://${mine}/js/main.js`) && live.options.localResourceRoots.some((r) => r.fsPath === mine)
    && logs.some((l) => l.includes(`PlanLab runs from ${mine} (your PlanLab folder, open in VS Code)`)));
  const watcher = watchers[watchers.length - 1];
  check('its files are watched', watcher && watcher.base === mine && /index\.html/.test(watcher.pattern) && /js\/\*\*/.test(watcher.pattern));
  fs.writeFileSync(path.join(mine, 'index.html'), fs.readFileSync(path.join(mine, 'index.html'), 'utf8').replace('<title>', '<title>Changed on the fly · '));
  watcher.fire(path.join(mine, 'index.html'));
  await new Promise((resolve) => setTimeout(resolve, 500));
  check('saving a change to its files reloads the tab with the change', live.webview.html.includes('Changed on the fly · ') && panels.length === 3);
  await send(live, { type: 'pythonStatus', id: 20 });
  check('Python runs the worker from your PlanLab folder', extension._forTests.workerScript() === path.join(mine, 'tools', 'python_worker.py'), extension._forTests.workerScript());
  fs.appendFileSync(path.join(mine, 'tools', 'python_worker.py'), '\n# changed on the fly\n');
  watcher.fire(path.join(mine, 'tools', 'python_worker.py'));
  check('a change to the worker restarts Python (the next request starts the new one)', extension._forTests.workerScript() === null);
  reply = await send(live, { type: 'pythonStatus', id: 21 });
  check('…and the new worker answers', reply.executable && !reply.problem, JSON.stringify(reply));

  // the Python tab is python/functions.py in your PlanLab folder
  const pyFile = path.join(mine, 'python', 'functions.py');
  check('the page is told where the Python tab is saved', live.webview.html.includes(`window.PLANLAB_PYTHON_FILE = ${JSON.stringify(pyFile)};`));
  await send(live, { type: 'save', state: { python: 'def a():\n    return 1\n', seed: 1 } });
  check('saving creates python/functions.py with the Python tab', fs.existsSync(pyFile) && fs.readFileSync(pyFile, 'utf8') === 'def a():\n    return 1\n');
  watcher.fire(pyFile);   // PlanLab's own save: nothing to tell the page
  check('PlanLab\'s own saves are not sent back to the page', !live.posted.some((m) => m.type === 'pythonFile'));
  fs.writeFileSync(pyFile, 'def b():\n    return 2\n');   // you edit it in VS Code
  watcher.fire(pyFile);
  check('your edits to functions.py go to the Python tab', live.posted.some((m) => m.type === 'pythonFile' && m.source === 'def b():\n    return 2\n'));
  await send(live, { type: 'save', state: { python: 'def b():\n    return 2\n', seed: 1 } });
  check('…and the page saving the same text back doesn\'t rewrite the file', fs.readFileSync(pyFile, 'utf8') === 'def b():\n    return 2\n');
  fs.writeFileSync(pyFile, 'def c():\n    return 3\n');
  commands.get('planlab.reload')();
  check('when PlanLab loads, the Python tab comes from functions.py (it wins over the saved copy)',
    live.webview.html.includes(JSON.stringify('def c():\n    return 3\n')));
  fs.writeFileSync(path.join(mine, 'python', 'helper.py'), 'def h():\n    return 5\n');
  await send(live, { type: 'pythonStatus', id: 30 });
  watcher.fire(path.join(mine, 'python', 'helper.py'));
  check('a change to another module in python/ restarts Python', extension._forTests.workerScript() === null);
  await send(live, { type: 'pythonLoad', id: 31, source: 'from helper import h\ndef f():\n    return h()\n', seed: 1 });
  reply = await send(live, { type: 'pythonCall', id: 32, name: 'f', args: [] });
  check('functions.py can import your other modules in python/', reply.result === 5, JSON.stringify(reply));
  await send(live, { type: 'openPythonFile' });
  check('"Open functions.py" opens the file in VS Code, beside PlanLab', vscode.window.shown.some((x) => x.file === pyFile && x.options.viewColumn === vscode.ViewColumn.Beside));
  await send(live, { type: 'pythonStatus', id: 22 });
  const before = live.webview.html;
  commands.get('planlab.reload')();
  check('Reload PlanLab reloads the open tab and restarts Python', live.webview.html !== before && panels.length === 3 && extension._forTests.workerScript() === null);
  live.dispose();
  commands.get('planlab.reload')();
  check('…and opens PlanLab if it isn\'t open', panels.length === 4);
  config.appFolder = ROOT;
  commands.get('planlab.reload')();
  check('the setting planlab.appFolder chooses the folder (a new tab, the old one closed)', panels.length === 5 && watcher.disposed
    && logs.some((l) => l.includes(`PlanLab runs from ${ROOT} (the setting planlab.appFolder)`)));
  delete config.appFolder;
  fs.rmSync(workspace, { recursive: true, force: true });

  extension.deactivate();
  fs.rmSync(storage, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
