'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  applyLanguagePack,
  buildPatchedNls,
  compareSemver,
  extractNlsPlaceholders,
  findAmbiguousNlsKeys,
  findLanguagePack,
  nlsPlaceholdersMatch,
  validateNlsPlaceholders,
} = require('../src/nls');
const { toTraditional } = require('../src/locale');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-i18n-nls-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

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

  const stats = {};
  const count = applyLanguagePack(messages, order, contents, null, { stats });
  assert.equal(count, 2);
  assert.deepEqual(stats, { placeholderSkipped: 0 });
  assert.deepEqual(messages, ['文件', '编辑', 'Cursor Only']);
});

test('applies converter to language pack entries', () => {
  const messages = ['File'];
  const order = [['vs/platform/menubar/electron-main/menubar', 'mFile']];
  const contents = {
    'vs/platform/menubar/electron-main/menubar': { mFile: '文件' },
  };

  const count = applyLanguagePack(messages, order, contents, toTraditional);
  assert.equal(count, 1);
  assert.deepEqual(messages, ['檔案']);
});

test('compares language pack versions using semantic version precedence', () => {
  assert.ok(compareSemver('1.10.0', '1.9.0') > 0);
  assert.ok(compareSemver('1.10.0', '1.10.0-beta.2') > 0);
  assert.ok(compareSemver('1.10.0-beta.10', '1.10.0-beta.2') > 0);
});

test('finds the newest installed language pack by semantic version', (t) => {
  const homeDir = tempDir(t);
  const id = 'ms-ceintl.vscode-language-pack-zh-hans';
  for (const version of ['1.9.0', '1.10.0-beta.1', '1.10.0']) {
    writeJson(path.join(homeDir, '.cursor', 'extensions', `${id}-${version}`, 'translations', 'main.i18n.json'), {
      contents: {},
    });
  }

  const found = findLanguagePack(id, { homeDir });
  assert.equal(path.basename(found), `${id}-1.10.0`);
});

test('validates NLS placeholders as an order-independent multiset', () => {
  assert.deepEqual(extractNlsPlaceholders('Use {1}, then {0} and {1}'), [0, 1, 1]);
  assert.equal(nlsPlaceholdersMatch('Open {0} with {1}', '使用 {1} 开启 {0}'), true);
  assert.equal(nlsPlaceholdersMatch('Open {0} twice: {0}', '开启 {0}'), false);
  assert.throws(
    () => validateNlsPlaceholders('Open {0} with {1}', '使用 {0} 开启', 'module#key'),
    /module#key 占位符不一致/,
  );
});

test('skips language pack entries with mismatched placeholders and reports the count', () => {
  const messages = ['File', 'Open {0} with {1}'];
  const order = [['module', 'file'], ['module', 'key']];
  const contents = { module: { file: '文件', key: '使用 {0} 开启' } };

  const stats = {};
  const count = applyLanguagePack(messages, order, contents, null, { stats });

  assert.equal(count, 1);
  assert.deepEqual(stats, { placeholderSkipped: 1 });
  assert.deepEqual(messages, ['文件', 'Open {0} with {1}']);
});

test('detects duplicate module keys that point to different source messages', () => {
  const index = new Map([
    ['module#same', [0, 1]],
    ['module#safe', [2, 3]],
  ]);
  const ambiguous = findAmbiguousNlsKeys(index, ['First', 'Second', 'Same', 'Same']);

  assert.deepEqual(ambiguous, [{
    id: 'module#same',
    indexes: [0, 1],
    values: ['First', 'Second'],
  }]);
});

test('builds a validated NLS result without writing the live message file', (t) => {
  const appDir = tempDir(t);
  const sourcePath = path.join(appDir, 'original.messages.json');
  const keysPath = path.join(appDir, 'backup', 'nls.keys.json');
  writeJson(keysPath, [['module', ['title']]]);
  writeJson(sourcePath, ['Open {0}']);

  const result = buildPatchedNls(
    appDir,
    sourcePath,
    { 'module#title': '开启 {0}' },
    { keysPath },
  );

  assert.deepEqual(JSON.parse(result.text), ['开启 {0}']);
  assert.equal(result.count, 1);
  assert.equal(fs.existsSync(path.join(appDir, 'out', 'nls.messages.json')), false);
});

test('reports placeholder mismatches skipped from an official language pack', (t) => {
  const appDir = tempDir(t);
  const homeDir = tempDir(t);
  const sourcePath = path.join(appDir, 'original.messages.json');
  const languagePackId = 'example.language-pack';
  writeJson(path.join(appDir, 'out', 'nls.keys.json'), [['module', ['bad', 'safe']]]);
  writeJson(sourcePath, ['Open {0}', 'File']);
  writeJson(path.join(
    homeDir,
    '.cursor',
    'extensions',
    `${languagePackId}-1.0.0`,
    'translations',
    'main.i18n.json',
  ), {
    contents: { module: { bad: '打开', safe: '文件' } },
  });

  const result = buildPatchedNls(appDir, sourcePath, {}, {
    homeDir,
    profile: { languagePackId },
  });

  assert.deepEqual(result.messages, ['Open {0}', '文件']);
  assert.equal(result.langPackCount, 1);
  assert.equal(result.langPackPlaceholderSkipped, 1);
});

test('converts only a fallback Simplified Chinese language pack', (t) => {
  const appDir = tempDir(t);
  const sourcePath = path.join(appDir, 'original.messages.json');
  const primaryId = 'example.zh-hant';
  const fallbackId = 'example.zh-hans';
  writeJson(path.join(appDir, 'out', 'nls.keys.json'), [['module', ['item']]]);
  writeJson(sourcePath, ['Item']);

  const nativeHome = tempDir(t);
  writeJson(path.join(
    nativeHome,
    '.cursor',
    'extensions',
    `${primaryId}-1.0.0`,
    'translations',
    'main.i18n.json',
  ), {
    contents: { module: { item: '項目' } },
  });

  let converterCalls = 0;
  const converter = (value) => {
    converterCalls++;
    return `converted:${value}`;
  };
  const profile = {
    languagePackId: primaryId,
    languagePackFallbackIds: [fallbackId],
    converter,
  };
  const nativeResult = buildPatchedNls(appDir, sourcePath, {}, {
    homeDir: nativeHome,
    profile,
  });

  assert.deepEqual(nativeResult.messages, ['項目']);
  assert.equal(nativeResult.usedFallbackLanguagePack, false);
  assert.equal(converterCalls, 0);

  const fallbackHome = tempDir(t);
  writeJson(path.join(
    fallbackHome,
    '.cursor',
    'extensions',
    `${fallbackId}-1.0.0`,
    'translations',
    'main.i18n.json',
  ), {
    contents: { module: { item: '项目' } },
  });
  const fallbackResult = buildPatchedNls(appDir, sourcePath, {}, {
    homeDir: fallbackHome,
    profile,
  });

  assert.deepEqual(fallbackResult.messages, ['converted:项目']);
  assert.equal(fallbackResult.usedFallbackLanguagePack, true);
  assert.equal(converterCalls, 1);
});

test('rejects ambiguous duplicate keys and invalid dictionary placeholders', (t) => {
  const appDir = tempDir(t);
  const sourcePath = path.join(appDir, 'original.messages.json');
  writeJson(path.join(appDir, 'out', 'nls.keys.json'), [['module', ['same', 'same']]]);
  writeJson(sourcePath, ['First {0}', 'Second {0}']);

  assert.throws(
    () => buildPatchedNls(appDir, sourcePath, { 'module#same': '译文 {0}' }),
    /对应不同原文的歧义/,
  );

  writeJson(path.join(appDir, 'out', 'nls.keys.json'), [['module', ['same']]]);
  writeJson(sourcePath, ['First {0}']);
  assert.throws(
    () => buildPatchedNls(appDir, sourcePath, { 'module#same': '译文' }),
    /占位符不一致/,
  );
});

test('skips ambiguous duplicate keys from the official language pack when the custom dictionary does not target them', (t) => {
  const appDir = tempDir(t);
  const homeDir = tempDir(t);
  const sourcePath = path.join(appDir, 'original.messages.json');
  const languagePackId = 'example.language-pack';
  writeJson(path.join(appDir, 'out', 'nls.keys.json'), [['module', ['same', 'same', 'safe']]]);
  writeJson(sourcePath, ['First', 'Second', 'Safe']);
  writeJson(path.join(
    homeDir,
    '.cursor',
    'extensions',
    `${languagePackId}-1.0.0`,
    'translations',
    'main.i18n.json',
  ), {
    contents: { module: { same: '歧义', safe: '安全' } },
  });

  const result = buildPatchedNls(appDir, sourcePath, {}, {
    homeDir,
    profile: { languagePackId },
  });

  assert.deepEqual(JSON.parse(result.text), ['First', 'Second', '安全']);
  assert.deepEqual(result.ambiguousSkipped, [{ id: 'module#same', indexes: [0, 1] }]);
});
