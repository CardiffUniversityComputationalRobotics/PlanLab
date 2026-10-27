/* values.js — the values pseudocode works with, and the operators between them.
 *
 *   in pseudocode                 in JavaScript
 *   number, text, true / false    number, string, boolean
 *   null · failure                null · FAILURE
 *   point (x, y)                  Point
 *   list [a, b] · path            Array (a path is an Array with isPath = true, so it is drawn)
 *   tree · graph                  Tree · Graph
 *   set · map · queue             PseudoSet · PseudoMap · PriorityQueue
 *   goal region                   { region: true, x0, x1, y0, y1 }
 */
const Values = (() => {
  'use strict';
  const { fixed } = Util;

  /** A mistake in the user's pseudocode. src says which editor it is in: 'algo' or 'lib'. */
  class PseudoError extends Error {
    constructor(message, line, src) { super(message); this.line = line; this.src = src; }
  }

  /* ================================================================ points */
  let nextPointId = 0;

  /** A point in the workspace. The id names it in edges; ids start again for every run. */
  class Point {
    constructor(x, y) { this.x = x; this.y = y; this.id = ++nextPointId; }
  }
  const resetPointIds = () => { nextPointId = 0; };

  /** The value of the word `failure`. */
  const FAILURE = Object.freeze({ failure: true });

  /* ================================================================ trees and graphs */
  let nextStructureId = 0;

  /** A tree: every vertex except the root has one parent. */
  class Tree {
    constructor(root) {
      this.id = ++nextStructureId;
      this.root = root;
      this.vertices = [root];
      this.members = new Set([root]);
      this.parentOf = new Map();
    }
    has(q) { return this.members.has(q); }
    add(q) { if (!this.members.has(q)) { this.vertices.push(q); this.members.add(q); } }
    setParent(q, p) { this.parentOf.set(q, p); }
    parent(q) { return this.parentOf.get(q) || null; }
    children(q) { return this.vertices.filter((v) => this.parentOf.get(v) === q); }

    /** q and every vertex below it. */
    subtree(q) {
      const kids = new Map();
      for (const v of this.vertices) {
        const p = this.parentOf.get(v);
        if (p) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(v); }
      }
      const out = [q], seen = new Set([q]), stack = [q];
      while (stack.length) {
        for (const c of kids.get(stack.pop()) || []) if (!seen.has(c)) { seen.add(c); out.push(c); stack.push(c); }
      }
      return out;
    }

    removeSubtree(q) {
      const gone = new Set(this.subtree(q));
      this.vertices = this.vertices.filter((v) => !gone.has(v));
      for (const v of gone) { this.members.delete(v); this.parentOf.delete(v); }
    }

    /** [q, parent of q, …, root], or null if the parents form a loop. */
    toRoot(q) {
      const out = [q];
      let guard = this.vertices.length + 2;
      for (let cur = q; this.parentOf.has(cur);) {
        cur = this.parentOf.get(cur);
        out.push(cur);
        if (--guard < 0) return null;
      }
      return out;
    }

    /** All edges as [parent, child] pairs. */
    edges() {
      const out = [];
      for (const v of this.vertices) { const p = this.parentOf.get(v); if (p) out.push([p, v]); }
      return out;
    }
  }

  /** An undirected graph (a roadmap). */
  class Graph {
    constructor() {
      this.id = ++nextStructureId;
      this.vertices = [];
      this.adjacency = new Map();   // vertex → Set of neighbours
      this.edgeCount = 0;
    }
    has(q) { return this.adjacency.has(q); }
    add(q) { if (!this.adjacency.has(q)) { this.vertices.push(q); this.adjacency.set(q, new Set()); } }

    /** Joins a and b. Returns false if they were already joined. */
    connect(a, b) {
      this.add(a); this.add(b);
      if (this.adjacency.get(a).has(b)) return false;
      this.adjacency.get(a).add(b);
      this.adjacency.get(b).add(a);
      this.edgeCount++;
      return true;
    }
    disconnect(a, b) {
      if (this.has(a) && this.adjacency.get(a).delete(b)) { this.adjacency.get(b).delete(a); this.edgeCount--; }
    }
    remove(q) {
      if (!this.has(q)) return;
      for (const u of this.adjacency.get(q)) { this.adjacency.get(u).delete(q); this.edgeCount--; }
      this.adjacency.delete(q);
      this.vertices = this.vertices.filter((v) => v !== q);
    }
    neighbors(q) { return this.has(q) ? [...this.adjacency.get(q)] : []; }

    /** All edges, each once, as [a, b] pairs. */
    edges() {
      const out = [];
      for (const v of this.vertices) for (const u of this.adjacency.get(v)) if (v.id < u.id) out.push([v, u]);
      return out;
    }
  }

  /* ================================================================ sets, maps, priority queues */
  class PseudoSet {
    constructor(items) { this.items = new Set(items || []); }
  }

  /** Keys that are not there give the fallback value, e.g. new_map(∞) for costs. */
  class PseudoMap {
    constructor(fallback = null) { this.entries = new Map(); this.fallback = fallback; }
    get(key) { return this.entries.has(key) ? this.entries.get(key) : this.fallback; }
    set(key, value) { this.entries.set(key, value); }
  }

  /** Is priority a lower than b? A priority is a number or a list of numbers compared item by item. */
  function priorityLess(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a < b;
    const A = Array.isArray(a) ? a : [a], B = Array.isArray(b) ? b : [b];
    for (let i = 0; i < Math.max(A.length, B.length); i++) {
      const x = i < A.length ? A[i] : -Infinity, y = i < B.length ? B[i] : -Infinity;
      if (x < y) return true;
      if (x > y) return false;
    }
    return false;
  }

  /** A binary heap. The item with the lowest priority comes out first; equal priorities come out in the order they went in. */
  class PriorityQueue {
    constructor() { this.heap = []; this.count = 0; }
    get size() { return this.heap.length; }

    push(item, priority) {
      const heap = this.heap;
      heap.push({ item, priority, order: this.count++ });
      for (let i = heap.length - 1; i > 0;) {
        const parent = (i - 1) >> 1;
        if (!this.before(i, parent)) break;
        [heap[i], heap[parent]] = [heap[parent], heap[i]];
        i = parent;
      }
    }

    pop() {
      const heap = this.heap, top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ;) {
          const left = 2 * i + 1, right = left + 1;
          let smallest = i;
          if (left < heap.length && this.before(left, smallest)) smallest = left;
          if (right < heap.length && this.before(right, smallest)) smallest = right;
          if (smallest === i) break;
          [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
          i = smallest;
        }
      }
      return top.item;
    }

    peek() { return this.heap.length ? this.heap[0].item : null; }
    minPriority() { return this.heap.length ? this.heap[0].priority : Infinity; }
    clear() { this.heap = []; }

    /** Should heap entry i come out before entry j? */
    before(i, j) {
      const a = this.heap[i], b = this.heap[j];
      if (priorityLess(a.priority, b.priority)) return true;
      if (priorityLess(b.priority, a.priority)) return false;
      return a.order < b.order;
    }
  }

  /* ================================================================ type tests */
  const isNumber = (v) => typeof v === 'number';
  const isPoint = (v) => v instanceof Point;
  const isRegion = (v) => !!(v && v.region === true);
  const markAsPath = (list) => { list.isPath = true; return list; };

  /** A number naming the edge between two points, the same either way round. */
  const edgeKey = (a, b) => (a.id < b.id ? a.id * 67108864 + b.id : b.id * 67108864 + a.id);

  /* ================================================================ describing values (errors, print, Variables panel) */
  function typeName(v) {
    if (v === null || v === undefined) return 'null';
    if (v === FAILURE) return 'failure';
    if (isNumber(v)) return 'a number';
    if (typeof v === 'boolean') return 'true/false';
    if (typeof v === 'string') return 'text';
    if (isPoint(v)) return 'a point';
    if (v instanceof Tree) return 'a tree';
    if (v instanceof Graph) return 'a graph';
    if (v instanceof PseudoSet) return 'a set';
    if (v instanceof PseudoMap) return 'a map';
    if (v instanceof PriorityQueue) return 'a queue';
    if (Array.isArray(v)) return v.isPath ? 'a path' : 'a list';
    if (isRegion(v)) return 'a goal region';
    return 'a value';
  }

  /** A short readable form of a value. nested > 0 is used inside lists. */
  function format(v, nested = 0) {
    if (v === null || v === undefined) return 'null';
    if (v === FAILURE) return 'failure';
    if (isNumber(v)) {
      if (!isFinite(v)) return Number.isNaN(v) ? 'NaN' : (v > 0 ? '∞' : '-∞');
      return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
    }
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'string') return nested ? JSON.stringify(v) : v;
    if (isPoint(v)) return `(${fixed(v.x, 2)}, ${fixed(v.y, 2)})`;
    if (v instanceof Tree) return `tree · ${v.vertices.length} vertices`;
    if (v instanceof Graph) return `graph · ${v.vertices.length} vertices, ${v.edgeCount} edges`;
    if (v instanceof PseudoSet) return `set · ${v.items.size} items`;
    if (v instanceof PseudoMap) return `map · ${v.entries.size} entries`;
    if (v instanceof PriorityQueue) return `queue · ${v.size} items`;
    if (Array.isArray(v)) {
      if (v.isPath) return `path · ${v.length} points`;
      return v.length <= 3 && nested < 1 ? '[' + v.map((x) => format(x, nested + 1)).join(', ') + ']' : `list · ${v.length} items`;
    }
    if (isRegion(v)) return `region [${format(v.x0)}, ${format(v.x1)}] × [${format(v.y0)}, ${format(v.y1)}]`;
    return String(v);
  }

  /* ================================================================ operators */

  /** What counts as true in `if` and `while`: everything except false, null, 0, failure and empty text. */
  const truthy = (v) => !(v === false || v === null || v === undefined || v === 0 || v === FAILURE || v === '');

  /** `=`: points are equal when their coordinates are; anything else must be the same value. */
  function equal(a, b) {
    if (isPoint(a) && isPoint(b)) return a.x === b.x && a.y === b.y;
    return a === b;
  }

  function binaryOp(op, a, b, line) {
    switch (op) {
      case '+':
        if (isNumber(a) && isNumber(b)) return a + b;
        if (isPoint(a) && isPoint(b)) return new Point(a.x + b.x, a.y + b.y);
        if (Array.isArray(a) && Array.isArray(b)) { const joined = a.concat(b); return a.isPath || b.isPath ? markAsPath(joined) : joined; }
        if (typeof a === 'string' || typeof b === 'string') return format(a) + format(b);
        break;
      case '-':
        if (isNumber(a) && isNumber(b)) return a - b;
        if (isPoint(a) && isPoint(b)) return new Point(a.x - b.x, a.y - b.y);
        break;
      case '*':
        if (isNumber(a) && isNumber(b)) return a * b;
        if (isPoint(a) && isNumber(b)) return new Point(a.x * b, a.y * b);
        if (isNumber(a) && isPoint(b)) return new Point(a * b.x, a * b.y);
        break;
      case '/':
        if (isNumber(a) && isNumber(b)) return a / b;
        if (isPoint(a) && isNumber(b)) return new Point(a.x / b, a.y / b);
        break;
      case '%': if (isNumber(a) && isNumber(b)) return ((a % b) + b) % b; break;
      case '^': if (isNumber(a) && isNumber(b)) return a ** b; break;
      case '<': if (isNumber(a) && isNumber(b)) return a < b; break;
      case '<=': if (isNumber(a) && isNumber(b)) return a <= b; break;
      case '>': if (isNumber(a) && isNumber(b)) return a > b; break;
      case '>=': if (isNumber(a) && isNumber(b)) return a >= b; break;
      case '=': case '==': return equal(a, b);
      case '!=': return !equal(a, b);
      case 'in': return contains(b, a, line);
      case 'notin': return !contains(b, a, line);
    }
    throw new PseudoError(`Can't use '${op}' with ${typeName(a)} and ${typeName(b)}.`, line);
  }

  function negate(v, line) {
    if (isNumber(v)) return -v;
    if (isPoint(v)) return new Point(-v.x, -v.y);
    throw new PseudoError(`Can't negate ${typeName(v)}.`, line);
  }

  /** `x in container` */
  function contains(container, x, line) {
    if (container instanceof Tree || container instanceof Graph) return container.has(x);
    if (container instanceof PseudoSet) return container.items.has(x);
    if (container instanceof PseudoMap) return container.entries.has(x);
    if (Array.isArray(container)) return container.some((y) => equal(x, y));
    if (typeof container === 'string') return typeof x === 'string' && container.includes(x);
    throw new PseudoError(`'in' needs a list, set, map, tree or graph on its right, not ${typeName(container)}.`, line);
  }

  /** `o.name` */
  function member(o, name, line) {
    if (isPoint(o) && (name === 'x' || name === 'y')) return o[name];
    if (Array.isArray(o) && (name === 'length' || name === 'size')) return o.length;
    if ((o instanceof Tree || o instanceof Graph) && name === 'size') return o.vertices.length;
    if (o instanceof Tree && name === 'root') return o.root;
    if (isRegion(o) && ['x0', 'x1', 'y0', 'y1'].includes(name)) return o[name];
    const t = typeName(o);
    throw new PseudoError(`${t[0].toUpperCase() + t.slice(1)} has no field '${name}'.`, line);
  }

  /** `o[k]` — lists count from 1; maps take any key. */
  function getIndex(o, k, line) {
    if (o instanceof PseudoMap) return o.get(k);
    if (!Array.isArray(o)) throw new PseudoError(`Only lists and maps can be indexed with [ ], not ${typeName(o)}.`, line);
    if (!Number.isInteger(k) || k < 1 || k > o.length) throw new PseudoError(`Index ${format(k)} is outside the list (it has ${o.length} items; lists start at 1).`, line);
    return o[k - 1];
  }

  /** `o[k] ← v` — a list may also grow by one at the end. */
  function setIndex(o, k, v, line) {
    if (o instanceof PseudoMap) { o.set(k, v); return; }
    if (!Array.isArray(o)) throw new PseudoError(`Only lists and maps can be indexed with [ ], not ${typeName(o)}.`, line);
    if (!Number.isInteger(k) || k < 1 || k > o.length + 1) throw new PseudoError(`Index ${format(k)} is outside the list (it has ${o.length} items; lists start at 1).`, line);
    o[k - 1] = v;
  }

  /** `(a, b)` is a point when both are numbers, otherwise a list (a pair such as an edge). */
  const makePair = (items) => (items.length === 2 && isNumber(items[0]) && isNumber(items[1]) ? new Point(items[0], items[1]) : items);

  /* ================================================================ container helpers for built-ins */

  /** The points in a tree, graph, set or list. */
  function pointsIn(container, fname, line) {
    if (container instanceof Tree || container instanceof Graph) return container.vertices;
    if (container instanceof PseudoSet) return [...container.items].filter(isPoint);
    if (Array.isArray(container)) return container.filter(isPoint);
    throw new PseudoError(`${fname}() needs a tree, graph, set or list of points, but got ${typeName(container)}.`, line);
  }

  /** How many items a value holds. */
  function sizeOf(v, fname, line) {
    if (v instanceof Tree || v instanceof Graph) return v.vertices.length;
    if (v instanceof PseudoSet) return v.items.size;
    if (v instanceof PseudoMap) return v.entries.size;
    if (v instanceof PriorityQueue) return v.size;
    if (Array.isArray(v) || typeof v === 'string') return v.length;
    throw new PseudoError(`${fname}() can't measure ${typeName(v)}.`, line);
  }

  return {
    PseudoError, Point, resetPointIds, FAILURE, Tree, Graph, PseudoSet, PseudoMap, PriorityQueue,
    isNumber, isPoint, isRegion, markAsPath, edgeKey, typeName, format,
    truthy, equal, binaryOp, negate, contains, member, getIndex, setIndex, makePair, pointsIn, sizeOf,
  };
})();
