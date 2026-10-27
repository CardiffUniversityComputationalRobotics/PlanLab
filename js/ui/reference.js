/* reference.js — the Reference tab: your functions, workspace values, the language, and every built-in.
 * Built-ins are listed from Builtins.table, so a new built-in shows up here by itself.
 * Each built-in has an Edit or Replace button (see editBuiltin in functions-tab.js). */
const Reference = (() => {
  'use strict';
  const { $, escapeHtml } = Util;
  const box = $('#ref');

  const LANGUAGE = [
    ['x ← 5', 'Store a value. <code>&lt;-</code>, <code>:=</code> and <code>=</code> also work.'],
    ['(a, b) ← pop_min(Q)', 'Split a pair or list into names.'],
    ['if … then … else if … else … end if', 'Branching. <code>end</code> alone also closes a block.'],
    ['for i ← 1 to n do … end for', 'Counting loop. Add <code>step 2</code> or use <code>downto</code>.'],
    ['for each v in S do … end', 'Loop over a list, set, map (its keys), tree or graph.'],
    ['while c do … end · repeat … until c', 'Conditional loops. <code>break</code> and <code>continue</code> work inside loops.'],
    ['function f(a, b) … return x … end', 'Your own function. It replaces a built-in with the same name.'],
    ['function h(x) = dist(x, q_g)', 'A one-line function.'],
    ['global name', "Inside a function: assigning to name changes the main program's variable."],
    ['builtin.steer(a, b, step)', 'Calls the original built-in, even after you have replaced it with your own function of the same name.'],
    ['(x, y) · q.x · q.y', 'Points. <code>+ − * /</code> work on points and numbers. A pair of non-numbers, like <code>(v, x)</code>, is a two-item list.'],
    ['[a, b] · L[1] · L + M', 'Lists start at index 1. <code>+</code> joins two lists.'],
    ['M[k] ← v · M[k]', 'Maps made with <code>new_map()</code>.'],
    ['x in S · x ∉ S · x not in S', 'Membership in a list, set, map, tree or graph.'],
    ['and · or · not · = · ≠ · ≤ · ≥', 'Logic and comparisons. <code>==</code>, <code>!=</code>, <code>&lt;=</code> work too.'],
    ['failure · null · true · false · ∞', 'Special values. <code>return failure</code> means no path.'],
    ['// comment · # comment', 'Ignored. A comment right above a function becomes its description here.'],
  ];

  const WORKSPACE = [
    ['q_start', 'The start point.'],
    ['goal_samples', 'The goal samples: valid points in each goal region (a goal point is its own sample), drawn as dots. Objects → Goal samples sets how many per region.'],
    ['GOAL_CHOICE', 'How <code>sample_goal()</code> picks a goal sample: <code>"random"</code> or <code>"consecutive"</code> (Objects → Goal samples).'],
    ['goals · goal_weights', 'Every goal (points and regions) and their weights, in the order they were placed. The weights are only used if you call <code>sample_categorical(goals, goal_weights)</code>.'],
    ['q_goal · goal_region', 'The first goal point and the first goal region, or null.'],
    ['WIDTH · HEIGHT · PI · ∞', 'Workspace size (100 × 100) and constants.'],
  ];

  const DRAWING = [
    ['trees, graphs', 'Drawn while a variable holds them. Trees rooted at q_start use the first colour, others the second. Edges never passed to collision_free are dashed.'],
    ['goal samples', 'Dots in the goal regions, numbered when picked in order. A ring marks the latest pick of sample_goal().'],
    ['informed set', 'The prolate hyperspheroid (an ellipse) of each goal that sample_informed() or informed_phs() last used: shaded, with a dashed outline, a + on each focus and its transverse diameter c. Several goals are shaded as one union. It stays after the run ends.'],
    ['points', 'Point variables are drawn as labelled rings.'],
    ['labels', 'label(q, value) writes a value (such as a weight) under point q.'],
    ['sets, lists of points', 'Drawn as small circles (samples).'],
    ['paths', 'Paths from path(), shortest_path() or as_path() are drawn in orange. The list you return becomes the final path.'],
  ];

  const section = (title, rows) => `<h3>${escapeHtml(title)}</h3><dl>${rows.map(([term, text]) => `<dt>${escapeHtml(term)}</dt><dd>${text}</dd>`).join('')}</dl>`;

  /** The // comment lines right above line `line` of source. */
  function commentAbove(source, line) {
    const lines = source.split('\n'), out = [];
    for (let k = line - 2; k >= 0 && /^\s*\/\//.test(lines[k]); k--) out.unshift(lines[k].replace(/^\s*\/\/\s?/, ''));
    return out.join(' ');
  }

  function yourFunctions() {
    const program = App.program;
    if (!program || (!program.functions.size && !program.pythonFunctions.size)) {
      return '<h3>Your functions</h3><p class="empty">None yet. Use + New function, or + New Python function in the Python tab.</p>';
    }
    const rows = [...program.functions.values()].map((f) => {
      const source = f.src === 'lib' ? App.editors.lib.value : App.editors.algo.value;
      const description = commentAbove(source, f.line) || 'No description. Add a // comment line above the function.';
      const tag = (f.src === 'lib' ? 'Functions' : 'Algorithm') + (Builtins.table[f.name] ? ' · replaces built-in' : '');
      return [`${f.name}(${f.params.join(', ')})`, `${escapeHtml(description)} <span class="tag">${tag}</span>`];
    });
    for (const f of program.pythonFunctions.values()) {
      const description = f.comment || 'No description. Add a # comment line above the def.';
      rows.push([`${f.name}(${f.params.join(', ')})`, `${escapeHtml(description)} <span class="tag">Python${Builtins.table[f.name] ? ' · replaces built-in' : ''}</span>`]);
    }
    return section('Your functions', rows);
  }

  const BUILTINS_NOTE = '<p class="ref-note">Every built-in can be changed. <b>Edit</b> copies its pseudocode into the Functions tab. '
    + '<b>Replace</b> adds your own version that calls the original with <code>builtin.name(…)</code>. Either way, your version is used instead of the built-in. '
    + 'Built-ins that take a varying number of inputs (random, min, max, print, push, new_set, new_map) can be used inside your functions but not replaced.</p>';

  /** The button (and tag) after a built-in's description. */
  function actionsFor(b) {
    if (App.program && (App.program.functions.has(b.name) || App.program.pythonFunctions.has(b.name))) {
      return ` <span class="tag">replaced by yours</span><button type="button" class="btn small" data-show="${b.name}">Show yours</button>`;
    }
    const how = FunctionsTab.howToEdit(b.name);
    if (how === 'pseudocode') return ` <button type="button" class="btn small" data-edit="${b.name}">Edit</button>`;
    if (how === 'wrap') return ` <span class="tag">core</span><button type="button" class="btn small" data-edit="${b.name}">Replace</button>`;
    return ' <span class="tag">core</span>';
  }

  function builtins() {
    const groups = new Map();
    for (const b of Object.values(Builtins.table)) {
      if (!groups.has(b.group)) groups.set(b.group, []);
      groups.get(b.group).push([b.signature, escapeHtml(b.description) + actionsFor(b)]);
    }
    return BUILTINS_NOTE + [...groups].map(([group, rows]) => section(group, rows)).join('');
  }

  function render() {
    box.innerHTML = yourFunctions() + section('Workspace values', WORKSPACE) + section('Language', LANGUAGE) + builtins() + section('Drawing', DRAWING);
  }

  function init() {
    box.addEventListener('click', (e) => {
      const edit = e.target.closest('[data-edit]'), show = e.target.closest('[data-show]');
      if (edit) FunctionsTab.editBuiltin(edit.dataset.edit);
      if (show) PseudocodePanel.showFunction(show.dataset.show);
    });
  }

  return { init, render };
})();
