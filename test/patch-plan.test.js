'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { buildPatchPlan } = require('../src/cli');
const { commitFiles } = require('../src/transaction');
const { sha256b64 } = require('../src/util');

test('builds and commits a complete patch plan without mutating live files early', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-i18n-plan-'));
  try {
    const appDir = path.join(root, 'app');
    const targetRel = 'out/main.js';
    const target = path.join(appDir, targetRel);
    const productPath = path.join(appDir, 'product.json');
    const original = 'const action={label:"Open Browser"};';
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, original);
    fs.writeFileSync(productPath, JSON.stringify({
      version: '1.0.0',
      commit: 'test-commit',
      checksums: { 'main.js': sha256b64(Buffer.from(original)) },
    }));

    const ctx = {
      appDir,
      bdir: path.join(root, 'backup'),
      dicts: {
        code: new Map([['Open Browser', { zh: '打开浏览器', ctx: ['prop'] }]]),
        nls: {},
      },
      product: { version: '1.0.0', commit: 'test-commit' },
      profile: { locale: 'zh-cn', name: '简体中文', languagePackId: 'none' },
      targets: [targetRel],
    };

    const plan = buildPatchPlan(ctx);
    assert.equal(fs.readFileSync(target, 'utf8'), original);
    assert.equal(plan.report.files[targetRel], 1);

    commitFiles(plan.entries);
    const patched = fs.readFileSync(target, 'utf8');
    const product = JSON.parse(fs.readFileSync(productPath, 'utf8'));
    assert.match(patched, /打开浏览器/);
    assert.equal(product.checksums['main.js'], sha256b64(Buffer.from(patched)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('reports official language pack placeholder skips in the patch report', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-i18n-plan-'));
  try {
    const appDir = path.join(root, 'app');
    const homeDir = path.join(root, 'home');
    const targetRel = 'out/main.js';
    const target = path.join(appDir, targetRel);
    const productPath = path.join(appDir, 'product.json');
    const keysPath = path.join(appDir, 'out', 'nls.keys.json');
    const messagesPath = path.join(appDir, 'out', 'nls.messages.json');
    const languagePackId = 'example.language-pack';

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'const action={label:"Stable"};');
    fs.writeFileSync(productPath, JSON.stringify({
      version: '1.0.0',
      commit: 'test-commit',
      checksums: {},
    }));
    fs.writeFileSync(keysPath, JSON.stringify([['module', ['bad', 'safe']]]));
    fs.writeFileSync(messagesPath, JSON.stringify(['Open {0}', 'File']));
    fs.mkdirSync(path.join(
      homeDir,
      '.cursor',
      'extensions',
      `${languagePackId}-1.0.0`,
      'translations',
    ), { recursive: true });
    fs.writeFileSync(path.join(
      homeDir,
      '.cursor',
      'extensions',
      `${languagePackId}-1.0.0`,
      'translations',
      'main.i18n.json',
    ), JSON.stringify({
      contents: {
        module: {
          bad: '打开',
          safe: '文件',
        },
      },
    }));

    const ctx = {
      appDir,
      bdir: path.join(root, 'backup'),
      dicts: {
        code: new Map(),
        nls: {},
      },
      homeDir,
      product: { version: '1.0.0', commit: 'test-commit' },
      profile: { locale: 'zh-cn', name: '简体中文', languagePackId },
      targets: [targetRel],
    };

    const plan = buildPatchPlan(ctx);

    assert.deepEqual(plan.report.files['out/nls.messages.json'], {
      languagePack: 1,
      languagePackPlaceholderSkipped: 1,
      cursorDict: 0,
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
