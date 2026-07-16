'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { loadDicts } = require('../src/dict');
const { toTraditional } = require('../src/locale');

test('loads code and nls dictionaries and reports invalid entries', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-i18n-dict-'));
  fs.writeFileSync(path.join(dir, '00.json'), JSON.stringify({
    '//': 'comment',
    'New Agent': '新建智能体',
    'Bad Quote': '坏"译文',
    'Bad Ctx': { zh: '坏上下文', ctx: ['bad'] },
    'Wrong Ctx Type': { zh: '错误类型', ctx: 'lit' },
  }));
  fs.writeFileSync(path.join(dir, 'nls.json'), JSON.stringify({
    'module#key': '译文',
  }));

  const dicts = loadDicts(dir);
  assert.equal(dicts.code.size, 1);
  assert.equal(dicts.code.get('New Agent').zh, '新建智能体');
  assert.deepEqual(dicts.nls, { 'module#key': '译文' });
  assert.equal(dicts.warnings.length, 3);
  assert.match(dicts.warnings.join('\n'), /ctx 必须是数组/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('applies converter to code and nls dictionaries', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-i18n-dict-'));
  fs.writeFileSync(path.join(dir, '00.json'), JSON.stringify({
    'Settings': '设置',
  }));
  fs.writeFileSync(path.join(dir, 'nls.json'), JSON.stringify({
    'module#file': '文件',
  }));

  const dicts = loadDicts(dir, { converter: toTraditional });
  assert.equal(dicts.code.get('Settings').zh, '設定');
  assert.deepEqual(dicts.nls, { 'module#file': '檔案' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('accepts an English dictionary key containing double quotes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-i18n-dict-'));
  fs.writeFileSync(path.join(dir, '00.json'), JSON.stringify({
    'Reset "Don\u2019t Ask Again" Dialogs': { zh: '重置不再询问的对话框', ctx: ['prop'] },
  }));

  const dicts = loadDicts(dir);
  assert.equal(dicts.warnings.length, 0);
  assert.equal(dicts.code.get('Reset "Don\u2019t Ask Again" Dialogs').zh, '重置不再询问的对话框');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('rejects a dictionary whose root is not an object', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-i18n-dict-'));
  try {
    fs.writeFileSync(path.join(dir, '00.json'), JSON.stringify(['invalid']));
    assert.throws(() => loadDicts(dir), /顶层必须是 JSON 对象/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
