'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { applyLanguagePack } = require('../src/nls');

test('applies vscode language pack entries by module and key order', () => {
  const messages = ['File', 'Edit', 'Cursor Only'];
  const order = [
    ['vs/platform/menubar/electron-main/menubar', 'mFile'],
    ['vs/platform/menubar/electron-main/menubar', 'mEdit'],
    ['vs/workbench/contrib/cursor/foo', 'title'],
  ];
  const contents = {
    'vs/platform/menubar/electron-main/menubar': {
      mFile: '文件',
      mEdit: '编辑',
    },
  };

  const count = applyLanguagePack(messages, order, contents);
  assert.equal(count, 2);
  assert.deepEqual(messages, ['文件', '编辑', 'Cursor Only']);
});
