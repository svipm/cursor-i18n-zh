'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'src', 'cli.js');

test('prints help with zero exit status', () => {
  const result = cp.spawnSync(process.execPath, [cli, '--help'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /用法:/);
});

test('rejects unknown command with non-zero exit status', () => {
  const result = cp.spawnSync(process.execPath, [cli, 'unknown-command'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /用法:/);
});
