'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getLanguageProfile, normalizeLocale, toTraditional } = require('../src/locale');

test('normalizes supported Chinese locales', () => {
  assert.equal(normalizeLocale('zh-Hans'), 'zh-cn');
  assert.equal(normalizeLocale('zh_Hant'), 'zh-tw');
  assert.equal(getLanguageProfile('zh-tw').languagePackId, 'ms-ceintl.vscode-language-pack-zh-hant');
});

test('converts common UI terms to Traditional Chinese', () => {
  const text = toTraditional('文件 设置 编辑器 打开文件夹');
  assert.match(text, /檔案/);
  assert.match(text, /設定/);
  assert.match(text, /編輯器/);
  assert.match(text, /開啟資料夾/);
});
