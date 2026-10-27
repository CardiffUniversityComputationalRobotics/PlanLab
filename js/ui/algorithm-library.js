/* algorithm-library.js — every algorithm in the Algorithm tab's menu, and your changes to them.
 *
 * Built-in algorithms come from js/algorithms/. You can edit any of them: your text is kept
 * (the menu marks it "edited") until you choose Restore original. Your own algorithms
 * ("My algorithms") are made with + New or Save a copy, and can be renamed and deleted.
 * Edits are kept as you type; saved-state.js stores all of this in the browser.
 */
const AlgorithmLibrary = (() => {
  'use strict';

  let currentId = 'rrt';
  const edits = new Map();   // built-in id → your edited code
  let mine = [];             // your algorithms: { id, name, code, suggestedSpeed }

  const builtin = (id) => Algorithms.get(id);

  /** One algorithm: { id, name, group, code, isBuiltin, isEdited, suggestedSpeed }, or null. */
  function get(id) {
    const b = builtin(id);
    if (b) {
      return { id, name: b.name, group: b.group, code: edits.has(id) ? edits.get(id) : b.code, isBuiltin: true, isEdited: edits.has(id), suggestedSpeed: b.suggestedSpeed };
    }
    const m = mine.find((a) => a.id === id);
    return m ? { ...m, group: 'My algorithms', isBuiltin: false, isEdited: false } : null;
  }

  /** Built-ins in menu order, then yours. */
  const all = () => [...Algorithms.list.map((a) => get(a.id)), ...mine.map((a) => get(a.id))];
  const current = () => get(currentId) || get('rrt');

  function select(id) {
    if (get(id)) currentId = id;
    return current();
  }

  /** The Algorithm editor changed: keep the text for the current algorithm. */
  function update(code) {
    const b = builtin(currentId);
    if (b) {
      if (code === b.code) edits.delete(currentId);   // typed back to the original
      else edits.set(currentId, code);
      return;
    }
    const m = mine.find((a) => a.id === currentId);
    if (m) m.code = code;
  }

  /** Why a name can't be used, or '' if it can. */
  function nameProblem(name, exceptId = null) {
    const clean = name.trim();
    if (!clean) return 'Give it a name.';
    if (clean.length > 40) return 'Use 40 characters or fewer.';
    if (all().some((a) => a.id !== exceptId && a.name.toLowerCase() === clean.toLowerCase())) return `There is already an algorithm called ${clean}.`;
    return '';
  }

  /** Adds one of your algorithms and makes it the current one. */
  function create(name, code, suggestedSpeed = 1000) {
    let n = mine.length + 1;
    while (mine.some((a) => a.id === `my-${n}`)) n++;
    const algorithm = { id: `my-${n}`, name: name.trim(), code, suggestedSpeed };
    mine.push(algorithm);
    currentId = algorithm.id;
    return get(algorithm.id);
  }

  function rename(id, name) {
    const m = mine.find((a) => a.id === id);
    if (m) m.name = name.trim();
  }

  /** Deletes one of your algorithms. Returns what undoRemove() needs. */
  function remove(id) {
    const index = mine.findIndex((a) => a.id === id);
    if (index < 0) return null;
    const [removed] = mine.splice(index, 1);
    if (currentId === id) currentId = 'rrt';
    return { removed, index };
  }

  function undoRemove({ removed, index }) {
    mine.splice(index, 0, removed);
    currentId = removed.id;
  }

  /** Throws away your edits to a built-in. Returns them, for Undo. */
  function restoreOriginal(id) {
    const code = edits.get(id);
    edits.delete(id);
    return code;
  }

  function setEdit(id, code) { if (builtin(id) && typeof code === 'string') edits.set(id, code); }


  /* ---------------------------------------------------------------- saving */
  function toJSON() {
    return { current: currentId, edits: Object.fromEntries(edits), mine };
  }

  function load(data) {
    if (!data || typeof data !== 'object') return;
    edits.clear();
    for (const [id, code] of Object.entries(data.edits || {})) setEdit(id, code);
    mine = (Array.isArray(data.mine) ? data.mine : [])
      .filter((a) => a && typeof a.id === 'string' && typeof a.name === 'string' && typeof a.code === 'string' && !builtin(a.id))
      .map((a) => ({ id: a.id, name: a.name, code: a.code, suggestedSpeed: Number.isFinite(a.suggestedSpeed) ? a.suggestedSpeed : 1000 }));
    if (get(data.current)) currentId = data.current;
  }


  return { all, current, select, update, nameProblem, create, rename, remove, undoRemove, restoreOriginal, setEdit, toJSON, load };
})();
