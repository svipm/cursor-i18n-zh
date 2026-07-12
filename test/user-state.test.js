'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { parseArgvJsonc } = require('../src/argv');
const {
  argvPath,
  captureInstallState,
  installStatePath,
  loadInstallState,
  restoreArgvState,
} = require('../src/user-state');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-i18n-user-state-'));
}

const profile = {
  languagePackId: 'ms-ceintl.vscode-language-pack-zh-hans',
};

test('captures state once and restores the previous locale', () => {
  const root = tmp();
  try {
    const home = path.join(root, 'home');
    const bdir = path.join(root, 'backup');
    const argv = argvPath(home);
    fs.mkdirSync(path.dirname(argv), { recursive: true });
    fs.writeFileSync(argv, '{\n  "locale": "en",\n  "foo": true\n}');

    const captured = captureInstallState(bdir, profile, { homeDir: home });
    assert.equal(captured.argv.localeValue, 'en');
    fs.writeFileSync(argv, '{\n  "locale": "zh-cn",\n  "foo": true\n}');

    restoreArgvState(loadInstallState(bdir), { homeDir: home });
    assert.deepEqual(parseArgvJsonc(fs.readFileSync(argv, 'utf8')), { locale: 'en', foo: true });

    captureInstallState(bdir, { languagePackId: 'different-pack' }, { homeDir: home });
    const updatedState = loadInstallState(bdir);
    assert.equal(updatedState.argv.localeValue, 'en');
    assert.deepEqual(updatedState.languagePacks, {
      'ms-ceintl.vscode-language-pack-zh-hans': { existed: false },
      'different-pack': { existed: false },
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('removes a locale added by the tool while preserving other argv settings', () => {
  const root = tmp();
  try {
    const home = path.join(root, 'home');
    const bdir = path.join(root, 'backup');
    const argv = argvPath(home);
    fs.mkdirSync(path.dirname(argv), { recursive: true });
    fs.writeFileSync(argv, '{\n  "foo": true\n}');
    captureInstallState(bdir, profile, { homeDir: home });
    fs.writeFileSync(argv, '{\n  "locale": "zh-cn",\n  "foo": false,\n  "later": 1\n}');

    restoreArgvState(loadInstallState(bdir), { homeDir: home });
    assert.deepEqual(parseArgvJsonc(fs.readFileSync(argv, 'utf8')), { foo: false, later: 1 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('removes argv.json when it did not exist before and remains empty', () => {
  const root = tmp();
  try {
    const home = path.join(root, 'home');
    const bdir = path.join(root, 'backup');
    captureInstallState(bdir, profile, { homeDir: home });
    const argv = argvPath(home);
    fs.mkdirSync(path.dirname(argv), { recursive: true });
    fs.writeFileSync(argv, '{\n  "locale": "zh-cn"\n}');

    const result = restoreArgvState(loadInstallState(bdir), { homeDir: home });
    assert.equal(result.removed, true);
    assert.equal(fs.existsSync(argv), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
