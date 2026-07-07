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

function findLanguagePack(languagePackId) {
  const extRoot = path.join(os.homedir(), '.cursor', 'extensions');
  if (!fs.existsSync(extRoot)) return null;
  const prefix = String(languagePackId || '').toLowerCase();
  if (!prefix) return null;
  const dirs = fs.readdirSync(extRoot)
    .filter((d) => d.toLowerCase().startsWith(`${prefix}-`))
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

function applyLanguagePack(messages, order, contents, converter = null) {
  if (!contents) return 0;
  let count = 0;
  for (let i = 0; i < order.length; i++) {
    const [mod, key] = order[i];
    const block = contents[mod];
    if (!block || !Object.prototype.hasOwnProperty.call(block, key)) continue;
    const zh = block[key];
    if (typeof zh !== 'string' || !zh) continue;
    messages[i] = converter ? converter(zh) : zh;
    count++;
  }
  return count;
}

function resolveLanguagePack(profile = {}) {
  const ids = [profile.languagePackId, ...(profile.languagePackFallbackIds || [])].filter(Boolean);
  for (const id of ids) {
    const dir = findLanguagePack(id);
    if (dir) return { dir, id, fallback: id !== profile.languagePackId };
  }
  return { dir: null, id: ids[0] || null, fallback: false };
}

// 从原始副本 srcPath 出发, 先导入官方 VS Code 中文语言包, 再按 nlsDict 覆盖 Cursor 专有翻译.
function patchNls(appDir, srcPath, nlsDict, options = {}) {
  const profile = options.profile || {};
  const converter = options.converter || profile.converter || null;
  const { index, order, total } = buildIndex(appDir);
  const messages = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
  if (messages.length !== total) {
    throw new Error(`nls.keys.json 展开数 (${total}) 与 nls.messages.json 条数 (${messages.length}) 不一致, 放弃 nls 层补丁`);
  }
  const langPack = resolveLanguagePack(profile);
  const langPackCount = applyLanguagePack(messages, order, loadLanguagePackMain(langPack.dir), converter);
  let count = 0;
  const unknown = [];
  for (const [key, zh] of Object.entries(nlsDict)) {
    const idxs = index.get(key);
    if (!idxs) { unknown.push(key); continue; }
    for (const i of idxs) { messages[i] = zh; count++; }
  }
  fs.writeFileSync(path.join(appDir, NLS_MESSAGES), JSON.stringify(messages));
  return { count, unknown, langPackCount, langPackDir: langPack.dir, langPackId: langPack.id, usedFallbackLanguagePack: langPack.fallback };
}

module.exports = { buildIndex, patchNls, findLanguagePack, loadLanguagePackMain, applyLanguagePack, resolveLanguagePack };
