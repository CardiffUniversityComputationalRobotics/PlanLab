/* algorithm-tab.js — the Pseudocode window's Algorithm tab: the algorithm menu, + New, Save a copy, Rename, Delete
 * and Restore original. The algorithms themselves (built-in, your edits to them, and your own) are kept by
 * algorithm-library.js; this file only shows them and changes them when you use the buttons.
 */
const AlgorithmTab = (() => {
  'use strict';
  const { $, escapeHtml } = Util;

  const el = {
    menu: $('#algo'), newButton: $('#algoNew'), copy: $('#algoCopy'), rename: $('#algoRename'), remove: $('#algoDelete'),
    restore: $('#algoRestore'), hint: $('#algoHint'),
    form: $('#algoForm'), formName: $('#algoName'), formOk: $('#algoFormOk'), formMessage: $('#algoFormMsg'), formCancel: $('#algoFormCancel'),
  };

  /** What + New starts with. Line 6 is where you write. */
  const NEW_ALGORITHM = (name) => `// ${name}
// q_start, goals and goal_weights come from the workspace.
// Return a path (a list of points) to have it drawn, or failure.

T ← new_tree(q_start)
// write the steps here
return failure
`;

  /* ================================================================ the menu and buttons */
  let menuSignature = '';

  /** Rebuilds the menu (only when names or "edited" marks changed) and shows the buttons that apply. */
  function refresh() {
    const algorithms = AlgorithmLibrary.all(), current = AlgorithmLibrary.current();
    const signature = current.id + '|' + algorithms.map((a) => `${a.id}:${a.name}:${a.isEdited}`).join('|');
    if (signature !== menuSignature) {
      menuSignature = signature;
      const groups = new Map();
      for (const a of algorithms) {
        if (!groups.has(a.group)) groups.set(a.group, []);
        groups.get(a.group).push(a);
      }
      el.menu.innerHTML = [...groups].map(([group, list]) => `<optgroup label="${escapeHtml(group)}">${list.map((a) =>
        `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}${a.isEdited ? ' · edited' : ''}</option>`).join('')}</optgroup>`).join('');
      el.menu.value = current.id;
    }
    el.rename.hidden = el.remove.hidden = current.isBuiltin;
    el.restore.hidden = !current.isEdited;
    el.hint.textContent = current.isEdited
      ? `Your edits to ${current.name} are kept. Restore original goes back to the built-in version.`
      : current.isBuiltin ? 'Edits are kept automatically.' : `${current.name} is one of your algorithms. Edits are kept automatically.`;
  }

  /** Puts the current algorithm's text in the editor. */
  function showCurrent() {
    App.editors.algo.value = AlgorithmLibrary.current().code;
    App.editors.algo.host.scrollTop = 0;
    PseudocodePanel.codeReplaced();
    refresh();
  }

  function switchTo(id) {
    const a = AlgorithmLibrary.select(id);
    showCurrent();
    const speed = RunPanel.suggestSpeed(a.suggestedSpeed);
    PseudocodePanel.showTab('algo');
    Toast.show(`Switched to ${a.name}.${speed ? ` Speed set to ${speed}.` : ''}`);
  }

  function removeCurrent() {
    const current = AlgorithmLibrary.current();
    if (current.isBuiltin) return;
    const undo = AlgorithmLibrary.remove(current.id);
    showCurrent();
    Toast.show(`Deleted ${current.name}.`, () => { AlgorithmLibrary.undoRemove(undo); showCurrent(); });
  }

  function restoreCurrent() {
    const current = AlgorithmLibrary.current();
    const yourText = AlgorithmLibrary.restoreOriginal(current.id);
    showCurrent();
    Toast.show(`Restored the original ${current.name}.`, () => {
      AlgorithmLibrary.setEdit(current.id, yourText);
      AlgorithmLibrary.select(current.id);
      showCurrent();
    });
  }

  /* ================================================================ the name form: + New, Save a copy, Rename */
  let formMode = null;   // 'new' | 'copy' | 'rename'

  function openForm(mode) {
    const current = AlgorithmLibrary.current();
    formMode = mode;
    FunctionsTab.closeForm();
    el.form.hidden = false;
    el.formMessage.textContent = '';
    el.formName.value = mode === 'copy' ? `${current.name} copy` : mode === 'rename' ? current.name : '';
    el.formName.placeholder = 'My planner';
    el.formOk.textContent = mode === 'new' ? 'Create' : mode === 'copy' ? 'Save copy' : 'Rename';
    el.formName.focus();
    el.formName.select();
  }

  function closeForm() { el.form.hidden = true; }

  function submitForm(e) {
    e.preventDefault();
    const name = el.formName.value.trim(), current = AlgorithmLibrary.current();
    const problem = AlgorithmLibrary.nameProblem(name, formMode === 'rename' ? current.id : null);
    if (problem) { el.formMessage.textContent = problem; return; }
    closeForm();
    if (formMode === 'rename') {
      AlgorithmLibrary.rename(current.id, name);
      refresh();
      SavedState.save();
      Toast.show(`Renamed to ${name}.`);
      return;
    }
    if (formMode === 'copy') AlgorithmLibrary.create(name, App.editors.algo.value, current.suggestedSpeed);
    else AlgorithmLibrary.create(name, NEW_ALGORITHM(name));
    showCurrent();
    if (formMode === 'new') App.editors.algo.goToLine(6);   // the "write the steps here" line
    Toast.show(formMode === 'copy' ? `Saved a copy as ${name}. You are now editing the copy.` : `Created ${name}.`);
  }

  function init() {
    el.menu.addEventListener('change', () => switchTo(el.menu.value));
    el.newButton.addEventListener('click', () => openForm('new'));
    el.copy.addEventListener('click', () => openForm('copy'));
    el.rename.addEventListener('click', () => openForm('rename'));
    el.remove.addEventListener('click', removeCurrent);
    el.restore.addEventListener('click', restoreCurrent);
    el.form.addEventListener('submit', submitForm);
    el.formCancel.addEventListener('click', closeForm);
    refresh();
  }

  return { init, refresh, closeForm };
})();
