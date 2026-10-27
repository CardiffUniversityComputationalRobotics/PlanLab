/* parser.js — turns tokens into a syntax tree (AST).
 *
 * Statements (each also has line and src):
 *   function { name }                  the definition itself goes into `functions`
 *   global   { names }
 *   assign   { target, value }         target: id · member · index · tuple of ids
 *   expr     { expr }                  a function call on a line of its own
 *   if       { branches: [{ cond, body, line }], elseBody }
 *   for      { v, from, to, step, down, body }       for i ← a to b step s do
 *   forin    { v, iter, body }                       for each v in S do
 *   while    { cond, body }   ·   repeat { body, cond, untilLine }
 *   return   { value }   ·   break   ·   continue
 * Expressions (each also has line):
 *   lit { v } · id { name } · tuple { items } · list { items }
 *   neg { e } · not { e } · and / or { l, r } · bin { op, l, r }
 *   member { obj, name } · index { obj, idx } · call { callee, args, builtin }   (builtin: written builtin.f(…))
 *
 * Blocks close with `end` (or `end if`, `end for`, …). The words `then` and `do` are optional.
 */
const Parser = (() => {
  'use strict';
  const { PseudoError, FAILURE } = Values;
  const { tokenize, RESERVED } = Tokenizer;

  const CLOSING_WORDS = ['end', 'else', 'elif', 'elseif', 'until'];
  const COMPARISONS = new Set(['<', '<=', '>', '>=', '=', '==', '!=', 'notin']);

  /** Parses one editor's text. src is 'algo' or 'lib'. Returns { body, functions }. */
  function parseSource(source, src) {
    const tokens = tokenize(source, src);
    const functions = new Map();   // name → { name, params, body, line, src }
    let i = 0;

    /* ================================================================ reading tokens */
    const peek = (k = 0) => tokens[Math.min(i + k, tokens.length - 1)];
    const next = () => tokens[i++];
    const isOp = (v) => peek().t === 'op' && peek().v === v;
    const isWord = (v) => peek().t === 'id' && peek().v === v;
    const skipWord = (w) => { if (isWord(w)) { i++; return true; } return false; };
    const describe = (t) => (t.t === 'nl' ? 'the end of the line' : t.t === 'eof' ? 'the end of the code' : `'${t.v}'`);
    const error = (message, line) => new PseudoError(message, line, src);
    const fail = (message, t = peek()) => { throw error(message, t.line); };

    function expectOp(v, where) {
      if (!isOp(v)) fail(`Expected '${v}' ${where}, found ${describe(peek())}.`);
      return next();
    }
    function expectLineEnd() {
      const t = peek();
      if (t.t === 'nl') { i++; return; }
      if (t.t !== 'eof') fail(`Unexpected ${describe(t)} at the end of this line.`);
    }
    function expectEnd(kind, openLine) {
      if (peek().t === 'eof') throw error(`The '${kind}' on line ${openLine} is missing its 'end'.`, openLine);
      if (!isWord('end')) fail(`Expected 'end' to close the '${kind}' on line ${openLine}, found ${describe(peek())}.`);
      i++;
      if (peek().t === 'id') i++;   // "end if", "end for", "end extend", …
      expectLineEnd();
    }
    function name(where) {
      const t = peek();
      if (t.t !== 'id' || RESERVED.has(t.v)) fail(`Expected a name ${where}, found ${describe(t)}.`);
      return next().v;
    }
    /** item, item, item */
    function commaList(item) {
      const out = [item()];
      while (isOp(',')) { i++; out.push(item()); }
      return out;
    }

    /* ================================================================ statements */
    function block(terminators) {
      const body = [];
      for (;;) {
        while (peek().t === 'nl') i++;
        const t = peek();
        if (t.t === 'eof' || (t.t === 'id' && terminators.includes(t.v))) return body;
        body.push(statement());
      }
    }

    function statement() {
      const t = peek();
      if (t.t === 'id' && KEYWORD_STATEMENTS.has(t.v)) return KEYWORD_STATEMENTS.get(t.v)(t.line, t.v);
      if (t.t === 'id' && CLOSING_WORDS.includes(t.v)) {
        fail(`'${t.v}' without a matching ${t.v === 'until' ? "'repeat'" : "'if', 'for', 'while' or 'function'"}.`);
      }
      return looksLikeAssignment() ? assignment(t.line) : callStatement(t.line);
    }

    function functionDefinition(line, keyword) {
      i++;
      const fname = name(`after '${keyword}'`);
      expectOp('(', 'after the function name');
      const params = isOp(')') ? [] : commaList(() => name('for an input'));
      expectOp(')', 'after the inputs');
      let body;
      if (isOp('=') || isOp('←')) {          // one line:  function h(x) = dist(x, q_g)
        i++;
        body = [{ type: 'return', value: expression(), line, src }];
        expectLineEnd();
      } else {
        expectLineEnd();
        body = block(['end']);
        expectEnd(keyword, line);
      }
      if (functions.has(fname)) throw error(`The function '${fname}' is defined twice.`, line);
      if (new Set(params).size !== params.length) throw error(`${fname}() has two inputs with the same name.`, line);
      functions.set(fname, { name: fname, params, body, line, src });
      return { type: 'function', name: fname, line, src };
    }

    function globalStatement(line) {
      i++;
      const names = commaList(() => name("after 'global'"));
      expectLineEnd();
      return { type: 'global', names, line, src };
    }

    function ifStatement(line) {
      i++;
      const branches = [];
      let cond = expression(); skipWord('then'); expectLineEnd();
      branches.push({ cond, body: block(['end', 'else', 'elif', 'elseif']), line });
      for (;;) {
        const elseIf = isWord('elif') || isWord('elseif') || (isWord('else') && peek(1).t === 'id' && peek(1).v === 'if');
        if (elseIf) {
          const branchLine = peek().line;
          if (isWord('else')) i++;
          i++;
          cond = expression(); skipWord('then'); expectLineEnd();
          branches.push({ cond, body: block(['end', 'else', 'elif', 'elseif']), line: branchLine });
        } else if (isWord('else')) {
          i++; expectLineEnd();
          const elseBody = block(['end']);
          expectEnd('if', line);
          return { type: 'if', branches, elseBody, line, src };
        } else {
          expectEnd('if', line);
          return { type: 'if', branches, elseBody: null, line, src };
        }
      }
    }

    function forStatement(line) {
      i++;
      if (isWord('each') && peek(1).t === 'id') i++;
      const v = name("after 'for'");
      if (skipWord('in')) {                                          // for each v in S do
        const iter = expression(); skipWord('do'); expectLineEnd();
        const body = block(['end']); expectEnd('for', line);
        return { type: 'forin', v, iter, body, line, src };
      }
      if (!(isOp('←') || isOp('='))) fail(`Expected '←' or 'in' after 'for ${v}'.`);
      i++;                                                           // for i ← a to b step s do
      const from = expression();
      const down = isWord('downto');
      if (!down && !isWord('to')) fail(`Expected 'to' in the for loop, found ${describe(peek())}.`);
      i++;
      const to = expression();
      const step = (skipWord('step') || skipWord('by')) ? expression() : null;
      skipWord('do'); expectLineEnd();
      const body = block(['end']); expectEnd('for', line);
      return { type: 'for', v, from, to, step, down, body, line, src };
    }

    function whileStatement(line) {
      i++;
      const cond = expression(); skipWord('do'); expectLineEnd();
      const body = block(['end']); expectEnd('while', line);
      return { type: 'while', cond, body, line, src };
    }

    function repeatStatement(line) {
      i++; expectLineEnd();
      const body = block(['until']);
      if (!isWord('until')) throw error(`The 'repeat' on line ${line} is missing its 'until'.`, line);
      const untilLine = next().line;
      const cond = expression(); expectLineEnd();
      return { type: 'repeat', body, cond, untilLine, line, src };
    }

    function returnStatement(line) {
      i++;
      const value = (peek().t === 'nl' || peek().t === 'eof') ? null : expression();
      expectLineEnd();
      return { type: 'return', value, line, src };
    }

    function jumpStatement(line, keyword) {   // break, continue
      i++; expectLineEnd();
      return { type: keyword, line, src };
    }

    const KEYWORD_STATEMENTS = new Map([
      ['function', functionDefinition], ['procedure', functionDefinition], ['global', globalStatement],
      ['if', ifStatement], ['for', forStatement], ['while', whileStatement], ['repeat', repeatStatement],
      ['return', returnStatement], ['break', jumpStatement], ['continue', jumpStatement],
    ]);

    /** An assignment is a line with ← or = outside any brackets. */
    function looksLikeAssignment() {
      let depth = 0;
      for (let k = i; ; k++) {
        const t = tokens[k];
        if (t.t === 'nl' || t.t === 'eof') return false;
        if (t.t !== 'op') continue;
        if (t.v === '(' || t.v === '[') depth++;
        else if (t.v === ')' || t.v === ']') depth--;
        else if (depth === 0 && (t.v === '←' || t.v === '=')) return true;
      }
    }

    function assignment(line) {
      const target = postfix();
      const ok = ['id', 'member', 'index'].includes(target.type) || (target.type === 'tuple' && target.items.every((x) => x.type === 'id'));
      if (!ok) fail('The left side of an assignment must be a name, like q_new ← …, or names in brackets, like (a, b) ← …');
      i++;   // the ← or =
      const value = expression(); expectLineEnd();
      return { type: 'assign', target, value, line, src };
    }

    function callStatement(line) {
      const expr = expression(); expectLineEnd();
      if (expr.type !== 'call') throw error("This line doesn't do anything. To store a value, use ← (for example x ← 5).", line);
      return { type: 'expr', expr, line, src };
    }

    /* ================================================================ expressions
     * From lowest to highest precedence:
     *   or · and · not · comparisons (< ≤ > ≥ = ≠ in ∉) · + − · * / mod · unary − · ^ · calls, .field, [index] */
    function expression() { return orExpression(); }

    function orExpression() {
      let l = andExpression();
      while (isWord('or')) { const line = next().line; l = { type: 'or', l, r: andExpression(), line }; }
      return l;
    }
    function andExpression() {
      let l = notExpression();
      while (isWord('and')) { const line = next().line; l = { type: 'and', l, r: notExpression(), line }; }
      return l;
    }
    function notExpression() {
      if (isWord('not')) { const line = next().line; return { type: 'not', e: notExpression(), line }; }
      return comparison();
    }
    function comparison() {
      let l = sum();
      for (;;) {
        if (peek().t === 'op' && COMPARISONS.has(peek().v)) { const t = next(); l = { type: 'bin', op: t.v, l, r: sum(), line: t.line }; }
        else if (isWord('in')) { const t = next(); l = { type: 'bin', op: 'in', l, r: sum(), line: t.line }; }
        else if (isWord('not') && peek(1).t === 'id' && peek(1).v === 'in') { const t = next(); next(); l = { type: 'bin', op: 'notin', l, r: sum(), line: t.line }; }
        else return l;
      }
    }
    function sum() {
      let l = product();
      while (isOp('+') || isOp('-')) { const t = next(); l = { type: 'bin', op: t.v, l, r: product(), line: t.line }; }
      return l;
    }
    function product() {
      let l = unary();
      for (;;) {
        if (isOp('*') || isOp('/') || isOp('%')) { const t = next(); l = { type: 'bin', op: t.v, l, r: unary(), line: t.line }; }
        else if (isWord('mod')) { const t = next(); l = { type: 'bin', op: '%', l, r: unary(), line: t.line }; }
        else return l;
      }
    }
    function unary() {
      if (isOp('-')) { const line = next().line; return { type: 'neg', e: unary(), line }; }
      if (isOp('+')) { next(); return unary(); }
      return power();
    }
    function power() {
      const base = postfix();
      if (isOp('^')) { const line = next().line; return { type: 'bin', op: '^', l: base, r: unary(), line }; }
      return base;
    }
    function postfix() {
      let e = primary();
      // builtin.name(…) always calls the original built-in, even when one of your functions has the same name
      if (e.type === 'id' && e.name === 'builtin' && isOp('.')) {
        i++;
        const fname = name("after 'builtin.'");
        const line = expectOp('(', `after builtin.${fname}`).line;
        const args = isOp(')') ? [] : commaList(expression);
        expectOp(')', 'to close the function call');
        e = { type: 'call', callee: { type: 'id', name: fname, line }, args, line, builtin: true };
      }
      for (;;) {
        if (isOp('(') && (e.type === 'id' || e.type === 'member')) {
          const line = next().line;
          const args = isOp(')') ? [] : commaList(expression);
          expectOp(')', 'to close the function call');
          e = { type: 'call', callee: e, args, line };
        } else if (isOp('.')) {
          const line = next().line;
          e = { type: 'member', obj: e, name: name("after '.'"), line };
        } else if (isOp('[')) {
          const line = next().line;
          const idx = expression();
          expectOp(']', 'to close the index');
          e = { type: 'index', obj: e, idx, line };
        } else {
          return e;
        }
      }
    }
    function primary() {
      const t = peek();
      if (t.t === 'num' || t.t === 'str') { i++; return { type: 'lit', v: t.v, line: t.line }; }
      if (t.t === 'id') {
        i++;
        switch (t.v) {
          case 'true': return { type: 'lit', v: true, line: t.line };
          case 'false': return { type: 'lit', v: false, line: t.line };
          case 'null': case 'nil': return { type: 'lit', v: null, line: t.line };
          case 'failure': return { type: 'lit', v: FAILURE, line: t.line };
        }
        if (RESERVED.has(t.v)) { i--; fail(`Unexpected '${t.v}' here.`); }
        return { type: 'id', name: t.v, line: t.line };
      }
      if (t.t === 'op' && t.v === '(') {                 // (a)  or a tuple / point (a, b)
        i++;
        const items = commaList(expression);
        expectOp(')', items.length > 1 ? 'to close the brackets' : 'to close the bracket');
        return items.length > 1 ? { type: 'tuple', items, line: t.line } : items[0];
      }
      if (t.t === 'op' && t.v === '[') {                 // a list [a, b]
        i++;
        const items = isOp(']') ? [] : commaList(expression);
        expectOp(']', 'to close the list');
        return { type: 'list', items, line: t.line };
      }
      fail(`Expected a value, found ${describe(t)}.`);
    }

    return { body: block([]), functions };
  }

  return { parseSource };
})();
