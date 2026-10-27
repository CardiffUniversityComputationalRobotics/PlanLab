/* python.js — your Python functions (the Python tab), run in the Python selected in VS Code.
 *
 * In the PlanLab VS Code extension, the extension starts tools/python_worker.py with the interpreter selected in
 * VS Code (your virtual environment, for example) and passes messages between the page and it (host.js). Opened as a
 * plain file in a browser, Python functions can't run, and the Python tab says how to open PlanLab in VS Code.
 *
 * The pseudocode calls a Python function like any other: Program.parse learns their names from the Python tab
 * (scan), and the Runner waits for each call's answer (call) before going on, without freezing the page. At the
 * start of a run, prepare() loads the Python tab into the worker and seeds Python's random module.
 *
 * Values cross as JSON (see the top of python_worker.py). A point keeps a handle, so a point that comes back
 * unchanged is the very same point (a tree vertex stays a vertex). Trees, graphs, sets, maps and queues go as
 * handles that Python can pass back but not look into.
 */
const PythonFunctions = (() => {
  'use strict';
  const { Point, PseudoError, FAILURE, isPoint, isRegion, typeName } = Values;

  const NOT_IN_VSCODE = 'Python functions run in the Python selected in VS Code. Open PlanLab in VS Code: the PlanLab icon in the activity bar, or the command "PlanLab: Open".';

  /* ================================================================ reading the Python tab */

  const DEF = /^def\s+([A-Za-z_]\w*)\s*\(([^)]*)(\))?/;

  /** name → { name, params, min, max, line, comment } for each function defined at the top level of source. */
  function scan(source) {
    const out = new Map(), lines = source.split('\n');
    lines.forEach((text, k) => {
      const m = DEF.exec(text);
      if (!m) return;
      const params = [];
      let min = 0, max = 0, variadic = !m[3];   // a signature over several lines: any number of inputs
      for (const raw of m[2].split(',').map((s) => s.trim()).filter(Boolean)) {
        if (raw === '/' || raw === '*' || raw.startsWith('**')) continue;
        if (raw.startsWith('*')) { variadic = true; continue; }
        params.push(raw.split(/[:=]/)[0].trim());
        max++;
        if (!raw.includes('=')) min++;
      }
      const comment = [];
      for (let j = k - 1; j >= 0 && /^\s*#/.test(lines[j]); j--) comment.unshift(lines[j].replace(/^\s*#\s?/, ''));
      out.set(m[1], { name: m[1], params, min, max: variadic ? Infinity : max, line: k + 1, comment: comment.join(' ') });
    });
    return out;
  }

  /* ================================================================ talking to the extension */

  /** Which Python runs your functions: { python, executable, venv, prefix }, or { problem } saying what's wrong. */
  async function check() {
    if (!Host.inVSCode) return { problem: NOT_IN_VSCODE };
    const answer = await Host.request('pythonStatus');
    return answer.problem ? { problem: answer.problem } : answer;
  }

  /** A run is starting: load the Python tab into the worker and seed Python's random module with the run's seed.
   *  Rejects with a PseudoError pointing into the Python tab if something is wrong. */
  async function prepare(source, runner) {
    runner.pyHandles = [];
    runner.pyHandleOf = new Map();
    if (!Host.inVSCode) throw new PseudoError(NOT_IN_VSCODE, 1, 'py');
    const answer = await Host.request('pythonLoad', { source, seed: runner.seed });
    if (answer.output) runner.print('print', answer.output.replace(/\n$/, ''));
    if (answer.problem) throw new PseudoError(answer.problem, 1, 'py');
    if (answer.error) throw new PseudoError(`Python: ${answer.error.message}`, answer.error.line || 1, 'py');
  }

  /** Calls your Python function name with args (pseudocode values). A promise of its result (a pseudocode value);
   *  it rejects with a PseudoError at the calling line. Wrong numbers of inputs are reported straight away. */
  function call(runner, name, args, line) {
    const f = runner.program.pythonFunctions.get(name);
    if (args.length < f.min || args.length > f.max) {
      const wanted = f.min === f.max ? `${f.min}` : f.max === Infinity ? `at least ${f.min}` : `${f.min} to ${f.max}`;
      throw new PseudoError(`${name}() takes ${wanted} input${f.max === 1 ? '' : 's'}, but got ${args.length}.`, line);
    }
    const sent = args.map((a) => toJson(runner, a));
    return Host.request('pythonCall', { name, args: sent }).then((answer) => {
      if (answer.output) runner.print('print', answer.output.replace(/\n$/, ''));
      if (answer.problem) throw new PseudoError(`${name}(): ${answer.problem}`, line);
      if (answer.error) {
        const where = answer.error.line ? `, Python line ${answer.error.line}` : '';
        const error = new PseudoError(`${name}()${where}: ${answer.error.message}`, line);
        error.pythonLine = answer.error.line || 0;
        throw error;
      }
      return fromJson(runner, answer.result, name, line);
    });
  }

  /* ================================================================ values both ways */

  function handleOf(runner, v) {
    let h = runner.pyHandleOf.get(v);
    if (h === undefined) { h = runner.pyHandles.length; runner.pyHandles.push(v); runner.pyHandleOf.set(v, h); }
    return h;
  }

  function toJson(runner, v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : Number.isNaN(v) ? null : { $inf: v > 0 ? 1 : -1 };
    if (typeof v === 'string' || typeof v === 'boolean') return v;
    if (v === FAILURE) return { $failure: true };
    if (isPoint(v)) return { $point: [v.x, v.y], $h: handleOf(runner, v) };
    if (Array.isArray(v)) return v.map((x) => toJson(runner, x));
    if (isRegion(v)) return { $region: { x0: v.x0, x1: v.x1, y0: v.y0, y1: v.y1 } };
    return { $handle: handleOf(runner, v), kind: typeName(v) };
  }

  function fromJson(runner, v, name, line) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map((x) => fromJson(runner, x, name, line));
    if ('$point' in v) {
      const [x, y] = v.$point, same = v.$h !== undefined ? runner.pyHandles[v.$h] : null;
      return same && isPoint(same) && same.x === x && same.y === y ? same : new Point(x, y);
    }
    if ('$handle' in v) {
      if (!(v.$handle in runner.pyHandles)) throw new PseudoError(`${name}() gave back something that isn't from this run.`, line);
      return runner.pyHandles[v.$handle];
    }
    if ('$inf' in v) return v.$inf > 0 ? Infinity : -Infinity;
    if ('$failure' in v) return FAILURE;
    throw new PseudoError(`${name}() gave back a value the pseudocode can't use.`, line);
  }

  return { scan, check, prepare, call };
})();
