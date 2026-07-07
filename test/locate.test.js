'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { appDirFrom } = require('../src/locate');

function makeCursorTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-i18n-locate-'));
  const app = path.join(root, 'resources', 'app');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(app, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(app, 'product.json'), '{}');
  fs.writeFileSync(path.join(root, 'Cursor.exe'), '');
  fs.writeFileSync(path.join(bin, 'cursor.cmd'), '');
  return { root, app, bin };
}

test('detects resources/app from common Cursor paths', () => {
  const { root, app, bin } = makeCursorTree();
  try {
    assert.equal(appDirFrom(app), app);
    assert.equal(appDirFrom(root), app);
    assert.equal(appDirFrom(path.join(root, 'Cursor.exe')), app);
    assert.equal(appDirFrom(path.join(bin, 'cursor.cmd')), app);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
