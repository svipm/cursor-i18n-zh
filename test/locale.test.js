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

test('uses common Traditional Chinese technical terminology before character conversion', () => {
  const text = toTraditional('开发者工具通过命令行读取配置文件, 调试器检查运行时依赖和缓存中的数组与字符串');
  assert.equal(
    text,
    '開發人員工具透過命令列讀取設定檔, 偵錯工具檢查執行階段相依性和快取中的陣列與字串',
  );
});

test('prefers longer technical phrases over their shorter components', () => {
  assert.equal(toTraditional('图形用户界面和代码仓库'), '圖形使用者介面和程式碼儲存庫');
});

test('uses contextual OpenCC conversion for ambiguous characters', () => {
  assert.equal(toTraditional('应用商店和应用设置'), '應用商店和應用設定');
  assert.equal(toTraditional('验证通过'), '驗證通過');
  assert.equal(toTraditional('发型设置和皇后模式'), '髮型設定和皇后模式');
  assert.equal(toTraditional('干燥后处理和里程碑'), '乾燥後處理和里程碑');
});
