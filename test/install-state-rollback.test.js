'use strict';

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function stubModule(file, exports) {
  const resolved = require.resolve(file);
  const previous = require.cache[resolved];
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
  };
  return () => {
    if (previous) require.cache[resolved] = previous;
    else delete require.cache[resolved];
  };
}

test('restores the exact previous install state when adding a language pack fails', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-i18n-install-rollback-'));
  const appDir = path.join(sandbox, 'app');
  const homeDir = path.join(sandbox, 'home');
  const bdir = path.join(sandbox, 'backup');
  const targetRel = 'out/main.js';
  const target = path.join(appDir, targetRel);
  const argv = path.join(homeDir, '.cursor', 'argv.json');
  const stateFile = path.join(bdir, 'install-state.json');
  const cliPath = path.join(root, 'src', 'cli.js');
  const userStatePath = path.join(root, 'src', 'user-state.js');
  const zhHans = 'ms-ceintl.vscode-language-pack-zh-hans';
  const zhHant = 'ms-ceintl.vscode-language-pack-zh-hant';
  const previousState = {
    schema: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    argv: {
      fileExisted: true,
      localePresent: true,
      localeValue: 'en',
    },
    languagePacks: {
      [zhHant]: { existed: true },
    },
    marker: 'preserve formatting and extra fields',
  };
  const previousStateRaw = Buffer.from(
    `${JSON.stringify(previousState, null, 4).replace(/\n/g, '\r\n')}\r\n`,
  );
  const previousArgv = '{\r\n  "locale": "en",\r\n  "foo": true\r\n}\r\n';

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.mkdirSync(path.join(appDir, 'bin'), { recursive: true });
  fs.mkdirSync(path.dirname(argv), { recursive: true });
  fs.mkdirSync(bdir, { recursive: true });
  fs.writeFileSync(target, 'const title = "Open";');
  fs.writeFileSync(path.join(appDir, 'product.json'), JSON.stringify({
    version: 'install-state-rollback-test',
    commit: 'test-commit',
    checksums: {},
  }));
  fs.writeFileSync(path.join(appDir, 'bin', 'cursor.cmd'), '@exit /b 0\r\n');
  fs.writeFileSync(argv, previousArgv);
  fs.writeFileSync(stateFile, previousStateRaw);

  const originalSpawnSync = cp.spawnSync;
  const originalHomeDir = os.homedir;
  const originalArgv = process.argv;
  const originalLog = console.log;
  const originalError = console.error;
  const restoreStubs = [];
  let packInstalled = false;
  let applyCalls = 0;

  try {
    os.homedir = () => homeDir;
    console.log = () => {};
    console.error = () => {};
    cp.spawnSync = (command, args) => {
      if (command === process.execPath) return { status: 0, stdout: '', stderr: '' };
      if (command === 'taskkill.exe') return { status: 0, stdout: '', stderr: '' };
      if (command === 'tasklist.exe') return { status: 0, stdout: '', stderr: '' };
      if (args && args[0] === '--install-extension') {
        packInstalled = true;
        return { status: 0, stdout: '', stderr: '' };
      }
      if (args && args[0] === '--uninstall-extension') {
        packInstalled = false;
        return { status: 0, stdout: '', stderr: '' };
      }
      throw new Error(`unexpected spawn: ${command}`);
    };

    restoreStubs.push(stubModule(path.join(root, 'src', 'locate.js'), {
      locateApp: () => appDir,
      readProduct: () => ({
        version: 'install-state-rollback-test',
        commit: 'test-commit',
        checksums: {},
      }),
      resolveCandidates: () => [],
    }));
    restoreStubs.push(stubModule(path.join(root, 'src', 'discover.js'), {
      discoverTargets: () => [targetRel],
    }));
    restoreStubs.push(stubModule(path.join(root, 'src', 'dict.js'), {
      loadDicts: () => ({
        code: new Map([['Open', { zh: 'Localized' }]]),
        nls: {},
        warnings: [],
      }),
    }));
    restoreStubs.push(stubModule(path.join(root, 'src', 'engine.js'), {
      applyToText: (text) => {
        applyCalls++;
        if (applyCalls === 2) {
          const current = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
          assert.deepEqual(current.languagePacks[zhHans], { existed: false });
          throw new Error('simulated patch failure');
        }
        return { text, counts: new Map([['Open', 1]]), total: 1 };
      },
    }));
    restoreStubs.push(stubModule(path.join(root, 'src', 'nls.js'), {
      buildPatchedNls: () => {
        throw new Error('unexpected NLS patch');
      },
      findLanguagePack: (id) => (id === zhHans && packInstalled ? 'installed-pack' : null),
    }));
    restoreStubs.push(stubModule(path.join(root, 'src', 'backup.js'), {
      backupDir: () => bdir,
      ensureBackup: () => [],
      backupFilePath: (dir, rel) => path.join(dir, 'files', rel),
      listBackupFiles: () => [],
      validateBackupSources: () => [],
      validateBackupFiles: () => [],
      validateCompleteBackup: () => [],
      formatBackupSourceIssues: () => 'unexpected backup source issue',
      formatBackupFileIssues: () => 'unexpected backup file issue',
    }));

    process.argv = [process.execPath, cliPath, 'install', '--locale', 'zh-cn'];
    delete require.cache[require.resolve(cliPath)];
    delete require.cache[require.resolve(userStatePath)];
    const { main } = require(cliPath);

    assert.equal(main(), 1);
    assert.equal(applyCalls, 2);
    assert.equal(packInstalled, false);
    assert.deepEqual(fs.readFileSync(stateFile), previousStateRaw);
    assert.equal(fs.readFileSync(argv, 'utf8'), previousArgv);
  } finally {
    cp.spawnSync = originalSpawnSync;
    os.homedir = originalHomeDir;
    process.argv = originalArgv;
    console.log = originalLog;
    console.error = originalError;
    delete require.cache[require.resolve(cliPath)];
    delete require.cache[require.resolve(userStatePath)];
    for (const restore of restoreStubs.reverse()) restore();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});
