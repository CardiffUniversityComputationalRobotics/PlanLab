/* util.js — small helpers used by every other file. */
const Util = (() => {
  'use strict';

  /** Shorthand for document.querySelector. */
  const $ = (selector) => document.querySelector(selector);

  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

  /** Rounds and formats with a fixed number of decimals: fixed(3.14159, 2) → "3.14". */
  const fixed = (value, decimals = 1) => (Math.round(value * 10 ** decimals) / 10 ** decimals).toFixed(decimals);

  const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /** Random numbers in [0, 1) from a seed (the mulberry32 generator): the same seed gives the same run. */
  function seededRandom(seed) {
    let a = seed | 0;
    return function random() {
      a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  return { $, clamp, fixed, escapeHtml, seededRandom };
})();
