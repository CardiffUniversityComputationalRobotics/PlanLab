/* registry.js — the table of built-in functions, and the input checks they share.
 *
 * Each file in this folder adds functions like this:
 *
 *   Builtins.define('steer', {
 *     group: 'Geometry',                    // its heading in the Reference tab
 *     signature: 'steer(a, b, step)',
 *     description: 'The point at most step away from a, heading toward b.',
 *     inputs: 3,                            // or [min, max]
 *   }, function (args, line) {
 *     const input = Builtins.inputs('steer', line);
 *     const a = input.point(args[0], 1);    // throws a friendly error if it is not a point
 *     …
 *   });
 *
 * Inside the function, `this` is the Runner (see runner.js): this.random(), this.collider,
 * this.start, this.goals, this.goalWeights, and the drawing hints this.lastEdge and so on.
 *
 * Built-ins can also be written in pseudocode: Builtins.definePseudocode(group, source) makes every
 * function in source a built-in (see reward-penalty.js). The // comment right above each function is its
 * description. They run in one go like any built-in, but calls inside them still reach your functions,
 * so a copy you change in the Functions tab is used everywhere.
 */
const Builtins = (() => {
  'use strict';
  const { PseudoError, Tree, Graph, PriorityQueue, isPoint, isNumber, typeName, pointsIn } = Values;

  /** name → { name, group, signature, description, min, max, fn, pseudocode (if written in pseudocode) } */
  const table = Object.create(null);
  /** { group, source } for each definePseudocode(); Program.parse parses them with your code. */
  const pseudocodeSources = [];

  function define(name, info, fn) {
    const [min, max] = Array.isArray(info.inputs) ? info.inputs : [info.inputs, info.inputs];
    table[name] = { name, group: info.group, signature: info.signature, description: info.description, min, max, fn };
  }

  const RULER = /^\s*\/\/\s*[-=]{8,}/;   // "// ------ heading" lines separate sections, they don't describe a function

  /** Makes each function in source (pseudocode) a built-in, listed under group. */
  function definePseudocode(group, source) {
    pseudocodeSources.push({ group, source });
    const lines = source.split('\n');
    for (const f of Parser.parseSource(source, 'builtin').functions.values()) {
      let first = f.line - 1;   // the comment lines right above the function belong to it
      while (first > 0 && /^\s*\/\//.test(lines[first - 1]) && !RULER.test(lines[first - 1])) first--;
      let last = f.line - 1;   // … down to its (unindented) end, unless it is a one-line function
      if (!/\)\s*=/.test(lines[last])) while (last < lines.length - 1 && !/^end(\s+function)?\s*$/.test(lines[last])) last++;
      const comment = lines.slice(first, f.line - 1).map((l) => l.replace(/^\s*\/\/\s?/, '')).join(' ');
      define(f.name, { group, signature: `${f.name}(${f.params.join(', ')})`, description: comment, inputs: f.params.length },
        function (args, line) { return this.callPseudocodeBuiltin(f.name, args, line); });
      table[f.name].pseudocode = lines.slice(first, last + 1).join('\n') + '\n';
    }
  }

  /** Input checks for one call. Each returns the value, or throws a PseudoError that names the function. */
  function inputs(fname, line) {
    const fail = (message) => { throw new PseudoError(message, line); };
    return {
      fail,
      require(ok, message) { if (!ok) fail(message); },
      point(v, k) {
        if (!isPoint(v)) fail(`${fname}() needs a point as input ${k}, but got ${typeName(v)}${v == null ? ' (is it placed in the workspace?)' : ''}.`);
        return v;
      },
      number(v, k) {
        if (!isNumber(v)) fail(`${fname}() needs a number as input ${k}, but got ${typeName(v)}.`);
        return v;
      },
      list(v) {
        if (!Array.isArray(v)) fail(`${fname}() needs a list, but got ${typeName(v)}.`);
        return v;
      },
      tree(v) {
        if (!(v instanceof Tree)) fail(`${fname}() needs a tree as its first input, but got ${typeName(v)}.`);
        return v;
      },
      graph(v) {
        if (!(v instanceof Graph)) fail(`${fname}() needs a graph made with new_graph(), but got ${typeName(v)}.`);
        return v;
      },
      queue(v) {
        if (!(v instanceof PriorityQueue)) fail(`${fname}() needs a queue made with new_queue(), but got ${typeName(v)}.`);
        return v;
      },
      priority(v) {
        if (!(isNumber(v) || (Array.isArray(v) && v.every(isNumber)))) fail(`${fname}(): a priority must be a number (or a list of numbers), but got ${typeName(v)}.`);
        return v;
      },
      /** The points in a tree, graph, set or list. */
      points(v) { return pointsIn(v, fname, line); },
    };
  }

  return { table, define, definePseudocode, pseudocodeSources, inputs };
})();
