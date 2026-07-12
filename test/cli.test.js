'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
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

test('strict check returns non-zero for an unsupported Cursor app', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-i18n-cli-'));
  try {
    fs.writeFileSync(path.join(rootDir, 'product.json'), JSON.stringify({
      version: 'test-version',
      commit: 'test-commit',
      checksums: {},
    }));
    const result = cp.spawnSync(process.execPath, [cli, 'check'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, CURSOR_APP_DIR: rootDir },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /未找到任何可补丁/);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('dict-check does not require a local Cursor installation', () => {
  const result = cp.spawnSync(process.execPath, [cli, 'dict-check'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CURSOR_APP_DIR: path.join(root, 'missing-cursor') },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /词典校验通过/);
});
