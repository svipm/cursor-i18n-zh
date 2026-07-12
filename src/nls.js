'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { NLS_KEYS, NLS_MESSAGES } = require('./config');
const { readJson } = require('./util');

// nls.keys.json 是 [模块, [key...]] 数组, 按顺序展开后与 nls.messages.json 一一对应.
// 同一模块内 key 可能重复出现 (对应多个消息), 因此索引值是数组.
function buildIndex(appDir, options = {}) {
  const keys = readJson(options.keysPath || path.join(appDir, NLS_KEYS));
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

// 按 semver 规则比较语言包目录中的版本号. 扩展目录偶尔会省略 patch 段,
// 这里按 0 补齐; 无法解析的版本排在有效版本之后, 但仍保留旧版兼容行为.
function parseSemver(value) {
  const raw = String(value || '').trim().replace(/^v/i, '');
  const match = raw.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2] || 0),
    patch: Number(match[3] || 0),
    prerelease: match[4] ? match[4].split('.') : null,
  };
}

function compareSemver(left, right) {
  const a = typeof left === 'object' && left ? left : parseSemver(left);
  const b = typeof right === 'object' && right ? right : parseSemver(right);
  if (!a && !b) return String(left).localeCompare(String(right));
  if (!a) return -1;
  if (!b) return 1;
  for (const field of ['major', 'minor', 'patch']) {
    if (a[field] !== b[field]) return a[field] > b[field] ? 1 : -1;
  }
  if (!a.prerelease && !b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < length; i++) {
    if (i >= a.prerelease.length) return -1;
    if (i >= b.prerelease.length) return 1;
    const ai = a.prerelease[i];
    const bi = b.prerelease[i];
    if (ai === bi) continue;
    const an = /^\d+$/.test(ai);
    const bn = /^\d+$/.test(bi);
    if (an && bn) return Number(ai) > Number(bi) ? 1 : -1;
    if (an !== bn) return an ? -1 : 1;
    return ai > bi ? 1 : -1;
  }
  return 0;
}

function findLanguagePack(languagePackId, options = {}) {
  const extRoot = path.join(options.homeDir || os.homedir(), '.cursor', 'extensions');
  if (!fs.existsSync(extRoot)) return null;
  const prefix = String(languagePackId || '').toLowerCase();
  if (!prefix) return null;
  const dirs = fs.readdirSync(extRoot)
    .filter((d) => d.toLowerCase().startsWith(`${prefix}-`))
    .map((name) => ({
      name,
      version: name.slice(prefix.length + 1),
      full: path.join(extRoot, name),
    }))
    .filter(({ full }) => fs.existsSync(path.join(full, 'translations', 'main.i18n.json')))
    .sort((a, b) => compareSemver(b.version, a.version) || a.name.localeCompare(b.name));
  if (dirs.length) return dirs[0].full;
  return null;
}

function loadLanguagePackMain(langPackDir) {
  if (!langPackDir) return null;
  const mainPath = path.join(langPackDir, 'translations', 'main.i18n.json');
  if (!fs.existsSync(mainPath)) return null;
  const data = readJson(mainPath);
  return data.contents || null;
}

function extractNlsPlaceholders(value) {
  if (typeof value !== 'string') return [];
  const placeholders = [];
  const re = /\{(\d+)\}/g;
  let match;
  while ((match = re.exec(value))) placeholders.push(Number(match[1]));
  return placeholders.sort((a, b) => a - b);
}

function nlsPlaceholdersMatch(source, translated) {
  const expected = extractNlsPlaceholders(source);
  const actual = extractNlsPlaceholders(translated);
  return expected.length === actual.length && expected.every((value, i) => value === actual[i]);
}

function validateNlsPlaceholders(source, translated, context = 'NLS') {
  if (nlsPlaceholdersMatch(source, translated)) return true;
  const expected = extractNlsPlaceholders(source);
  const actual = extractNlsPlaceholders(translated);
  throw new Error(`${context} 占位符不一致: 原文 {${expected.join(', ')}} -> 译文 {${actual.join(', ')}}`);
}

function findAmbiguousNlsKeys(index, messages) {
  const ambiguous = [];
  for (const [id, indexes] of index) {
    if (indexes.length < 2) continue;
    const first = messages[indexes[0]];
    if (indexes.some((i) => !Object.is(messages[i], first))) {
      ambiguous.push({
        id,
        indexes: [...indexes],
        values: indexes.map((i) => messages[i]),
      });
    }
  }
  return ambiguous;
}

function assertUnambiguousNlsKeys(index, messages, ids = null) {
  const allow = ids ? new Set(ids) : null;
  const ambiguous = findAmbiguousNlsKeys(index, messages)
    .filter(({ id }) => !allow || allow.has(id));
  if (!ambiguous.length) return;
  const details = ambiguous.slice(0, 5).map(({ id, indexes }) => `${id} [${indexes.join(', ')}]`).join('; ');
  const suffix = ambiguous.length > 5 ? `; 另有 ${ambiguous.length - 5} 项` : '';
  throw new Error(`nls.keys.json 存在同一 module#key 对应不同原文的歧义: ${details}${suffix}`);
}

function applyLanguagePack(messages, order, contents, converter = null, options = {}) {
  if (!contents) {
    if (options.stats) options.stats.placeholderSkipped = 0;
    return 0;
  }
  const replacements = [];
  const skipIds = options.skipIds || new Set();
  let placeholderSkipped = 0;
  for (let i = 0; i < order.length; i++) {
    const [mod, key] = order[i];
    if (skipIds.has(`${mod}#${key}`)) continue;
    const block = contents[mod];
    if (!block || !Object.prototype.hasOwnProperty.call(block, key)) continue;
    const zh = block[key];
    if (typeof zh !== 'string' || !zh) continue;
    const translated = converter ? converter(zh) : zh;
    if (!nlsPlaceholdersMatch(messages[i], translated)) {
      placeholderSkipped++;
      continue;
    }
    replacements.push([i, translated]);
  }
  for (const [i, translated] of replacements) messages[i] = translated;
  if (options.stats) options.stats.placeholderSkipped = placeholderSkipped;
  return replacements.length;
}

function resolveLanguagePack(profile = {}, options = {}) {
  const ids = [profile.languagePackId, ...(profile.languagePackFallbackIds || [])].filter(Boolean);
  for (const id of ids) {
    const dir = findLanguagePack(id, options);
    if (dir) return { dir, id, fallback: id !== profile.languagePackId };
  }
  return { dir: null, id: ids[0] || null, fallback: false };
}

// 纯生成 NLS 补丁结果, 不写入磁盘. srcPath 可传入消息文件路径或消息数组;
// options.sourceText 可直接传入 JSON 文本, 便于事务提交前先完整生成并验证结果.
function buildPatchedNls(appDir, srcPath, nlsDict = {}, options = {}) {
  const profile = options.profile || {};
  const converter = options.converter || profile.converter || null;
  const { index, order, total } = buildIndex(appDir, options);
  const raw = options.sourceText !== undefined
    ? options.sourceText
    : Array.isArray(srcPath) ? srcPath : fs.readFileSync(srcPath, 'utf8');
  const messages = Array.isArray(raw) ? raw.slice() : JSON.parse(raw);
  if (!Array.isArray(messages)) throw new Error('nls.messages.json 必须是数组');
  if (messages.length !== total) {
    throw new Error(`nls.keys.json 展开数 (${total}) 与 nls.messages.json 条数 (${messages.length}) 不一致, 放弃 nls 层补丁`);
  }
  const ambiguous = findAmbiguousNlsKeys(index, messages);
  const ambiguousIds = new Set(ambiguous.map(({ id }) => id));
  assertUnambiguousNlsKeys(index, messages, Object.keys(nlsDict || {}));
  const sourceMessages = messages.slice();
  const unknown = [];
  let count = 0;
  for (const [key, zh] of Object.entries(nlsDict || {})) {
    const idxs = index.get(key);
    if (!idxs) { unknown.push(key); continue; }
    if (typeof zh !== 'string' || !zh) continue;
    for (const i of idxs) validateNlsPlaceholders(sourceMessages[i], zh, key);
  }
  const langPack = resolveLanguagePack(profile, options);
  const langPackStats = {};
  const langPackCount = applyLanguagePack(
    messages,
    order,
    loadLanguagePackMain(langPack.dir),
    langPack.fallback ? converter : null,
    { skipIds: ambiguousIds, stats: langPackStats },
  );
  for (const [key, zh] of Object.entries(nlsDict || {})) {
    const idxs = index.get(key);
    if (!idxs) continue;
    if (typeof zh !== 'string' || !zh) continue;
    for (const i of idxs) { messages[i] = zh; count++; }
  }
  return {
    text: JSON.stringify(messages),
    messages,
    count,
    unknown,
    langPackCount,
    langPackPlaceholderSkipped: langPackStats.placeholderSkipped || 0,
    langPackDir: langPack.dir,
    langPackId: langPack.id,
    usedFallbackLanguagePack: langPack.fallback,
    ambiguousSkipped: ambiguous.map(({ id, indexes }) => ({ id, indexes })),
  };
}

// 从原始副本 srcPath 出发, 先生成并验证完整结果, 再写入目标文件.
function patchNls(appDir, srcPath, nlsDict, options = {}) {
  const result = buildPatchedNls(appDir, srcPath, nlsDict, options);
  fs.writeFileSync(path.join(appDir, NLS_MESSAGES), result.text);
  return result;
}

module.exports = {
  buildIndex,
  buildPatchedNls,
  patchNls,
  findLanguagePack,
  loadLanguagePackMain,
  applyLanguagePack,
  resolveLanguagePack,
  parseSemver,
  compareSemver,
  extractNlsPlaceholders,
  nlsPlaceholdersMatch,
  validateNlsPlaceholders,
  findAmbiguousNlsKeys,
  assertUnambiguousNlsKeys,
};
