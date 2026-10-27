/* code-editor.js — a code editor: a <textarea> laid over a syntax-highlighted copy of its text.
 *
 * The textarea's text is transparent; the coloured <pre> behind it shows the same text in the
 * same font, so they line up. Two bars behind both mark the line being run and an error line.
 * Tab indents, Shift+Tab outdents, Enter keeps the indent (and adds one after `then`, `do`, …).
 * The Python tab uses language 'python': Python colours, and 4-space indents (one more after a line ending in ':').
 */
const CodeEditor = (() => {
  'use strict';
  const { escapeHtml } = Util;

  const KEYWORDS = new Set([...Tokenizer.RESERVED, 'each', 'step', 'builtin', ...Tokenizer.END_ALIASES]);
  // comment | name | number | text | arrow | anything else
  const TOKEN = /(\/\/.*|#.*|▷.*)|([A-Za-z_À-ɏͰ-Ͽ][A-Za-z0-9_À-ɏͰ-Ͽ']*)|(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+|∞)|("[^"]*"?|'[^']*'?)|(←|<-|:=)|([\s\S])/g;

  /* ---------------------------------------------------------------- highlighting */
  let userFunctions = new Set();

  /** Remembers the names of your functions so they are coloured. Returns true if they changed. */
  function setUserFunctions(names) {
    if ([...names].join() === [...userFunctions].join()) return false;
    userFunctions = new Set(names);
    return true;
  }

  function classOf(word) {
    if (KEYWORDS.has(word)) return 's-k';
    if (Builtins.table[word] || userFunctions.has(word)) return 's-f';
    if (Runner.WORKSPACE_NAMES.includes(word)) return 's-w';
    if (/^[A-Z][A-Z0-9_]*$/.test(word)) return 's-u';   // CONSTANTS
    return '';
  }

  /* Python: keywords, Python's own functions, and the ones PlanLab's Python worker provides */
  const PY_KEYWORDS = new Set(['and', 'as', 'assert', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally',
    'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try',
    'while', 'with', 'yield']);
  const PY_FUNCTIONS = new Set(['abs', 'all', 'any', 'bool', 'dict', 'enumerate', 'filter', 'float', 'int', 'isinstance', 'len', 'list',
    'map', 'max', 'min', 'print', 'range', 'reversed', 'round', 'set', 'sorted', 'str', 'sum', 'tuple', 'zip',
    'Point', 'dist', 'norm', 'steer']);
  const PY_CONSTANTS = new Set(['True', 'False', 'None', 'inf', 'failure']);
  // comment | name | number | text | anything else
  const PY_TOKEN = /(#.*)|([A-Za-z_]\w*)|(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)|("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?)|([\s\S])/g;
  let pythonFunctions = new Set();

  /** Remembers the names of your Python functions so they are coloured. Returns true if they changed. */
  function setPythonFunctions(names) {
    if ([...names].join() === [...pythonFunctions].join()) return false;
    pythonFunctions = new Set(names);
    return true;
  }

  function highlightPython(line) {
    let html = '';
    for (const [text, comment, word, number, string] of line.matchAll(PY_TOKEN)) {
      let cls = '';
      if (comment) cls = 's-c';
      else if (word) cls = PY_KEYWORDS.has(word) ? 's-k' : PY_FUNCTIONS.has(word) || pythonFunctions.has(word) ? 's-f' : PY_CONSTANTS.has(word) ? 's-u' : '';
      else if (number) cls = 's-n';
      else if (string) cls = 's-s';
      html += cls ? `<span class="${cls}">${escapeHtml(text)}</span>` : escapeHtml(text);
    }
    return html;
  }

  function highlight(line) {
    let html = '';
    for (const [text, comment, word, number, string, arrow] of line.matchAll(TOKEN)) {
      let cls = '';
      if (comment) cls = 's-c';
      else if (word) cls = classOf(word);
      else if (number) cls = 's-n';
      else if (string) cls = 's-s';
      else if (arrow) cls = 's-a';
      html += cls ? `<span class="${cls}">${escapeHtml(text)}</span>` : escapeHtml(text);
    }
    return html;
  }

  /* ---------------------------------------------------------------- an editor */

  /** Builds an editor inside host. onInput(editor) runs after every edit the user types. language: 'pseudocode' or 'python'. */
  function create(host, textareaId, label, onInput, language = 'pseudocode') {
    const colour = language === 'python' ? highlightPython : highlight;
    host.innerHTML = `<div class="gutter" aria-hidden="true"></div>
      <div class="code-area">
        <div class="line-bar act" hidden></div><div class="line-bar err" hidden></div>
        <pre class="hl" aria-hidden="true"></pre>
        <textarea id="${textareaId}" spellcheck="false" wrap="off" autocomplete="off" autocapitalize="off" aria-label="${escapeHtml(label)}"></textarea>
      </div>`;
    const textarea = host.querySelector('textarea'), pre = host.querySelector('.hl'), gutter = host.querySelector('.gutter');
    const activeBar = host.querySelector('.line-bar.act'), errorBar = host.querySelector('.line-bar.err');
    let lineCount = 0, activeLine = 0, errorLine = 0;

    const lineHeight = () => parseFloat(getComputedStyle(host).lineHeight) || 20;
    const lineTop = (line) => (parseFloat(getComputedStyle(pre).paddingTop) || 10) + (line - 1) * lineHeight();
    const markGutter = () => {
      [...gutter.children].forEach((n, k) => {
        n.classList.toggle('act', k + 1 === activeLine);
        n.classList.toggle('err', k + 1 === errorLine);
      });
    };

    const editor = {
      host,
      textarea,
      get value() { return textarea.value; },
      set value(text) { textarea.value = text; editor.render(); },

      /** Redraws the highlighted copy and the line numbers. */
      render() {
        const lines = textarea.value.split('\n');
        pre.innerHTML = lines.map((l) => `<div class="cl">${colour(l)}</div>`).join('');
        if (lines.length !== lineCount) {
          lineCount = lines.length;
          gutter.innerHTML = lines.map((_, k) => `<div>${k + 1}</div>`).join('');
        }
        markGutter();
      },

      /** Marks the line being run (0 hides the mark). */
      setActive(line, scroll) {
        line = line || 0;
        if (line !== activeLine) {
          activeLine = line;
          activeBar.hidden = !line;
          if (line) activeBar.style.top = lineTop(line) + 'px';
          markGutter();
        }
        if (scroll && line) editor.scrollTo(line);
      },

      /** Marks an error line (0 hides the mark). */
      setError(line) {
        errorLine = line || 0;
        errorBar.hidden = !errorLine;
        if (errorLine) errorBar.style.top = lineTop(errorLine) + 'px';
        markGutter();
      },

      /** Scrolls so the line is in view. */
      scrollTo(line) {
        if (host.hidden) return;
        const top = lineTop(line), h = lineHeight();
        if (top < host.scrollTop + h) host.scrollTop = Math.max(0, top - h * 2);
        else if (top + h > host.scrollTop + host.clientHeight - h) host.scrollTop = top - host.clientHeight + h * 4;
      },

      /** Types text at the cursor, so it can be undone with Ctrl+Z. */
      insert(text) {
        textarea.focus({ preventScroll: true });
        let typed = false;
        try { typed = document.execCommand('insertText', false, text); } catch (e) { typed = false; }
        if (!typed) {
          textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, 'end');
          textarea.dispatchEvent(new Event('input'));
        }
      },

      /** Adds a block of text at the end, after a blank line. Returns the line it starts on. */
      append(text) {
        const v = textarea.value;
        const gap = v.length === 0 ? '' : v.endsWith('\n\n') ? '' : v.endsWith('\n') ? '\n' : '\n\n';
        textarea.focus({ preventScroll: true });
        textarea.setSelectionRange(v.length, v.length);
        editor.insert(gap + text);
        return (v + gap).split('\n').length;
      },

      /** Puts the cursor at the end of a line and scrolls to it. */
      goToLine(line) {
        const lines = textarea.value.split('\n');
        let pos = 0;
        for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
        pos += (lines[line - 1] || '').length;
        textarea.focus({ preventScroll: true });
        textarea.setSelectionRange(pos, pos);
        editor.scrollTo(line);
      },
    };

    textarea.addEventListener('keydown', (e) => onKeyDown(e, editor, language === 'python' ? 4 : 2));
    textarea.addEventListener('input', () => { editor.render(); onInput(editor); });
    // The textarea is as big as the code, so it should never scroll by itself. If a browser scrolls it
    // anyway (to show the cursor), put it back, or the typed text would drift away from the coloured copy.
    textarea.addEventListener('scroll', () => { textarea.scrollTop = 0; textarea.scrollLeft = 0; });
    return editor;
  }

  /* ---------------------------------------------------------------- keys */
  function onKeyDown(e, editor, width) {
    const ta = editor.textarea, python = width === 4;
    if (e.key === 'Tab') {
      e.preventDefault();
      if (!e.shiftKey) { editor.insert(' '.repeat(width)); return; }
      const v = ta.value, at = ta.selectionStart, lineStart = v.lastIndexOf('\n', at - 1) + 1;
      const n = /^ */.exec(v.slice(lineStart, lineStart + width))[0].length;
      if (n) {
        ta.setSelectionRange(lineStart, lineStart + n);
        editor.insert('');
        ta.setSelectionRange(Math.max(lineStart, at - n), Math.max(lineStart, at - n));
      }
    } else if (e.key === 'Enter' && !e.isComposing) {
      const v = ta.value, at = ta.selectionStart, lineStart = v.lastIndexOf('\n', at - 1) + 1;
      const before = v.slice(lineStart, at);
      const indent = /^[ \t]*/.exec(before)[0];
      const code = before.replace(python ? /#.*$/ : /\/\/.*$/, '').trim();
      const opensBlock = python ? code.endsWith(':')
        : /\b(then|do)$/.test(code) || /^(else|repeat)$/.test(code)
          || (/^(function|procedure)\b/.test(code) && !/[=←]/.test(code.split(')').slice(1).join(')')));
      e.preventDefault();
      editor.insert('\n' + indent + (opensBlock ? ' '.repeat(width) : ''));
    } else if (e.key === 'Escape') {
      ta.blur();   // so keyboard users can Tab out of the editor
    }
  }

  return { create, setUserFunctions, setPythonFunctions };
})();
