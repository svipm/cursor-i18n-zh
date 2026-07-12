'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { atomicWriteFile, commitFiles } = require('../src/transaction');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-i18n-transaction-'));
}

test('commits all staged files', () => {
  const root = tmp();
  try {
    const first = path.join(root, 'first.txt');
    const second = path.join(root, 'nested', 'second.txt');
    fs.writeFileSync(first, 'old-first');

    commitFiles([
      { target: first, data: 'new-first' },
      { target: second, data: 'new-second' },
    ]);

    assert.equal(fs.readFileSync(first, 'utf8'), 'new-first');
    assert.equal(fs.readFileSync(second, 'utf8'), 'new-second');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rolls back earlier files when a later replacement fails', () => {
  const root = tmp();
  try {
    const first = path.join(root, 'first.txt');
    const second = path.join(root, 'second.txt');
    fs.writeFileSync(first, 'old-first');
    fs.writeFileSync(second, 'old-second');

    assert.throws(() => commitFiles([
      { target: first, data: 'new-first' },
      { target: second, data: 'new-second' },
    ], {
      beforeReplace(_target, index) {
        if (index === 1) throw new Error('simulated failure');
      },
    }), /simulated failure/);

    assert.equal(fs.readFileSync(first, 'utf8'), 'old-first');
    assert.equal(fs.readFileSync(second, 'utf8'), 'old-second');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('atomically creates a new file', () => {
  const root = tmp();
  try {
    const target = path.join(root, 'new.txt');
    atomicWriteFile(target, 'content');
    assert.equal(fs.readFileSync(target, 'utf8'), 'content');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deletes a file as part of the transaction', () => {
  const root = tmp();
  try {
    const target = path.join(root, 'remove.txt');
    fs.writeFileSync(target, 'old');
    commitFiles([{ target, remove: true }]);
    assert.equal(fs.existsSync(target), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('restores a deleted file when a later replacement fails', () => {
  const root = tmp();
  try {
    const removed = path.join(root, 'remove.txt');
    const changed = path.join(root, 'change.txt');
    fs.writeFileSync(removed, 'keep-me');
    fs.writeFileSync(changed, 'old');

    assert.throws(() => commitFiles([
      { target: removed, remove: true },
      { target: changed, data: 'new' },
    ], {
      beforeReplace(_target, index) {
        if (index === 1) throw new Error('simulated failure');
      },
    }), /simulated failure/);

    assert.equal(fs.readFileSync(removed, 'utf8'), 'keep-me');
    assert.equal(fs.readFileSync(changed, 'utf8'), 'old');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('cleans staged files when staging a later entry fails', () => {
  const root = tmp();
  try {
    const first = path.join(root, 'first.txt');
    const second = path.join(root, 'second.txt');
    assert.throws(() => commitFiles([
      { target: first, data: 'first' },
      { target: second, data: 'second' },
    ], {
      beforeStage(_target, index) {
        if (index === 1) throw new Error('simulated stage failure');
      },
    }), /simulated stage failure/);

    assert.equal(fs.existsSync(first), false);
    assert.equal(fs.existsSync(second), false);
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('preserves the rollback copy when restoring the original file fails', () => {
  const root = tmp();
  try {
    const first = path.join(root, 'first.txt');
    const second = path.join(root, 'second.txt');
    fs.writeFileSync(first, 'old-first');
    fs.writeFileSync(second, 'old-second');

    assert.throws(() => commitFiles([
      { target: first, data: 'new-first' },
      { target: second, data: 'new-second' },
    ], {
      beforeReplace(_target, index) {
        if (index === 1) throw new Error('simulated commit failure');
      },
      beforeRollback(target) {
        if (target === first) throw new Error('simulated rollback failure');
      },
    }), /事务回滚失败/);

    assert.equal(fs.readFileSync(first, 'utf8'), 'new-first');
    const rollback = fs.readdirSync(root).find((name) => name.includes('first.txt.cursor-i18n-rollback'));
    assert.ok(rollback);
    assert.equal(fs.readFileSync(path.join(root, rollback), 'utf8'), 'old-first');
    assert.equal(fs.readFileSync(second, 'utf8'), 'old-second');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
