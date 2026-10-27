/* collections.js — lists, sets and maps. */
(() => {
  'use strict';
  const { Tree, Graph, PseudoSet, PseudoMap, PriorityQueue, equal, contains, sizeOf, markAsPath, typeName } = Values;
  const { define, inputs } = Builtins;

  define('new_set', {
    group: 'Collections', signature: 'new_set()  ·  new_set(list)', inputs: [0, 1],
    description: 'A set (no duplicates). Use add, remove, and x in S.',
  }, function (a, line) {
    if (!a.length) return new PseudoSet();
    const from = a[0];
    if (from instanceof PseudoSet) return new PseudoSet(from.items);
    if (from instanceof Tree || from instanceof Graph) return new PseudoSet(from.vertices);
    return new PseudoSet(inputs('new_set', line).list(from));
  });

  define('new_map', {
    group: 'Collections', signature: 'new_map()  ·  new_map(default)', inputs: [0, 1],
    description: 'A map from keys to values: M[k] ← v and M[k]. Missing keys give default (null if not given), e.g. new_map(∞) for costs.',
  }, function (a) {
    return new PseudoMap(a.length ? a[0] : null);
  });

  define('add', {
    group: 'Collections', signature: 'add(S, x)', inputs: 2,
    description: 'Adds x to a set or list (or a vertex to a graph).',
  }, function (a, line) {
    const C = a[0], input = inputs('add', line);
    if (C instanceof PseudoSet) C.items.add(a[1]);
    else if (Array.isArray(C)) C.push(a[1]);
    else if (C instanceof Graph) C.add(input.point(a[1], 2));
    else input.fail(`add() needs a set or a list, but got ${typeName(C)}.`);
    return null;
  });

  define('remove', {
    group: 'Collections', signature: 'remove(S, x)', inputs: 2,
    description: 'Removes x from a set, list or map (does nothing if it is not there).',
  }, function (a, line) {
    const C = a[0], x = a[1];
    if (C instanceof PseudoSet) C.items.delete(x);
    else if (C instanceof PseudoMap) C.entries.delete(x);
    else if (Array.isArray(C)) { const k = C.findIndex((y) => equal(x, y)); if (k >= 0) C.splice(k, 1); }
    else if (C instanceof Graph) C.remove(x);
    else inputs('remove', line).fail(`remove() needs a set, list or map, but got ${typeName(C)}.`);
    return null;
  });

  define('contains', {
    group: 'Collections', signature: 'contains(S, x)', inputs: 2,
    description: 'Same as x in S.',
  }, function (a, line) {
    return contains(a[0], a[1], line);
  });

  define('size', {
    group: 'Collections', signature: 'size(S)', inputs: 1,
    description: 'Number of items in a list, set, map or queue, or vertices in a tree or graph.',
  }, function (a, line) {
    return sizeOf(a[0], 'size', line);
  });

  define('length', {
    group: 'Collections', signature: 'length(list)', inputs: 1,
    description: 'Same as size().',
  }, function (a, line) {
    return sizeOf(a[0], 'length', line);
  });

  define('is_empty', {
    group: 'Collections', signature: 'is_empty(S)', inputs: 1,
    description: 'true if a list, set, map or queue has no items.',
  }, function (a, line) {
    return sizeOf(a[0], 'is_empty', line) === 0;
  });

  define('clear', {
    group: 'Collections', signature: 'clear(S)', inputs: 1,
    description: 'Empties a list, set, map or queue.',
  }, function (a, line) {
    const C = a[0];
    if (C instanceof PseudoSet) C.items.clear();
    else if (C instanceof PseudoMap) C.entries.clear();
    else if (C instanceof PriorityQueue) C.clear();
    else if (Array.isArray(C)) C.length = 0;
    else inputs('clear', line).fail(`clear() needs a list, set, map or queue, but got ${typeName(C)}.`);
    return null;
  });

  define('to_list', {
    group: 'Collections', signature: 'to_list(S)', inputs: 1,
    description: 'A list of the items of a set, the keys of a map, or the vertices of a tree or graph.',
  }, function (a, line) {
    const C = a[0];
    if (C instanceof PseudoSet) return [...C.items];
    if (C instanceof PseudoMap) return [...C.entries.keys()];
    if (Array.isArray(C)) return C.slice();
    if (C instanceof Tree || C instanceof Graph) return C.vertices.slice();
    return inputs('to_list', line).fail(`to_list() can't list ${typeName(C)}.`);
  });

  define('append', {
    group: 'Collections', signature: 'append(list, x)', inputs: 2,
    description: 'Adds x to the end of the list.',
  }, function (a, line) {
    inputs('append', line).list(a[0]).push(a[1]);
    return a[0];
  });

  define('reverse', {
    group: 'Collections', signature: 'reverse(list)', inputs: 1,
    description: 'A reversed copy of the list.',
  }, function (a, line) {
    const list = inputs('reverse', line).list(a[0]);
    const reversed = list.slice().reverse();
    return list.isPath ? markAsPath(reversed) : reversed;
  });

  define('sum', {
    group: 'Collections', signature: 'sum(list)', inputs: 1,
    description: 'Adds up a list of numbers.',
  }, function (a, line) {
    const input = inputs('sum', line);
    return input.list(a[0]).reduce((total, x, k) => total + input.number(x, k + 1), 0);
  });

  define('normalize', {
    group: 'Collections', signature: 'normalize(weights)', inputs: 1,
    description: 'The weights divided by their sum, so they add up to 1.',
  }, function (a, line) {
    const input = inputs('normalize', line);
    const list = input.list(a[0]);
    const total = list.reduce((t, x, k) => t + input.number(x, k + 1), 0);
    input.require(total > 0, 'normalize(): the weights must add up to more than 0.');
    return list.map((x) => x / total);
  });
})();
