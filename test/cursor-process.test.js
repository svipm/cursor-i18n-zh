'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { stopCursor } = require('../src/cli');

test('automatically terminates the complete Cursor process tree and waits for exit', () => {
  const calls = [];
  let tasklistChecks = 0;
  const spawnSync = (command, args) => {
    calls.push({ command, args });
    if (command === 'taskkill.exe') return { status: 0, stdout: 'SUCCESS', stderr: '' };
    if (command === 'tasklist.exe') {
      tasklistChecks++;
      return {
        status: 0,
        stdout: tasklistChecks < 3 ? '"Cursor.exe","100","Console","1","1 K"' : '',
        stderr: '',
      };
    }
    throw new Error(`unexpected command: ${command}`);
  };

  stopCursor({ force: true, spawnSync, sleep: () => {}, log: () => {}, attempts: 2, pollsPerAttempt: 3, pollIntervalMs: 0 });
  const taskkill = calls.find((call) => call.command === 'taskkill.exe');
  assert.deepEqual(taskkill.args, ['/IM', 'Cursor.exe', '/T', '/F']);
  assert.equal(tasklistChecks, 3);
});

test('reports an actionable error when Cursor keeps running after retries', () => {
  const spawnSync = (command) => command === 'taskkill.exe'
    ? { status: 1, stdout: '', stderr: 'Access is denied.' }
    : { status: 0, stdout: '"Cursor.exe","100","Console","1","1 K"', stderr: '' };

  assert.throws(
    () => stopCursor({ force: true, spawnSync, sleep: () => {}, log: () => {}, attempts: 2, pollsPerAttempt: 2, pollIntervalMs: 0 }),
    /管理员身份重新启动汉化工作台/,
  );
});
