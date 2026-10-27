/* output.js — writing to the Output tab, and labels in the workspace. */
(() => {
  'use strict';
  const { format } = Values;

  Builtins.define('print', {
    group: 'Output', signature: 'print(a, b, …)', inputs: [0, 99],
    description: 'Writes values to the Output tab.',
  }, function (a) {
    this.print('print', a.map((v) => format(v)).join(' '));
    return null;
  });

  Builtins.define('label', {
    group: 'Output', signature: 'label(q, value)', inputs: 2,
    description: 'Writes value next to point q in the workspace, e.g. a weight. Label it again to change the text, or with null to remove it.',
  }, function (a, line) {
    const q = Builtins.inputs('label', line).point(a[0], 1);
    if (a[1] === null) this.labels.delete(q);
    else this.labels.set(q, format(a[1]));
    return null;
  });
})();
