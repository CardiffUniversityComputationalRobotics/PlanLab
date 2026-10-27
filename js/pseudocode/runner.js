/* runner.js — runs a parsed program one statement at a time.
 *
 * The interpreter is written with generators: every statement does `yield` before it runs,
 * so runner.step() runs exactly up to the start of the next statement. That is what lets
 * the app animate, pause, and step line by line.
 *
 * return, break and continue are passed back as a value ("signal") instead of being thrown:
 *   null = carry on · BREAK · CONTINUE · { value } = return this value.
 *
 * Variables live in frames. frames[0] is the main program (its variables are the globals);
 * every call to one of your functions pushes a new frame.
 *
 * A call to one of your Python functions is answered later (python.js): the run then waits. The generator yields
 * WAIT, runner.isWaiting is true, and step() does nothing until the answer has come; then the line carries on.
 * Whatever drives the run waits for runner.waiting.promise before stepping again.
 */
const Runner = (() => {
  'use strict';
  const { Point, Tree, Graph, PseudoError, isPoint, isRegion, isNumber, truthy, binaryOp, negate, member, getIndex, setIndex, makePair, typeName } = Values;

  const BREAK = { signal: 'break' }, CONTINUE = { signal: 'continue' };
  const WAIT = { signal: 'wait' };   // yielded while a Python function is working
  /** A built-in written in pseudocode that runs more lines than this in one call is stopped. */
  const BUILTIN_LINE_LIMIT = 1e6;

  /** Variables the workspace provides. They are hidden from the Variables panel. */
  const WORKSPACE_NAMES = ['q_start', 'q_goal', 'goal_region', 'goals', 'goal_weights', 'goal_samples', 'GOAL_CHOICE', 'goal_turn',
    'WIDTH', 'HEIGHT', 'PI', 'π', 'INF'];

  /* ---------- "Did you mean …?" ---------- */
  function editDistance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return d[a.length][b.length];
  }
  function didYouMean(name, candidates) {
    let best = null, bestDistance = 3;
    for (const c of candidates) { const d = editDistance(name, c); if (d < bestDistance) { bestDistance = d; best = c; } }
    return best && best !== name ? ` Did you mean '${best}'?` : '';
  }

  class Runner {
    /**
     * program: from Program.parse · world: App.world · seed: random seed
     * print(kind, text): called by print() in the pseudocode
     * options: { goalSamplesPerRegion, goalChoice: 'random' | 'consecutive' } (Objects → Goal samples)
     */
    constructor(program, world, seed, print, options = {}) {
      Values.resetPointIds();
      this.program = program;
      this.seed = seed;
      this.random = Util.seededRandom(seed);
      this.collider = Geometry.makeCollider(world.obstacles);
      this.print = print;

      // What the workspace gives the pseudocode.
      this.start = world.start ? new Point(world.start.x, world.start.y) : null;
      this.goals = GoalSamples.goalObjects(world);
      this.goalWeights = world.goals.map((g) => g.weight);
      this.goalChoice = options.goalChoice === 'consecutive' ? 'consecutive' : 'random';
      this.goalSamples = GoalSamples.generate(this.goals, this.collider, seed, options.goalSamplesPerRegion || 3);
      this.lastGoalSample = null;   // the latest pick of sample_goal(), drawn with a ring
      this.globals = new Map([
        ['q_start', this.start],
        ['q_goal', this.goals.find(isPoint) || null],
        ['goal_region', this.goals.find(isRegion) || null],
        ['goals', this.goals.slice()],
        ['goal_weights', this.goalWeights.slice()],
        ['goal_samples', this.goalSamples.slice()],
        ['GOAL_CHOICE', this.goalChoice],
        ['goal_turn', 0],           // how far "consecutive" has got through goal_samples
        ['WIDTH', World.WIDTH], ['HEIGHT', World.HEIGHT], ['PI', Math.PI], ['π', Math.PI], ['INF', Infinity],
      ]);
      this.frames = [{ name: null, vars: this.globals, globalNames: null }];

      // Progress, shown in the Run window.
      this.linesRun = 0;
      this.line = 0;          // line of the statement about to run …
      this.src = 'algo';      // … and its editor ('algo' or 'lib')
      this.algoLine = 0;      // the latest line in the Algorithm editor
      this.edgesAdded = 0;

      // Drawing hints, set by built-ins (see workspace-view.js).
      this.lastEdge = null;          // [a, b] the newest edge
      this.lastSteer = null;         // { from, to } of the latest steer()
      this.lastBlocked = null;       // [a, b] the latest failed collision check
      this.lastInformed = null;      // { c, phs } of the latest sample_informed() or informed_phs(): its c_best and PHSs
      this.checkedEdges = new Set(); // edgeKey of every segment found collision-free
      this.collisionCache = new Map();
      this.labels = new Map();       // point → text, from label()

      // Outcome.
      this.done = false;
      this.error = null;       // a PseudoError
      this.returned = false;   // true if the main program used `return`
      this.result = undefined; // … and what it returned

      this.waiting = null;     // { promise, settled, error } while the run waits for Python
      this.generator = this.runMain();
    }

    /** The run waits until promise settles. If it rejects, the run ends with that error (for preparing Python). */
    waitFor(promise) {
      const w = { promise: null, settled: false, error: null };
      w.promise = Promise.resolve(promise).then(() => { w.settled = true; }, (e) => { w.settled = true; w.error = e; });
      this.waiting = w;
      return w;
    }

    /** Is the run waiting for an answer from Python? */
    get isWaiting() { return Boolean(this.waiting && !this.waiting.settled); }

    /* ================================================================ driving */

    /** Runs up to the start of the next statement. Returns false once the program has finished (or failed). */
    step() {
      if (this.done) return false;
      if (this.waiting) {
        if (!this.waiting.settled) return true;   // still waiting for Python: nothing to do yet
        const { error } = this.waiting;
        this.waiting = null;
        if (error) { this.fail(error); return false; }
      }
      let r;
      try {
        r = this.generator.next();
      } catch (e) {
        this.fail(e);
        return false;
      }
      if (r.done) { this.done = true; return false; }
      return true;
    }

    /** Ends the run with an error. */
    fail(e) {
      this.done = true;
      if (e instanceof PseudoError) {
        e.src = e.src || this.src;
        e.line = e.line || this.line;
        this.error = e;
      } else if (e instanceof RangeError) {
        this.error = new PseudoError('The pseudocode ran out of stack space. Is a function calling itself forever?', this.line, this.src);
      } else {
        this.error = new PseudoError(e && e.message ? e.message : String(e), this.line, this.src);
      }
    }

    /** Every statement calls this as it starts (it is what each `yield` passes out). */
    at(line, src) {
      this.line = line;
      this.src = src;
      if (src === 'algo') this.algoLine = line;
      this.linesRun++;
      return line;
    }

    /* ================================================================ variables */
    get frame() { return this.frames[this.frames.length - 1]; }

    lookup(n) {
      const f = this.frame;
      if (f.globalNames && f.globalNames.has(n.name)) { if (this.globals.has(n.name)) return this.globals.get(n.name); }
      else if (f.vars.has(n.name)) return f.vars.get(n.name);
      if (this.globals.has(n.name)) return this.globals.get(n.name);
      if (Builtins.table[n.name] || this.program.functions.has(n.name) || (this.program.pythonFunctions && this.program.pythonFunctions.has(n.name))) {
        throw new PseudoError(`'${n.name}' is a function. Call it with brackets, like ${n.name}(…).`, n.line);
      }
      throw new PseudoError(`'${n.name}' is used before it has a value.${didYouMean(n.name, [...f.vars.keys(), ...this.globals.keys()])}`, n.line);
    }

    /** Assignment inside a function makes a local variable, unless the name was declared `global`. */
    setVariable(name, value) {
      const f = this.frame;
      if (f.globalNames && f.globalNames.has(name)) this.globals.set(name, value);
      else f.vars.set(name, value);
    }

    /* ================================================================ statements
     * Each returns a signal (see the top of the file).
     * `e.fast ? e.fast(this) : yield* this.evaluate(e)` uses the compiled closure when the
     * expression has one (see compiler.js), and the step-by-step evaluator when it does not. */

    *runMain() {
      const signal = yield* this.block(this.program.body);
      if (signal === BREAK || signal === CONTINUE) {
        throw new PseudoError(`'${signal === BREAK ? 'break' : 'continue'}' can only be used inside a loop.`, this.line, this.src);
      }
      if (signal) { this.returned = true; this.result = signal.value; }
    }

    *block(statements) {
      for (const s of statements) {
        const signal = yield* this.exec(s);
        if (signal) return signal;
      }
      return null;
    }

    *exec(s) {
      switch (s.type) {
        case 'function':
          return null;   // definitions were collected by the parser

        case 'global': {
          const f = this.frame;
          if (f !== this.frames[0]) {
            if (!f.globalNames) f.globalNames = new Set();
            s.names.forEach((name) => f.globalNames.add(name));
          }
          return null;
        }

        case 'assign': {
          yield this.at(s.line, s.src);
          const value = s.value.fast ? s.value.fast(this) : yield* this.evaluate(s.value);
          const t = s.target;
          if (t.type === 'id') {
            this.setVariable(t.name, value);
          } else if (t.type === 'tuple') {   // (a, b) ← …
            let values;
            if (Array.isArray(value)) values = value;
            else if (isPoint(value) && t.items.length === 2) values = [value.x, value.y];
            else throw new PseudoError(`Can't split ${typeName(value)} into ${t.items.length} names.`, s.line);
            if (values.length !== t.items.length) throw new PseudoError(`Expected ${t.items.length} values on the right, but got ${values.length}.`, s.line);
            t.items.forEach((item, k) => this.setVariable(item.name, values[k]));
          } else if (t.type === 'member') {  // q.x ← …
            const o = t.obj.fast ? t.obj.fast(this) : yield* this.evaluate(t.obj);
            if (!(isPoint(o) && (t.name === 'x' || t.name === 'y'))) throw new PseudoError(`Can't set '${t.name}' on ${typeName(o)}.`, s.line);
            if (!isNumber(value)) throw new PseudoError(`A point's ${t.name} must be a number.`, s.line);
            o[t.name] = value;
          } else {                           // L[k] ← …  or  M[k] ← …
            const o = t.obj.fast ? t.obj.fast(this) : yield* this.evaluate(t.obj);
            const k = t.idx.fast ? t.idx.fast(this) : yield* this.evaluate(t.idx);
            setIndex(o, k, value, s.line);
          }
          return null;
        }

        case 'expr':
          yield this.at(s.line, s.src);
          if (s.expr.fast) s.expr.fast(this); else yield* this.evaluate(s.expr);
          return null;

        case 'if': {
          for (const branch of s.branches) {
            yield this.at(branch.line, s.src);
            const c = branch.cond.fast ? branch.cond.fast(this) : yield* this.evaluate(branch.cond);
            if (truthy(c)) return yield* this.block(branch.body);
          }
          return s.elseBody ? yield* this.block(s.elseBody) : null;
        }

        case 'for': {                        // for v ← from to/downto to step s
          yield this.at(s.line, s.src);
          const from = s.from.fast ? s.from.fast(this) : yield* this.evaluate(s.from);
          const to = s.to.fast ? s.to.fast(this) : yield* this.evaluate(s.to);
          if (!isNumber(from) || !isNumber(to)) throw new PseudoError('The bounds of a for loop must be numbers.', s.line);
          let step = s.step ? (s.step.fast ? s.step.fast(this) : yield* this.evaluate(s.step)) : (s.down ? -1 : 1);
          if (!isNumber(step) || step === 0) throw new PseudoError('The step of a for loop must be a non-zero number.', s.line);
          if (s.down && step > 0) step = -step;
          for (let k = from, first = true; step > 0 ? k <= to : k >= to; k += step, first = false) {
            if (!first) yield this.at(s.line, s.src);
            this.setVariable(s.v, k);
            const signal = yield* this.block(s.body);
            if (signal === BREAK) break;
            if (signal && signal !== CONTINUE) return signal;
          }
          return null;
        }

        case 'forin': {                      // for each v in S
          yield this.at(s.line, s.src);
          const it = s.iter.fast ? s.iter.fast(this) : yield* this.evaluate(s.iter);
          let items;
          if (Array.isArray(it)) items = it.slice();                     // a copy: the loop may change S
          else if (it instanceof Tree || it instanceof Graph) items = it.vertices.slice();
          else if (it instanceof Values.PseudoSet) items = [...it.items];
          else if (it instanceof Values.PseudoMap) items = [...it.entries.keys()];
          else throw new PseudoError(`'for ${s.v} in …' needs a list, set, map, tree or graph, but got ${typeName(it)}.`, s.line);
          let first = true;
          for (const v of items) {
            if (!first) yield this.at(s.line, s.src);
            first = false;
            this.setVariable(s.v, v);
            const signal = yield* this.block(s.body);
            if (signal === BREAK) break;
            if (signal && signal !== CONTINUE) return signal;
          }
          return null;
        }

        case 'while':
          for (;;) {
            yield this.at(s.line, s.src);
            const c = s.cond.fast ? s.cond.fast(this) : yield* this.evaluate(s.cond);
            if (!truthy(c)) return null;
            const signal = yield* this.block(s.body);
            if (signal === BREAK) return null;
            if (signal && signal !== CONTINUE) return signal;
          }

        case 'repeat':
          for (;;) {
            const signal = yield* this.block(s.body);
            if (signal === BREAK) return null;
            if (signal && signal !== CONTINUE) return signal;
            yield this.at(s.untilLine, s.src);
            const c = s.cond.fast ? s.cond.fast(this) : yield* this.evaluate(s.cond);
            if (truthy(c)) return null;
          }

        case 'return': {
          yield this.at(s.line, s.src);
          const value = s.value ? (s.value.fast ? s.value.fast(this) : yield* this.evaluate(s.value)) : null;
          return { value };
        }
        case 'break':
          yield this.at(s.line, s.src);
          return BREAK;
        case 'continue':
          yield this.at(s.line, s.src);
          return CONTINUE;
      }
      throw new PseudoError(`Unknown statement '${s.type}'.`, s.line);
    }

    /* ================================================================ expressions
     * Only expressions that call one of your own functions get here; their pure parts
     * still use their compiled closures. */

    *evaluate(n) {
      if (n.fast) return n.fast(this);
      switch (n.type) {
        case 'tuple': case 'list': {
          const items = [];
          for (const e of n.items) items.push(e.fast ? e.fast(this) : yield* this.evaluate(e));
          return n.type === 'tuple' ? makePair(items) : items;
        }
        case 'neg': return negate(n.e.fast ? n.e.fast(this) : yield* this.evaluate(n.e), n.line);
        case 'not': return !truthy(n.e.fast ? n.e.fast(this) : yield* this.evaluate(n.e));
        case 'and': {
          const l = n.l.fast ? n.l.fast(this) : yield* this.evaluate(n.l);
          return truthy(l) ? truthy(n.r.fast ? n.r.fast(this) : yield* this.evaluate(n.r)) : false;
        }
        case 'or': {
          const l = n.l.fast ? n.l.fast(this) : yield* this.evaluate(n.l);
          return truthy(l) ? true : truthy(n.r.fast ? n.r.fast(this) : yield* this.evaluate(n.r));
        }
        case 'bin': {
          const a = n.l.fast ? n.l.fast(this) : yield* this.evaluate(n.l);
          const b = n.r.fast ? n.r.fast(this) : yield* this.evaluate(n.r);
          return binaryOp(n.op, a, b, n.line);
        }
        case 'member': return member(n.obj.fast ? n.obj.fast(this) : yield* this.evaluate(n.obj), n.name, n.line);
        case 'index': {
          const o = n.obj.fast ? n.obj.fast(this) : yield* this.evaluate(n.obj);
          const k = n.idx.fast ? n.idx.fast(this) : yield* this.evaluate(n.idx);
          return getIndex(o, k, n.line);
        }
        case 'call': return yield* this.call(n);
      }
      throw new PseudoError('Unknown expression.', n.line);
    }

    /** Calls a function: one of yours (step by step, in a new frame) or a built-in. */
    *call(n) {
      const name = n.callee.name;
      const args = [];
      if (n.callee.type === 'member') {   // q.f(x) is the same as f(q, x)
        const o = n.callee.obj;
        args.push(o.fast ? o.fast(this) : yield* this.evaluate(o));
      }
      for (const a of n.args) args.push(a.fast ? a.fast(this) : yield* this.evaluate(a));

      const fn = n.builtin ? null : this.program.functions.get(name);   // builtin.f(…) skips your functions
      if (!fn && !n.builtin && this.program.pythonFunctions && this.program.pythonFunctions.has(name)) return yield* this.callPython(name, args, n.line);
      if (!fn) return n.builtin ? this.callBuiltin(name, args, n.line) : this.callFunction(name, args, n.line);
      return yield* this.invoke(fn, args, n.line);
    }

    /** Runs a function written in pseudocode (yours, or a built-in one) in a new frame. */
    *invoke(fn, args, line) {
      const name = fn.name;
      if (args.length !== fn.params.length) {
        throw new PseudoError(`${name}() takes ${fn.params.length} input${fn.params.length === 1 ? '' : 's'}, but got ${args.length}.`, line);
      }
      if (this.frames.length > 200) throw new PseudoError(`Too many nested calls to ${name}(). Is it calling itself forever?`, line);
      const vars = new Map(fn.params.map((p, k) => [p, args[k]]));
      this.frames.push({ name, vars, globalNames: null });
      let signal;
      try { signal = yield* this.block(fn.body); } finally { this.frames.pop(); }
      if (signal === BREAK || signal === CONTINUE) {
        throw new PseudoError(`'${signal === BREAK ? 'break' : 'continue'}' can only be used inside a loop.`, this.line, this.src);
      }
      return signal ? signal.value : null;
    }

    /** A built-in written in pseudocode (Builtins.definePseudocode): runs to its end in one go, like any
     *  built-in. An error in its own lines is reported at the call; one in your function, called from it, at yours. */
    callPseudocodeBuiltin(name, args, line) {
      const fn = this.program.builtinFunctions.get(name);
      const [callerLine, callerSrc] = [this.line, this.src];
      const run = this.invoke(fn, args, line);
      try {
        for (let k = 0; ; k++) {
          const r = run.next();
          if (r.done) return r.value;
          if (r.value === WAIT) throw new PseudoError(`A built-in written in pseudocode (${name}) can't call a Python function. Copy it to the Functions tab first.`, line);
          if (k > BUILTIN_LINE_LIMIT) throw new PseudoError(`${name}() did not finish after ${BUILTIN_LINE_LIMIT.toLocaleString()} lines.`, line);
        }
      } catch (e) {
        if (!(e instanceof PseudoError) || (e.src && e.src !== 'builtin')) throw e;   // already points at your code
        if (this.src !== 'builtin') { e.src = this.src; throw e; }                    // it happened in your function
        throw new PseudoError(e.message.startsWith(`${name}()`) ? e.message : `${name}(): ${e.message}`, line);
      } finally {
        this.line = callerLine;
        this.src = callerSrc;
      }
    }

    /** A function that isn't pseudocode or Python: a built-in. (Calls to Python functions go through callPython.) */
    callFunction(name, args, line) {
      if (this.program.pythonFunctions && this.program.pythonFunctions.has(name)) {
        throw new PseudoError(`${name}() is a Python function, which can't be called from here.`, line);
      }
      return this.callBuiltin(name, args, line);
    }

    /** Calls one of your Python functions and waits for its answer (see the top of this file). */
    *callPython(name, args, line) {
      let result, failure = null;
      this.waitFor(PythonFunctions.call(this, name, args, line).then((v) => { result = v; }, (e) => { failure = e; }));
      yield WAIT;
      if (failure) throw failure;
      return result;
    }

    callBuiltin(name, args, line) {
      const builtin = Builtins.table[name];
      if (!builtin) {
        const known = [...Object.keys(Builtins.table), ...this.program.functions.keys(), ...(this.program.pythonFunctions || new Map()).keys()];
        throw new PseudoError(`There is no function called '${name}'.${didYouMean(name, known)} To make one, use + New function.`, line);
      }
      if (args.length < builtin.min || args.length > builtin.max) {
        const wanted = builtin.min === builtin.max ? `${builtin.min}` : `${builtin.min} to ${builtin.max}`;
        throw new PseudoError(`${name}() takes ${wanted} input${builtin.max === 1 ? '' : 's'}, but got ${args.length}.`, line);
      }
      return builtin.fn.call(this, args, line);
    }

    /* ================================================================ for drawing and the Variables panel */

    /** Trees and graphs held in any variable right now (these are drawn). */
    structures() {
      const found = new Set();
      for (const f of this.frames) for (const v of f.vars.values()) if (v instanceof Tree || v instanceof Graph) found.add(v);
      return [...found];
    }

    /** [name, value] pairs: the current function's variables, then the main program's. */
    visibleVariables() {
      const out = [], seen = new Set();
      for (const f of [this.frame, this.frames[0]]) {
        for (const [name, v] of f.vars) if (!seen.has(name)) { seen.add(name); out.push([name, v]); }
      }
      return out;
    }
  }

  Runner.WORKSPACE_NAMES = WORKSPACE_NAMES;
  return Runner;
})();
