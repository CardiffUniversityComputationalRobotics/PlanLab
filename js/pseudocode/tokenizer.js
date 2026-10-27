/* tokenizer.js — splits pseudocode text into tokens.
 *
 * A token is { t, v, line } where t is one of
 *   'num'  a number (v is the number)        'str'  quoted text
 *   'id'   a name or keyword                 'op'   an operator or bracket
 *   'nl'   the end of a line                 'eof'  the end of the text
 * Different spellings give the same token: ← <- := all give '←', ≤ gives '<=',
 * ∈ gives the word 'in', and endif, endfor, … give 'end'. Comments (// # ▷) are skipped.
 */
const Tokenizer = (() => {
  'use strict';
  const { PseudoError } = Values;

  /** Words that cannot be used as names. */
  const RESERVED = new Set(['if', 'then', 'else', 'elif', 'elseif', 'end', 'for', 'to', 'downto', 'do', 'while', 'repeat', 'until',
    'return', 'break', 'continue', 'function', 'procedure', 'global', 'and', 'or', 'not', 'in', 'true', 'false', 'null', 'nil', 'failure', 'mod']);
  const END_ALIASES = new Set(['endif', 'endfor', 'endwhile', 'endfunction', 'endprocedure']);

  /** [spelling, token]. Longer spellings come first, so '<=' wins over '<'. */
  const OPERATORS = [
    ['←', '←'], ['<-', '←'], [':=', '←'],
    ['==', '=='], ['!=', '!='], ['<=', '<='], ['>=', '>='], ['≤', '<='], ['≥', '>='], ['≠', '!='], ['∉', 'notin'],
    ['&&', 'and'], ['||', 'or'], ['<', '<'], ['>', '>'], ['=', '='],
    ['+', '+'], ['-', '-'], ['−', '-'], ['*', '*'], ['×', '*'], ['·', '*'], ['/', '/'], ['%', '%'], ['^', '^'],
    ['(', '('], [')', ')'], ['[', '['], [']', ']'], [',', ','], ['.', '.'],
    ['∈', 'in'], ['¬', 'not'], ['!', 'not'], ['∧', 'and'], ['∨', 'or'],
  ];
  /** These operators are really words: they become 'id' tokens, the same as typing the word. */
  const WORD_OPERATORS = new Set(['in', 'not', 'and', 'or']);

  const NAME = /^[A-Za-z_À-ɏͰ-Ͽ][A-Za-z0-9_À-ɏͰ-Ͽ']*/;
  const NUMBER = /^(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)/;
  const startsComment = (text, i) => text[i] === '#' || text[i] === '▷' || text[i] === '⊳' || (text[i] === '/' && text[i + 1] === '/');

  /** src ('algo' or 'lib') is only used to label errors. */
  function tokenize(source, src) {
    const tokens = [];
    const lines = source.split('\n');
    lines.forEach((text, index) => {
      const line = index + 1;
      let i = 0;
      while (i < text.length) {
        const c = text[i];
        if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
        if (startsComment(text, i)) break;
        const rest = text.slice(i);
        let m;
        if ((m = NUMBER.exec(rest))) {
          tokens.push({ t: 'num', v: parseFloat(m[1]), line }); i += m[1].length; continue;
        }
        if (c === '∞') {
          tokens.push({ t: 'num', v: Infinity, line }); i++; continue;
        }
        if ((m = NAME.exec(rest))) {
          tokens.push({ t: 'id', v: END_ALIASES.has(m[0]) ? 'end' : m[0], line }); i += m[0].length; continue;
        }
        if (c === '"' || c === "'") {
          const close = text.indexOf(c, i + 1);
          if (close < 0) throw new PseudoError('This text is missing its closing quote.', line, src);
          tokens.push({ t: 'str', v: text.slice(i + 1, close), line }); i = close + 1; continue;
        }
        const op = OPERATORS.find(([spelling]) => rest.startsWith(spelling));
        if (!op) throw new PseudoError(`The character '${c}' isn't part of the pseudocode language.`, line, src);
        tokens.push({ t: WORD_OPERATORS.has(op[1]) ? 'id' : 'op', v: op[1], line });
        i += op[0].length;
      }
      tokens.push({ t: 'nl', line });
    });
    tokens.push({ t: 'eof', line: lines.length });
    return tokens;
  }

  return { tokenize, RESERVED, END_ALIASES };
})();
