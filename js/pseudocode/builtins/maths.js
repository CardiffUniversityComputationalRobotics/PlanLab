/* maths.js — numeric functions. */
(() => {
  'use strict';
  const { define, inputs } = Builtins;

  // Functions of one number.
  const UNARY = [
    ['sqrt', Math.sqrt, 'Square root.'],
    ['abs', Math.abs, 'Absolute value.'],
    ['floor', Math.floor, 'Round down.'],
    ['ceil', Math.ceil, 'Round up.'],
    ['round', Math.round, 'Round to the nearest whole number.'],
    ['sin', Math.sin, 'Sine (radians).'],
    ['cos', Math.cos, 'Cosine (radians).'],
    ['exp', Math.exp, 'e to the power x.'],
    ['log', Math.log, 'Natural logarithm.'],
  ];
  for (const [name, fn, description] of UNARY) {
    define(name, { group: 'Maths', signature: `${name}(x)`, description, inputs: 1 }, function (a, line) {
      return fn(inputs(name, line).number(a[0], 1));
    });
  }

  define('atan2', {
    group: 'Maths', signature: 'atan2(y, x)', inputs: 2,
    description: 'Angle of the vector (x, y), in radians.',
  }, function (a, line) {
    const input = inputs('atan2', line);
    return Math.atan2(input.number(a[0], 1), input.number(a[1], 2));
  });

  /** min and max take several numbers, or one list of numbers. */
  for (const [name, fn, description] of [['min', Math.min, 'Smallest number (also accepts one list).'], ['max', Math.max, 'Largest number (also accepts one list).']]) {
    define(name, { group: 'Maths', signature: `${name}(a, b, …)`, description, inputs: [1, 99] }, function (a, line) {
      const input = inputs(name, line);
      const numbers = a.length === 1 && Array.isArray(a[0]) ? a[0] : a;
      numbers.forEach((x, k) => input.number(x, k + 1));
      return fn(...numbers);
    });
  }
})();
