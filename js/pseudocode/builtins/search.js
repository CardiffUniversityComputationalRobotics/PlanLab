/* search.js — graph search and priority queues. */
(() => {
  'use strict';
  const { PriorityQueue, FAILURE, markAsPath } = Values;
  const { define, inputs } = Builtins;
  const { distance } = Geometry;

  define('shortest_path', {
    group: 'Search', signature: 'shortest_path(G, a, b)', inputs: 3,
    description: 'A* search on graph G. The shortest path from a to b, or failure. "Edit a built-in…" in the Functions tab shows it in pseudocode.',
  }, function (a, line) {
    const input = inputs('shortest_path', line);
    const G = input.graph(a[0]), start = input.point(a[1], 2), goal = input.point(a[2], 3);
    if (!G.has(start) || !G.has(goal)) return FAILURE;
    const costTo = new Map([[start, 0]]), cameFrom = new Map(), open = new PriorityQueue(), closed = new Set();
    open.push(start, distance(start, goal));
    while (open.size) {
      const u = open.pop();
      if (u === goal) {
        const path = [goal];
        for (let v = goal; v !== start;) { v = cameFrom.get(v); path.push(v); }
        return markAsPath(path.reverse());
      }
      if (closed.has(u)) continue;
      closed.add(u);
      for (const v of G.neighbors(u)) {
        const c = costTo.get(u) + distance(u, v);
        if (c < (costTo.has(v) ? costTo.get(v) : Infinity)) {
          costTo.set(v, c);
          cameFrom.set(v, u);
          open.push(v, c + distance(v, goal));
        }
      }
    }
    return FAILURE;
  });

  define('new_queue', {
    group: 'Search', signature: 'new_queue()', inputs: 0,
    description: 'An empty priority queue. The item with the smallest priority comes out first.',
  }, function () {
    return new PriorityQueue();
  });

  define('push', {
    group: 'Search', signature: 'push(Q, item, priority)', inputs: [2, 3],
    description: 'Adds item to queue Q. A priority is a number, or a list of numbers compared in order. push(list, x) adds to a list.',
  }, function (a, line) {
    if (Array.isArray(a[0]) && a.length === 2) { a[0].push(a[1]); return a[0]; }
    const input = inputs('push', line);
    const Q = input.queue(a[0]);
    input.require(a.length === 3, 'push() needs a priority: push(Q, item, priority).');
    Q.push(a[1], input.priority(a[2]));
    return null;
  });

  define('pop_min', {
    group: 'Search', signature: 'pop_min(Q)', inputs: 1,
    description: 'Removes and returns the item with the smallest priority.',
  }, function (a, line) {
    const input = inputs('pop_min', line);
    const Q = input.queue(a[0]);
    input.require(Q.size, 'pop_min(): the queue is empty. Check is_empty(Q) first.');
    return Q.pop();
  });

  define('peek_min', {
    group: 'Search', signature: 'peek_min(Q)', inputs: 1,
    description: 'The item with the smallest priority, without removing it (null if empty).',
  }, function (a, line) {
    return inputs('peek_min', line).queue(a[0]).peek();
  });

  define('min_key', {
    group: 'Search', signature: 'min_key(Q)', inputs: 1,
    description: 'The smallest priority in Q, or ∞ if Q is empty.',
  }, function (a, line) {
    return inputs('min_key', line).queue(a[0]).minPriority();
  });
})();
