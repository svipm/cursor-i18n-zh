'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const testDir = path.join(root, 'test');
const files = fs.readdirSync(testDir)
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => path.join('test', name));

if (!files.length) {
  console.error('No test files found.');
  process.exit(1);
}

const result = cp.spawnSync(process.execPath, ['--test', ...files], {
  cwd: root,
  stdio: 'inherit',
});

process.exit(result.status || 0);
