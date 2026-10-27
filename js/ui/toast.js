/* toast.js — the short message at the bottom of the screen, with an optional Undo button. */
const Toast = (() => {
  'use strict';
  const { $ } = Util;
  const box = $('#toast'), message = $('#toastMsg'), undoButton = $('#toastAct');
  let timer = 0, undoAction = null;

  /** Shows text for a few seconds. If undo is a function, an Undo button calls it. */
  function show(text, undo) {
    message.textContent = text;
    undoAction = undo || null;
    undoButton.hidden = !undo;
    box.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(hide, undo ? 6000 : 3600);
  }

  function hide() { box.hidden = true; undoAction = null; }

  undoButton.addEventListener('click', () => {
    const action = undoAction;
    hide();
    if (action) action();
  });

  return { show };
})();
