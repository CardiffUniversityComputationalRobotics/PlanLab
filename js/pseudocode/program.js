/* program.js — parses the Algorithm and Functions editors into one runnable program.
 *
 * Name lookup for calls: a function in the algorithm replaces one in the Functions tab,
 * which replaces a built-in with the same name. A Python function (the Python tab, python.js) also replaces
 * a built-in; it can't share its name with a pseudocode function.
 */
const Program = (() => {
  'use strict';
  const { PseudoError } = Values;

  /** Returns { body, functions, libraryFunctions, algorithmFunctions, builtinFunctions, pythonFunctions, pythonSource,
   *  usesPython }. Throws a PseudoError on a syntax error.
   *  builtinFunctions are the built-ins written in pseudocode. They are parsed again for every program, so that
   *  their calls reach your functions of the same name. pythonFunctions are read from the Python tab. */
  function parse(algorithmSource, librarySource, pythonSource = '') {
    const library = Parser.parseSource(librarySource, 'lib');
    const stray = library.body.find((s) => s.type !== 'function');
    if (stray) {
      throw new PseudoError('The Functions tab can only hold functions. Move this line into the algorithm, or put it inside a function.', stray.line, 'lib');
    }
    const algorithm = Parser.parseSource(algorithmSource, 'algo');
    const program = {
      body: algorithm.body,
      functions: new Map([...library.functions, ...algorithm.functions]),
      libraryFunctions: library.functions,
      algorithmFunctions: algorithm.functions,
      builtinFunctions: new Map(Builtins.pseudocodeSources.flatMap(({ source }) => [...Parser.parseSource(source, 'builtin').functions])),
      pythonFunctions: PythonFunctions.scan(pythonSource),
      pythonSource,
    };
    for (const f of program.pythonFunctions.values()) {
      if (program.functions.has(f.name)) {
        throw new PseudoError(`${f.name}() is defined in pseudocode and in Python. Rename one of them.`, f.line, 'py');
      }
    }
    Compiler.compileProgram(program);
    // Python is needed if the algorithm calls a Python function, or one replaces a built-in (built-ins call each other)
    const python = [...program.pythonFunctions.keys()];
    program.usesPython = python.some((name) => Builtins.table[name]) || [...calledFunctions(program)].some((name) => program.pythonFunctions.has(name));
    return program;
  }

  /** The names of your functions (pseudocode or Python) that the algorithm calls, directly or from another of your
   *  pseudocode functions. */
  function calledFunctions(program) {
    const called = new Set();
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (node.type === 'call' && !node.builtin && program.functions.has(node.callee.name) && !called.has(node.callee.name)) {
        called.add(node.callee.name);
        visit(program.functions.get(node.callee.name).body);
      }
      if (node.type === 'call' && !node.builtin && program.pythonFunctions && program.pythonFunctions.has(node.callee.name)) called.add(node.callee.name);
      Object.values(node).forEach(visit);
    };
    visit(program.body);
    return called;
  }

  return { parse, calledFunctions };
})();
