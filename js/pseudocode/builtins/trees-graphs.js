/* trees-graphs.js — built-ins that make and query trees (RRT family) and graphs (roadmaps). */
(() => {
  'use strict';
  const { Tree, Graph, markAsPath, typeName, format } = Values;
  const { define, inputs } = Builtins;
  const { distance } = Geometry;

  /** [q, …, root] for a vertex of T, with friendly errors. */
  function toRoot(T, q, input, fname) {
    input.require(T.has(q), `${fname}(): ${format(q)} is not a vertex of this tree.`);
    const points = T.toRoot(q);
    input.require(points, `${fname}(): the tree has a cycle. Check your set_parent calls.`);
    return points;
  }

  /* ---------------------------------------------------------------- making */
  define('new_tree', {
    group: 'Trees and graphs', signature: 'new_tree(q)', inputs: 1,
    description: 'A tree whose root is q. Trees held in variables are drawn.',
  }, function (a, line) {
    return new Tree(inputs('new_tree', line).point(a[0], 1));
  });

  define('new_graph', {
    group: 'Trees and graphs', signature: 'new_graph()', inputs: 0,
    description: 'An empty undirected graph (a roadmap). Graphs held in variables are drawn.',
  }, function () {
    return new Graph();
  });

  /* ---------------------------------------------------------------- changing */
  define('add_vertex', {
    group: 'Trees and graphs', signature: 'add_vertex(T, q)', inputs: 2,
    description: 'Adds point q to tree or graph T.',
  }, function (a, line) {
    const input = inputs('add_vertex', line);
    const C = a[0], q = input.point(a[1], 2);
    input.require(C instanceof Tree || C instanceof Graph, `add_vertex() needs a tree or a graph, but got ${typeName(C)}.`);
    C.add(q);
    return null;
  });

  define('add_edge', {
    group: 'Trees and graphs', signature: 'add_edge(T, a, b)', inputs: 3,
    description: 'In a tree, makes a the parent of b. In a graph, joins a and b.',
  }, function (a, line) {
    const input = inputs('add_edge', line);
    const C = a[0], p = input.point(a[1], 2), q = input.point(a[2], 3);
    input.require(p !== q, 'add_edge(): a vertex cannot be joined to itself.');
    if (C instanceof Tree) {
      input.require(C.has(p), `add_edge(): the parent ${format(p)} is not a vertex of this tree.`);
      C.add(q);
      C.setParent(q, p);
    } else if (C instanceof Graph) {
      if (!C.connect(p, q)) return null;   // already joined
    } else {
      input.fail(`add_edge() needs a tree or a graph, but got ${typeName(C)}.`);
    }
    this.edgesAdded++;
    this.lastEdge = [p, q];   // drawn thicker
    return null;
  });

  define('remove_edge', {
    group: 'Trees and graphs', signature: 'remove_edge(G, a, b)', inputs: 3,
    description: 'Removes the edge between a and b from graph G.',
  }, function (a, line) {
    const input = inputs('remove_edge', line);
    input.graph(a[0]).disconnect(input.point(a[1], 2), input.point(a[2], 3));
    return null;
  });

  define('remove_vertex', {
    group: 'Trees and graphs', signature: 'remove_vertex(G, q)', inputs: 2,
    description: 'Removes q and its edges from graph G.',
  }, function (a, line) {
    const input = inputs('remove_vertex', line);
    input.graph(a[0]).remove(input.point(a[1], 2));
    return null;
  });

  define('set_parent', {
    group: 'Trees and graphs', signature: 'set_parent(T, q, p)', inputs: 3,
    description: 'Rewires vertex q so that its parent becomes p.',
  }, function (a, line) {
    const input = inputs('set_parent', line);
    const T = input.tree(a[0]), q = input.point(a[1], 2), p = input.point(a[2], 3);
    input.require(T.has(q) && T.has(p), 'set_parent(): both points must already be vertices of the tree.');
    input.require(p !== q, 'set_parent(): a vertex cannot be its own parent.');
    T.setParent(q, p);
    this.edgesAdded++;
    this.lastEdge = [p, q];
    return null;
  });

  define('subtree', {
    group: 'Trees and graphs', signature: 'subtree(T, q)', inputs: 2,
    description: 'A list of q and every vertex below it in tree T.',
  }, function (a, line) {
    const input = inputs('subtree', line);
    const T = input.tree(a[0]), q = input.point(a[1], 2);
    input.require(T.has(q), 'subtree(): that point is not in the tree.');
    return T.subtree(q);
  });

  define('remove_subtree', {
    group: 'Trees and graphs', signature: 'remove_subtree(T, q)', inputs: 2,
    description: 'Removes q and everything below it from tree T.',
  }, function (a, line) {
    const input = inputs('remove_subtree', line);
    const T = input.tree(a[0]), q = input.point(a[1], 2);
    input.require(T.has(q), 'remove_subtree(): that point is not in the tree.');
    input.require(q !== T.root, "remove_subtree(): can't remove the root.");
    T.removeSubtree(q);
    return null;
  });

  /* ---------------------------------------------------------------- asking */
  define('parent', {
    group: 'Trees and graphs', signature: 'parent(T, q)', inputs: 2,
    description: 'The parent of q in tree T, or null for the root (or if q is not in T).',
  }, function (a, line) {
    const input = inputs('parent', line);
    return input.tree(a[0]).parent(input.point(a[1], 2));
  });

  define('children', {
    group: 'Trees and graphs', signature: 'children(T, q)', inputs: 2,
    description: 'A list of the vertices whose parent is q.',
  }, function (a, line) {
    return inputs('children', line).tree(a[0]).children(a[1]);
  });

  define('neighbors', {
    group: 'Trees and graphs', signature: 'neighbors(G, q)', inputs: 2,
    description: 'A list of the vertices joined to q in graph G.',
  }, function (a, line) {
    return inputs('neighbors', line).graph(a[0]).neighbors(a[1]);
  });

  define('vertices', {
    group: 'Trees and graphs', signature: 'vertices(T)', inputs: 1,
    description: 'A list of the vertices of a tree or graph.',
  }, function (a, line) {
    return inputs('vertices', line).points(a[0]).slice();
  });

  define('root', {
    group: 'Trees and graphs', signature: 'root(T)', inputs: 1,
    description: 'The root vertex of tree T.',
  }, function (a, line) {
    return inputs('root', line).tree(a[0]).root;
  });

  define('cost', {
    group: 'Trees and graphs', signature: 'cost(T, q)', inputs: 2,
    description: 'Length of the tree path from the root to q.',
  }, function (a, line) {
    const input = inputs('cost', line);
    const points = toRoot(input.tree(a[0]), input.point(a[1], 2), input, 'cost');
    let total = 0;
    for (let k = 1; k < points.length; k++) total += distance(points[k - 1], points[k]);
    return total;
  });

  define('path', {
    group: 'Trees and graphs', signature: 'path(T, q)', inputs: 2,
    description: 'The path (a list of points) from the root of T to q.',
  }, function (a, line) {
    const input = inputs('path', line);
    return markAsPath(toRoot(input.tree(a[0]), input.point(a[1], 2), input, 'path').reverse());
  });

  define('as_path', {
    group: 'Trees and graphs', signature: 'as_path(list)', inputs: 1,
    description: 'Marks a list of points as a path, so it is drawn as one.',
  }, function (a, line) {
    return markAsPath(inputs('as_path', line).list(a[0]).slice());
  });

  /* ---------------------------------------------------------------- nearest neighbours (trees, graphs, sets, lists) */
  define('nearest', {
    group: 'Trees and graphs', signature: 'nearest(T, q)', inputs: 2,
    description: 'The vertex (or point) of a tree, graph, set or list closest to q.',
  }, function (a, line) {
    const input = inputs('nearest', line);
    const points = input.points(a[0]), q = input.point(a[1], 2);
    let best = null, bestSquared = Infinity;
    for (const v of points) {
      const d = (v.x - q.x) ** 2 + (v.y - q.y) ** 2;
      if (d < bestSquared) { bestSquared = d; best = v; }
    }
    return best;
  });

  define('near', {
    group: 'Trees and graphs', signature: 'near(T, q, r)', inputs: 3,
    description: 'A list of the points of a tree, graph, set or list within distance r of q.',
  }, function (a, line) {
    const input = inputs('near', line);
    const points = input.points(a[0]), q = input.point(a[1], 2), r = input.number(a[2], 3);
    return points.filter((v) => (v.x - q.x) ** 2 + (v.y - q.y) ** 2 <= r * r);
  });

  define('k_nearest', {
    group: 'Trees and graphs', signature: 'k_nearest(T, q, k)', inputs: 3,
    description: 'The k points closest to q, nearest first.',
  }, function (a, line) {
    const input = inputs('k_nearest', line);
    const points = input.points(a[0]), q = input.point(a[1], 2), k = input.number(a[2], 3);
    return points.map((v) => [distance(v, q), v]).sort((x, y) => x[0] - y[0]).slice(0, Math.max(0, Math.floor(k))).map((x) => x[1]);
  });

  define('edge', {
    group: 'Trees and graphs', signature: 'edge(a, b)', inputs: 2,
    description: 'A label for the edge between a and b (the same either way round). Handy as a set item, e.g. add(blocked, edge(a, b)).',
  }, function (a, line) {
    const input = inputs('edge', line);
    const p = input.point(a[0], 1), q = input.point(a[1], 2);
    return p.id < q.id ? `edge ${p.id}–${q.id}` : `edge ${q.id}–${p.id}`;
  });
})();
