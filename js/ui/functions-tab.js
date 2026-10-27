/* functions-tab.js — the Pseudocode window's Functions tab: your pseudocode functions, shared by every algorithm.
 *
 *   + New function     the form under the toolbar. It also makes Python functions, for the Python tab's
 *                      + New Python function (see LANGUAGES).
 *   Edit a built-in…   copies a built-in's pseudocode into the tab, or wraps a core built-in (see howToEdit).
 *                      Your copy then replaces the built-in.
 *   Jump to:           a button per function in the tab.
 */
const FunctionsTab = (() => {
  'use strict';
  const { $, escapeHtml } = Util;

  const el = {
    editMenu: $('#editBuiltin'), chips: $('#fnChips'), newButton: $('#newFn'), newButtonOnAlgorithmTab: $('#newFnA'),
    form: $('#newFnForm'), formName: $('#fnName'), formInputs: $('#fnParams'), formMessage: $('#fnMsg'), formCancel: $('#fnCancel'),
  };
  const FUNCTION_LINE = /^\s*(?:function|procedure)\s+([A-Za-z_]\w*)/;
  const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const PYTHON_RESERVED = new Set(['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def',
    'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or',
    'pass', 'raise', 'return', 'try', 'while', 'with', 'yield']);

  /** [name, line] for each pseudocode function defined in text. */
  const functionLinesIn = (text) => text.split('\n')
    .map((line, k) => [FUNCTION_LINE.exec(line), k + 1])
    .filter(([m]) => m)
    .map(([m, line]) => [m[1], line]);

  /** [name, line] for each function in the Functions tab. */
  const functionLines = () => functionLinesIn(App.editors.lib.value);

  /** The "Jump to:" buttons above the Functions editor. */
  function refreshChips() {
    const fns = functionLines();
    el.chips.innerHTML = fns.length
      ? '<span>Jump to:</span>' + fns.map(([name, line]) => `<button type="button" class="chip" data-line="${line}">${escapeHtml(name)}()</button>`).join('')
      : '<span>No functions yet.</span>';
    el.chips.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => App.editors.lib.goToLine(+b.dataset.line)));
  }

  /* ================================================================ + New function / + New Python function */

  /** What the form needs to know about each language it makes functions in. */
  const LANGUAGES = {
    pseudocode: {
      tab: 'lib',
      editor: () => App.editors.lib,
      reserved: Tokenizer.RESERVED,
      reservedBy: 'the language',
      taken: (name) => (functionLines().some(([n]) => n === name) ? `Your Functions already has ${name}(). Use Jump to: above to find it.` : ''),
      outline: (signature) => `// ${signature}: say what it gives back.\nfunction ${signature}\n  result ← null\n  // write the steps here\n  return result\nend function\n`,
      added: (name) => `Added ${name}().`,
    },
    python: {
      tab: 'py',
      editor: () => App.editors.py,
      reserved: PYTHON_RESERVED,
      reservedBy: 'Python',
      taken: (name) => (PythonFunctions.scan(App.editors.py.value).has(name) ? `Your Python tab already has ${name}().`
        : App.program && App.program.functions.has(name) ? `${name}() is already a pseudocode function. Pick another name.` : ''),
      outline: (signature) => `# ${signature}: say what it gives back.\ndef ${signature}:\n    result = None\n    # write the steps here\n    return result\n`,
      added: (name) => `Added ${name}() in Python.`,
    },
  };
  let formLanguage = 'pseudocode';

  /** Shows the form, on the tab of the language: 'pseudocode' or 'python'. */
  function openForm(language) {
    formLanguage = language;
    PseudocodePanel.showTab(LANGUAGES[language].tab, true);
    AlgorithmTab.closeForm();
    el.form.hidden = false;
    el.formMessage.textContent = '';
    el.formName.value = '';
    el.formInputs.value = '';
    el.formName.focus();
  }

  function closeForm() { el.form.hidden = true; }

  /** Create: checks the name and inputs, then adds an outline of the function to its tab. */
  function createFunction(e) {
    e.preventDefault();
    const language = LANGUAGES[formLanguage];
    const name = el.formName.value.trim();
    const params = el.formInputs.value.split(',').map((s) => s.trim()).filter(Boolean);
    const problem = (text) => { el.formMessage.textContent = text; };
    if (!NAME.test(name)) return problem('A name uses letters, digits and _, and starts with a letter, like distance_to_wall.');
    if (language.reserved.has(name)) return problem(`'${name}' is a word ${language.reservedBy} uses. Pick another name.`);
    const taken = language.taken(name);
    if (taken) return problem(taken);
    const badInput = params.find((p) => !NAME.test(p) || language.reserved.has(p));
    if (badInput) return problem(`'${badInput}' can't be an input name. Separate inputs with commas, like a, b.`);
    if (new Set(params).size !== params.length) return problem('Two inputs have the same name.');

    closeForm();
    const editor = language.editor();
    const firstLine = editor.append(language.outline(`${name}(${params.join(', ')})`));
    editor.goToLine(firstLine + 3);   // the "write the steps here" line
    Toast.show(`${language.added(name)} Every algorithm can call it.${Builtins.table[name] ? ` It replaces the built-in ${name}().` : ''}`);
  }

  /* ================================================================ Edit a built-in… */

  /** The input names of a built-in with a fixed number of inputs, from its signature; null if it takes a varying number. */
  function inputsOf(builtin) {
    if (builtin.min !== builtin.max) return null;
    const m = /\(([^)]*)\)/.exec(builtin.signature);
    return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
  }

  /** A function with the built-in's name that just calls the original, ready to be changed. */
  function wrapperFor(name) {
    const builtin = Builtins.table[name], inputs = builtin && inputsOf(builtin);
    if (!inputs) return null;
    const list = inputs.join(', ');
    return `// ${name}(${list}): your version of the built-in.\n// The original: ${builtin.description}\n`
      + `// builtin.${name}(…) still calls the original, so change what happens around it.\n`
      + `function ${name}(${list})\n  result ← builtin.${name}(${list})\n  return result\nend function\n`;
  }

  /** A built-in's pseudocode: from builtin-snippets.js, or the source of a built-in written in pseudocode. */
  const pseudocodeOf = (name) => Library.snippets[name] || (Builtins.table[name] && Builtins.table[name].pseudocode) || null;

  /** Can this built-in be changed from the app? 'pseudocode' (copy its pseudocode), 'wrap' (call the original) or null. */
  function howToEdit(name) {
    if (pseudocodeOf(name)) return 'pseudocode';
    return wrapperFor(name) ? 'wrap' : null;
  }

  /** The built-ins written in pseudocode, by group: { 'RRT reward-penalty': ['heap_swap', …] }. */
  function pseudocodeGroups() {
    const groups = {};
    for (const b of Object.values(Builtins.table)) if (b.pseudocode) (groups[b.group] = groups[b.group] || []).push(b.name);
    return groups;
  }

  /** Adds your own version of a built-in to the Functions tab. It then replaces the built-in. */
  function editBuiltin(name) {
    const how = howToEdit(name);
    if (!how) return;
    PseudocodePanel.showTab('lib');
    const existing = functionLines().find(([n]) => n === name);
    if (existing) { App.editors.lib.goToLine(existing[1]); Toast.show(`Your Functions already has ${name}().`); return; }
    const before = App.editors.lib.value;
    const firstLine = App.editors.lib.append(how === 'pseudocode' ? pseudocodeOf(name) : wrapperFor(name));
    const functionLine = App.editors.lib.value.split('\n').findIndex((l, k) => k >= firstLine - 1 && l.startsWith(`function ${name}(`));
    if (functionLine >= 0) App.editors.lib.goToLine(functionLine + 1);
    Toast.show(how === 'pseudocode'
      ? `Added ${name}() in pseudocode. It now replaces the built-in.`
      : `Added your own ${name}(). It calls builtin.${name}(…), so it works the same until you change it.`,
      () => { App.editors.lib.value = before; PseudocodePanel.codeReplaced(); });
  }

  /** "All of …": adds every function of a group of built-ins written in pseudocode that the tab doesn't have yet. */
  function editBuiltinGroup(group) {
    const have = new Set(functionLines().map(([n]) => n));
    const names = (pseudocodeGroups()[group] || []).filter((n) => !have.has(n));
    PseudocodePanel.showTab('lib');
    if (!names.length) { Toast.show(`Your Functions already has all the ${group} functions.`); return; }
    const before = App.editors.lib.value;
    const firstLine = App.editors.lib.append(`// ---------------------------------------------------------------- ${group}\n\n`
      + names.map((n) => Builtins.table[n].pseudocode).join('\n'));
    App.editors.lib.goToLine(firstLine);
    Toast.show(`Added ${names.length} ${group} functions in pseudocode. They now replace the built-ins.`,
      () => { App.editors.lib.value = before; PseudocodePanel.codeReplaced(); });
  }

  function buildEditMenu() {
    const option = (name, suffix) => `<option value="${name}">${name}()${suffix}</option>`;
    const pseudocode = Object.keys(Library.snippets);
    const core = Object.keys(Builtins.table).filter((name) => howToEdit(name) === 'wrap');
    // the built-ins written in pseudocode: one heading per group, with an option to copy them all
    const groups = Object.entries(pseudocodeGroups()).map(([group, names]) => `<optgroup label="${escapeHtml(group)}">`
      + `<option value="group:${escapeHtml(group)}">All ${names.length} ${escapeHtml(group)} functions</option>${names.map((n) => option(n, '')).join('')}</optgroup>`);
    el.editMenu.innerHTML = '<option value="">Edit a built-in…</option>'
      + `<optgroup label="Copy its pseudocode and change it">${pseudocode.map((n) => option(n, '')).join('')}</optgroup>`
      + groups.join('')
      + `<optgroup label="Core: replace it with your own version">${core.map((n) => option(n, ' · core')).join('')}</optgroup>`;
  }

  function init() {
    buildEditMenu();
    el.editMenu.addEventListener('change', () => {
      const name = el.editMenu.value;
      el.editMenu.value = '';
      if (name.startsWith('group:')) editBuiltinGroup(name.slice(6)); else editBuiltin(name);
    });
    el.newButton.addEventListener('click', () => openForm('pseudocode'));
    el.newButtonOnAlgorithmTab.addEventListener('click', () => openForm('pseudocode'));
    el.formCancel.addEventListener('click', closeForm);
    el.form.addEventListener('submit', createFunction);
    refreshChips();
  }

  return { init, refreshChips, functionLines, functionLinesIn, openForm, closeForm, editBuiltin, howToEdit };
})();
