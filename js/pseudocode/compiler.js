/* compiler.js — makes running faster by turning expressions into JavaScript closures.
 *
 * An expression that never calls one of your own functions can be worked out in one go,
 * so it gets a closure:  node.fast = (runner) => value.
 * An expression that does call your functions must be able to pause inside them (for
 * Step line), so node.fast stays null and runner.js evaluates it step by step instead.
 */
const Compiler = (() => {
  'use strict';
  const { truthy, binaryOp, negate, member, getIndex, makePair } = Values;

  function childrenOf(n) {
    switch (n.type) {
      case 'tuple': case 'list': return n.items;
      case 'neg': case 'not': return [n.e];
      case 'and': case 'or': case 'bin': return [n.l, n.r];
      case 'member': return [n.obj];
      case 'index': return [n.obj, n.idx];
      case 'call': return (n.callee.type === 'member' ? [n.callee.obj] : []).concat(n.args);
      default: return [];
    }
  }

  /** A closure for n. Its children already have theirs. */
  function compile(n) {
    const line = n.line;
    switch (n.type) {
      case 'lit': { const v = n.v; return () => v; }
      case 'id': return (r) => r.lookup(n);
      case 'tuple': { const items = n.items.map((c) => c.fast); return (r) => makePair(items.map((f) => f(r))); }
      case 'list': { const items = n.items.map((c) => c.fast); return (r) => items.map((f) => f(r)); }
      case 'neg': { const e = n.e.fast; return (r) => negate(e(r), line); }
      case 'not': { const e = n.e.fast; return (r) => !truthy(e(r)); }
      case 'and': { const a = n.l.fast, b = n.r.fast; return (r) => (truthy(a(r)) ? truthy(b(r)) : false); }
      case 'or': { const a = n.l.fast, b = n.r.fast; return (r) => (truthy(a(r)) ? true : truthy(b(r))); }
      case 'bin': { const a = n.l.fast, b = n.r.fast, op = n.op; return (r) => { const x = a(r); return binaryOp(op, x, b(r), line); }; }
      case 'member': { const o = n.obj.fast, field = n.name; return (r) => member(o(r), field, line); }
      case 'index': { const o = n.obj.fast, k = n.idx.fast; return (r) => { const list = o(r); return getIndex(list, k(r), line); }; }
      case 'call': {
        const fname = n.callee.name, builtinOnly = Boolean(n.builtin);   // builtin.f(…) skips Python functions
        const self = n.callee.type === 'member' ? n.callee.obj.fast : null;   // q.f(x) means f(q, x)
        const args = n.args.map((c) => c.fast);
        return (r) => {
          const values = self ? [self(r)] : [];
          for (const f of args) values.push(f(r));
          return builtinOnly ? r.callBuiltin(fname, values, line) : r.callFunction(fname, values, line);
        };
      }
    }
    return null;
  }

  /** The expressions directly inside a statement. */
  function expressionsOf(s) {
    switch (s.type) {
      case 'assign': {
        const t = s.target;
        return [s.value, ...(t.type === 'member' ? [t.obj] : t.type === 'index' ? [t.obj, t.idx] : [])];
      }
      case 'expr': return [s.expr];
      case 'if': return s.branches.map((b) => b.cond);
      case 'for': return [s.from, s.to, s.step].filter(Boolean);
      case 'forin': return [s.iter];
      case 'while': case 'repeat': return [s.cond];
      case 'return': return s.value ? [s.value] : [];
      default: return [];
    }
  }
  const bodiesOf = (s) => (s.type === 'if' ? [...s.branches.map((b) => b.body), s.elseBody || []] : s.body ? [s.body] : []);

  /** Adds node.fast to every expression in the program that can have one. */
  function compileProgram(program) {
    // calls to your pseudocode or Python functions can't be closures: they run step by step, or wait for Python
    const ownFunctions = { has: (name) => program.functions.has(name) || Boolean(program.pythonFunctions && program.pythonFunctions.has(name)) };
    /** Compiles n's subtree; returns true if n calls one of your functions somewhere. */
    function visit(n) {
      let callsOwn = false;
      for (const c of childrenOf(n)) if (visit(c)) callsOwn = true;
      if (n.type === 'call' && !n.builtin && ownFunctions.has(n.callee.name)) callsOwn = true;
      n.fast = callsOwn ? null : compile(n);
      return callsOwn;
    }
    const walk = (statements) => {
      for (const s of statements) { expressionsOf(s).forEach(visit); bodiesOf(s).forEach(walk); }
    };
    walk(program.body);
    for (const f of program.functions.values()) walk(f.body);
    for (const f of (program.builtinFunctions || new Map()).values()) walk(f.body);   // built-ins written in pseudocode
  }

  return { compileProgram };
})();
