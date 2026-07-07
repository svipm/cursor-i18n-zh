'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { NLS_KEYS, NLS_MESSAGES } = require('./config');
const { readJson } = require('./util');

// nls.keys.json 是 [模块, [key...]] 数组, 按顺序展开后与 nls.messages.json 一一对应.
// 同一模块内 key 可能重复出现 (对应多个消息), 因此索引值是数组.
function buildIndex(appDir) {
  const keys = readJson(path.join(appDir, NLS_KEYS));
  const index = new Map(); // '模块#key' -> [下标...]
  const order = [];
  let i = 0;
  for (const [mod, ks] of keys) {
    for (const k of ks) {
      const id = `${mod}#${k}`;
      if (!index.has(id)) index.set(id, []);
      index.get(id).push(i++);
      order.push([mod, k]);
    }
  }
  return { index, order, total: i };
}

function findLanguagePack() {
  const extRoot = path.join(os.homedir(), '.cursor', 'extensions');
  if (!fs.existsSync(extRoot)) return null;
  const dirs = fs.readdirSync(extRoot)
    .filter((d) => d.toLowerCase().startsWith('ms-ceintl.vscode-language-pack-zh-hans-'))
    .sort();
  for (const d of dirs.reverse()) {
    const full = path.join(extRoot, d);
    const main = path.join(full, 'translations', 'main.i18n.json');
    if (fs.existsSync(main)) return full;
  }
  return null;
}

function loadLanguagePackMain(langPackDir) {
  if (!langPackDir) return null;
  const mainPath = path.join(langPackDir, 'translations', 'main.i18n.json');
  if (!fs.existsSync(mainPath)) return null;
  const data = readJson(mainPath);
  return data.contents || null;
}

function applyLanguagePack(messages, order, contents) {
  if (!contents) return 0;
  let count = 0;
  for (let i = 0; i < order.length; i++) {
    const [mod, key] = order[i];
    const block = contents[mod];
    if (!block || !Object.prototype.hasOwnProperty.call(block, key)) continue;
    const zh = block[key];
    if (typeof zh !== 'string' || !zh) continue;
    messages[i] = zh;
    count++;
  }
  return count;
}

// 从原始副本 srcPath 出发, 先导入官方 VS Code 中文语言包, 再按 nlsDict 覆盖 Cursor 专有翻译.
function patchNls(appDir, srcPath, nlsDict) {
  const { index, order, total } = buildIndex(appDir);
  const messages = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
  if (messages.length !== total) {
    throw new Error(`nls.keys.json 展开数 (${total}) 与 nls.messages.json 条数 (${messages.length}) 不一致, 放弃 nls 层补丁`);
  }
  const langPackDir = findLanguagePack();
  const langPackCount = applyLanguagePack(messages, order, loadLanguagePackMain(langPackDir));
  let count = 0;
  const unknown = [];
  for (const [key, zh] of Object.entries(nlsDict)) {
    const idxs = index.get(key);
    if (!idxs) { unknown.push(key); continue; }
    for (const i of idxs) { messages[i] = zh; count++; }
  }
  fs.writeFileSync(path.join(appDir, NLS_MESSAGES), JSON.stringify(messages));
  return { count, unknown, langPackCount, langPackDir };
}

module.exports = { buildIndex, patchNls, findLanguagePack, loadLanguagePackMain, applyLanguagePack };
