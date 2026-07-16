'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateCompatibility } = require('../src/compat');

const baseline = {
  metrics: { codeReplacements: 1000 },
  gates: {
    minCodeReplacementRatio: 0.7,
    minWorkbenchBundles: 1,
    minAccountUsageBundles: 1,
    minCursorNlsReplacements: 100,
  },
};

test('accepts a Cursor patch report that remains above every compatibility gate', () => {
  const result = evaluateCompatibility({
    files: {
      'out/vs/workbench/workbench.desktop.main.js': 750,
      'out/main.js': 20,
      'out/nls.messages.json': { cursorDict: 120 },
    },
    accountUsageEmbedded: ['out/vs/workbench/workbench.desktop.main.js'],
  }, baseline);

  assert.equal(result.passed, true);
  assert.equal(result.metrics.codeReplacements, 770);
  assert.equal(result.metrics.workbenchBundles, 1);
  assert.deepEqual(result.errors, []);
});

test('rejects a Cursor patch report when upstream structure loses critical coverage', () => {
  const result = evaluateCompatibility({
    files: {
      'out/main.js': 10,
      'out/nls.messages.json': { cursorDict: 20 },
    },
    accountUsageEmbedded: [],
  }, baseline);

  assert.equal(result.passed, false);
  assert.equal(result.errors.length, 4);
  assert.match(result.errors.join('\n'), /代码替换量/);
  assert.match(result.errors.join('\n'), /账号用量入口/);
});
