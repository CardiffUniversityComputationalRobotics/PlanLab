/* extension.js — the PlanLab VS Code extension.
 *
 * Opens PlanLab (index.html with its css/ and js/) in a VS Code tab, a webview. Clicking the PlanLab icon in the
 * activity bar, or the command "PlanLab: Open", opens it.
 *
 * Which PlanLab files: your PlanLab folder, if it is the folder open in VS Code or directly inside it (or the one in
 * the setting planlab.appFolder), else the copy installed with the extension. Your folder is watched: saving a change
 * to index.html, css/ or js/ reloads the tab, and a change to tools/python_worker.py restarts Python. So only changes
 * to this file or package.json need the extension built and installed again (tools/build_vsix.py).
 *
 * Your work: the page sends it here when it changes (host.js); it is kept in planlab-work.json in this extension's
 * storage folder and handed back to the page when PlanLab opens. When PlanLab runs from your PlanLab folder, the
 * Python tab is also a real file there, python/functions.py: the tab is saved to it, and edits made to it in VS Code
 * show in the tab. Other .py files in python/ can be imported from it.
 *
 * Your Python functions run in the interpreter selected in VS Code (Python: Select Interpreter), or the one in the
 * setting planlab.pythonPath. This extension starts tools/python_worker.py with it and passes messages along:
 *   the page  ⇄  this extension  ⇄  the worker (one JSON line per request and per answer, on its standard input
 *   and output). No network port is opened, so nothing but this extension can reach the worker.
 * A call that takes longer than CALL_TIMEOUT stops the worker; the next request starts a new one.
 */
'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const crypto = require('crypto');
const os = require('os');

const CALL_TIMEOUT = Number(process.env.PLANLAB_CALL_TIMEOUT) || 15000;   // ms
let panel = null;             // the PlanLab tab, while it is open
let worker = null;            // the running Python worker: { process, exe, from, queue, buffer, stderr }
let starting = null;          // a promise of the worker while it starts
let log = null;               // the "PlanLab" output channel: which files and Python run, and what Python writes to stderr
let app = null;               // the PlanLab files the tab shows: { path, from, live }
let pythonFile = null;        // the Python tab's file, <your PlanLab folder>/python/functions.py, or null
let pythonWritten = null;     // what was last written to (or read from) it, to tell your edits from PlanLab's saves

function activate(context) {
  log = vscode.window.createOutputChannel('PlanLab');
  const start = vscode.window.createTreeView('planlab.start', { treeDataProvider: { getTreeItem: (item) => item, getChildren: () => [] } });
  context.subscriptions.push(
    log,
    start,
    vscode.commands.registerCommand('planlab.open', () => open(context)),
    vscode.commands.registerCommand('planlab.reload', () => reloadEverything(context)),
    vscode.commands.registerCommand('planlab.restartPython', () => { stopWorker(); pythonChanged(); vscode.window.showInformationMessage('PlanLab: Python will restart for the next run.'); }),
    // clicking the PlanLab icon in the activity bar opens PlanLab
    start.onDidChangeVisibility((e) => { if (e.visible) open(context); }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('planlab.pythonPath')) { stopWorker(); pythonChanged(); }
      if (e.affectsConfiguration('planlab.appFolder')) reload(context);
    }),
  );
  watchSelectedInterpreter(context);
  if (start.visible) open(context);
}

function deactivate() {
  stopWorker();
}

/* ================================================================ the PlanLab tab */

function open(context) {
  if (panel) { panel.reveal(); return; }
  const next = appFolder(context);
  if (app && next.path !== app.path) stopWorker();   // Python too runs from the new folder
  app = next;
  pythonFile = app.live ? path.join(app.path, 'python', 'functions.py') : null;
  log.appendLine(`PlanLab runs from ${app.path} (${app.from}).${pythonFile ? ` The Python tab is saved in ${pythonFile}.` : ''}`);
  panel = vscode.window.createWebviewPanel('planlab', 'PlanLab', vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,          // a run carries on, and nothing is lost, while another tab is in front
    localResourceRoots: [vscode.Uri.file(app.path), context.extensionUri],
  });
  panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'planlab-tab.svg');
  panel.webview.html = pageHtml(panel.webview, context, app.path, pythonFile);
  const watcher = app.live ? watchFiles(context, app.path) : null;
  panel.onDidDispose(() => { panel = null; if (watcher) watcher.dispose(); }, null, context.subscriptions);
  panel.webview.onDidReceiveMessage((message) => answer(context, message), null, context.subscriptions);
}

/** "PlanLab: Reload", a saved change to PlanLab's files, or another planlab.appFolder: the tab loads PlanLab again. */
function reload(context) {
  if (!panel) return;
  const next = appFolder(context);
  if (next.path !== app.path) {   // other files: a new tab, allowed to read them
    stopWorker();
    panel.dispose();
    open(context);
    return;
  }
  panel.webview.html = pageHtml(panel.webview, context, app.path, pythonFile);   // a new nonce makes it a new page
}

/** "PlanLab: Reload" and the Reload PlanLab button: PlanLab with your latest saved files, and Python restarted
 *  (so it uses the latest tools/python_worker.py too). Opens PlanLab if it isn't open. */
function reloadEverything(context) {
  stopWorker();
  if (!panel) { open(context); return; }
  reload(context);
  log.appendLine('PlanLab reloaded, and Python restarts for the next run.');
}

/** Is folder a PlanLab folder? */
function isPlanLab(folder) {
  return fs.existsSync(path.join(folder, 'index.html')) && fs.existsSync(path.join(folder, 'js', 'pseudocode', 'runner.js'));
}

/** { path, from, live }: which PlanLab files to run (see the top of this file). live: they are watched for changes. */
function appFolder(context) {
  const configured = vscode.workspace.getConfiguration('planlab').get('appFolder');
  if (configured) {
    const folder = path.resolve(configured.replace(/^~(?=$|[\\/])/, os.homedir()));
    if (isPlanLab(folder)) return { path: folder, from: 'the setting planlab.appFolder', live: true };
    log.appendLine(`The setting planlab.appFolder (${configured}) isn't a PlanLab folder, so the installed copy runs.`);
  }
  for (const workspaceFolder of vscode.workspace.workspaceFolders || []) {
    const root = workspaceFolder.uri.fsPath;
    let inside = [];
    try { inside = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => path.join(root, d.name)); } catch (e) { /* unreadable */ }
    const found = [root, ...inside].find(isPlanLab);
    if (found) return { path: found, from: 'your PlanLab folder, open in VS Code', live: true };
  }
  return { path: context.extensionPath, from: 'the copy installed with the extension', live: false };
}

/** Watches PlanLab's files in folder: a saved change reloads the tab, restarts Python for the worker or a module
 *  in python/, and puts your edits to python/functions.py into the Python tab. */
function watchFiles(context, folder) {
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(folder), '{index.html,css/**,js/**,tools/python_worker.py,python/**}'));
  let timer = null;
  const changed = (uri) => {
    if (uri.fsPath === pythonFile) { pythonFileChanged(); return; }
    if (uri.fsPath.startsWith(path.join(folder, 'python') + path.sep)) {   // a module your functions import
      stopWorker();
      log.appendLine(`${path.relative(folder, uri.fsPath)} changed: Python restarts for the next run.`);
      return;
    }
    if (uri.fsPath.endsWith('python_worker.py')) { stopWorker(); log.appendLine('tools/python_worker.py changed: Python restarts for the next run.'); return; }
    clearTimeout(timer);
    timer = setTimeout(() => { log.appendLine(`${path.relative(folder, uri.fsPath)} changed: PlanLab reloads.`); reload(context); }, 300);   // a save can change several files
  };
  watcher.onDidChange(changed);
  watcher.onDidCreate(changed);
  watcher.onDidDelete(changed);
  return watcher;
}

/** index.html from root (the installed copy if none is given), with its files' addresses made into webview addresses,
 *  a content security policy, and your work, with the Python tab from pyFile if there is one. */
function pageHtml(webview, context, root = context.extensionPath, pyFile = null) {
  const nonce = crypto.randomBytes(18).toString('base64');
  const rootUri = vscode.Uri.file(root);
  let page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  page = page.replace(/(src|href)="((?:js|css|media)\/[^"]+)"/g,
    (match, attribute, file) => `${attribute}="${webview.asWebviewUri(vscode.Uri.joinPath(rootUri, ...file.split('/')))}"`);
  page = page.replace(/<script src=/g, `<script nonce="${nonce}" src=`);
  const policy = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src ${webview.cspSource} https://fonts.gstatic.com`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  page = page.replace(/<head>/i, `<head>\n<meta http-equiv="Content-Security-Policy" content="${policy}">`);
  let work = readWork(context);
  const fromFile = pyFile ? readPythonFile(pyFile) : null;
  if (fromFile !== null) work = { ...(work || {}), python: fromFile };   // the file wins: you may have edited it
  const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
  const first = page.indexOf(`<script nonce="${nonce}"`);
  return `${page.slice(0, first)}<script nonce="${nonce}">window.PLANLAB_SAVED = ${json(work)}; window.PLANLAB_PYTHON_FILE = ${json(pyFile)};</script>\n${page.slice(first)}`;
}

/** The page asks: save your work, or something of Python. Answers carry replyTo, the request's id. */
async function answer(context, message) {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'save') { writeWork(context, message.state); return; }
  if (message.type === 'openPythonFile') { openPythonFile(); return; }
  let reply;
  if (message.type === 'pythonStatus') {
    reply = await ask({ op: 'status' }, 10000);
    if (worker && !reply.problem) reply.from = worker.from;
  } else if (message.type === 'pythonLoad') {
    reply = await ask({ op: 'load', source: String(message.source || ''), folder: pythonFile ? path.dirname(pythonFile) : null });
    if (!reply.error && !reply.problem) await ask({ op: 'start', seed: message.seed });
  } else if (message.type === 'pythonCall') {
    reply = await ask({ op: 'call', name: String(message.name), args: message.args || [] });
  } else {
    return;
  }
  if (panel) panel.webview.postMessage({ ...reply, replyTo: message.id });
}

/* ================================================================ your work, in a file */

function workFile(context) {
  return path.join(context.globalStorageUri.fsPath, 'planlab-work.json');
}

function readWork(context) {
  try { return JSON.parse(fs.readFileSync(workFile(context), 'utf8')); } catch (e) { return null; }
}

function writeWork(context, state) {
  if (pythonFile && state && typeof state.python === 'string') writePythonFile(state.python);
  try {
    const file = workFile(context);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(state));
    fs.renameSync(`${file}.tmp`, file);   // all at once, so a crash can't leave half a file
  } catch (e) {
    log.appendLine(`Could not save your PlanLab work: ${e.message}`);
  }
}

/* ================================================================ the Python tab, as python/functions.py */

/** The file's text, or null if it isn't there. */
function readPythonFile(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    if (file === pythonFile) pythonWritten = text;
    return text;
  } catch (e) {
    return null;
  }
}

/** The Python tab changed in PlanLab: save it to the file (if it differs). */
function writePythonFile(text) {
  if (text === pythonWritten) return;
  try {
    fs.mkdirSync(path.dirname(pythonFile), { recursive: true });
    fs.writeFileSync(pythonFile, text);
    pythonWritten = text;
  } catch (e) {
    log.appendLine(`Could not save the Python tab to ${pythonFile}: ${e.message}`);
  }
}

/** python/functions.py changed on disk: if it was you (not PlanLab saving it), the Python tab shows your version. */
function pythonFileChanged() {
  const before = pythonWritten;
  const text = readPythonFile(pythonFile);
  if (text === null || text === before || !panel) return;
  log.appendLine(`${pythonFile} changed: the Python tab shows it.`);
  panel.webview.postMessage({ type: 'pythonFile', source: text });
}

/** The Python tab's button: the file in a VS Code editor, beside PlanLab. */
async function openPythonFile() {
  if (!pythonFile) return;
  if (readPythonFile(pythonFile) === null) writePythonFile('');
  await vscode.window.showTextDocument(vscode.Uri.file(pythonFile), { viewColumn: vscode.ViewColumn.Beside, preview: false });
}

/* ================================================================ which Python */

/** The Python extension's API, if it is installed. */
async function pythonExtension() {
  const extension = vscode.extensions.getExtension('ms-python.python');
  if (!extension) return null;
  try { if (!extension.isActive) await extension.activate(); } catch (e) { return null; }
  return extension.exports && extension.exports.environments ? extension.exports : null;
}

/** { path, from }: the setting planlab.pythonPath, else the interpreter selected in VS Code, else python3. */
async function interpreter() {
  const configured = vscode.workspace.getConfiguration('planlab').get('pythonPath');
  if (configured) return { path: configured, from: 'the setting planlab.pythonPath' };
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  try {
    const api = await pythonExtension();
    if (api) {
      const active = api.environments.getActiveEnvironmentPath(folder && folder.uri);
      const environment = active && await api.environments.resolveEnvironment(active);
      const exe = (environment && environment.executable && environment.executable.uri && environment.executable.uri.fsPath) || (active && active.path);
      if (exe) return { path: exe, from: 'the interpreter selected in VS Code' };
    }
  } catch (e) { /* try the next way */ }
  try {
    const exe = await vscode.commands.executeCommand('python.interpreterPath', { workspaceFolder: folder && folder.uri.fsPath });
    if (typeof exe === 'string' && exe) return { path: exe, from: 'the interpreter selected in VS Code' };
  } catch (e) { /* the Python extension isn't installed */ }
  return { path: process.platform === 'win32' ? 'python' : 'python3', from: 'python3 on your PATH, as no interpreter is selected in VS Code' };
}

/** When another interpreter is selected in VS Code, the next run uses it. */
async function watchSelectedInterpreter(context) {
  const api = await pythonExtension();
  if (api && api.environments.onDidChangeActiveEnvironmentPath) {
    context.subscriptions.push(api.environments.onDidChangeActiveEnvironmentPath(() => { stopWorker(); pythonChanged(); }));
  }
}

/** Tells the page, so the Python tab shows the new interpreter. */
function pythonChanged() {
  if (panel) panel.webview.postMessage({ type: 'pythonChanged' });
}

/* ================================================================ the Python worker */

function getWorker() {
  if (worker) return Promise.resolve(worker);
  if (!starting) starting = startWorker().finally(() => { starting = null; });
  return starting;
}

async function startWorker() {
  const { path: exe, from } = await interpreter();
  const own = app && path.join(app.path, 'tools', 'python_worker.py');   // the worker of the PlanLab files that run
  const script = own && fs.existsSync(own) ? own : path.join(__dirname, '..', 'tools', 'python_worker.py');
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  const w = { exe, from, queue: [], buffer: '', stderr: '', process: null };
  w.process = childProcess.spawn(exe, ['-u', script], {
    cwd: folder ? folder.uri.fsPath : path.dirname(script),   // so your functions can open files in your folder
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  w.process.stdout.setEncoding('utf8');
  w.process.stdout.on('data', (text) => {
    w.buffer += text;
    for (let end = w.buffer.indexOf('\n'); end >= 0; end = w.buffer.indexOf('\n')) {
      const line = w.buffer.slice(0, end);
      w.buffer = w.buffer.slice(end + 1);
      const pending = w.queue.shift();   // the worker answers in the order it was asked
      if (!pending) continue;
      clearTimeout(pending.timer);
      try { pending.resolve(JSON.parse(line)); } catch (e) { pending.resolve({ problem: 'PlanLab could not read an answer from Python.' }); }
    }
  });
  w.process.stderr.setEncoding('utf8');
  w.process.stderr.on('data', (text) => { w.stderr = (w.stderr + text).slice(-4000); log.append(text); });
  w.process.stdin.on('error', () => { /* it stopped; 'exit' tells the waiting requests */ });
  w.process.on('error', (e) => {
    if (worker === w) worker = null;
    finishAll(w, `PlanLab could not start Python (${exe}, ${from}): ${e.message}. Select another interpreter with "Python: Select Interpreter".`);
  });
  w.process.on('exit', (code) => {
    if (worker === w) worker = null;
    const last = w.stderr.trim().split('\n').slice(-3).join(' ');
    finishAll(w, `Python (${exe}) stopped${code ? ` with exit code ${code}` : ''}.${last ? ` It said: ${last}` : ''}`);
  });
  worker = w;
  log.appendLine(`PlanLab: Python functions run in ${exe} (${from}).`);
  return w;
}

/** Answers every request still waiting for w with a problem (it stopped). */
function finishAll(w, problem) {
  for (const pending of w.queue.splice(0)) {
    clearTimeout(pending.timer);
    pending.resolve({ problem });
  }
}

/** Sends one request to the worker; the promise gives its answer, or { problem } if it can't. */
async function ask(request, timeout = CALL_TIMEOUT) {
  const w = await getWorker();
  return new Promise((resolve) => {
    const pending = {
      resolve,
      timer: setTimeout(() => {
        resolve({ problem: `Python took longer than ${timeout / 1000} s, so it was stopped (it restarts for the next run). Does a loop never end?` });
        stopWorker();
      }, timeout),
    };
    w.queue.push(pending);
    w.process.stdin.write(`${JSON.stringify(request)}\n`);
  });
}

function stopWorker() {
  if (!worker) return;
  const w = worker;
  worker = null;
  try { w.process.kill(); } catch (e) { /* already stopped */ }
}

module.exports = { activate, deactivate, _forTests: { pageHtml, answer, interpreter, stopWorker, appFolder, workerScript: () => worker && worker.process.spawnargs[2] } };
