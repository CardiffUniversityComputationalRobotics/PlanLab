/* registry.js — the list behind the "Load algorithm…" menu.
 *
 * Each file in this folder registers one algorithm:
 *   Algorithms.register({
 *     id: 'rrt',                    // used in code and saved settings
 *     name: 'RRT',                  // shown in the menu
 *     group: 'Trees',               // menu section
 *     suggestedSpeed: 1000,         // lines per second; loading it raises the speed slider to at least this
 *     code: `…pseudocode…`,
 *   });
 * The menu lists them in the order the files load in index.html.
 */
const Algorithms = (() => {
  'use strict';
  const list = [];
  const register = (algorithm) => { list.push(algorithm); };
  const get = (id) => list.find((a) => a.id === id) || null;
  return { list, register, get };
})();
