'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { getLocaleState, parseArgvJsonc, removeLocaleFromArgv, setLocaleInArgv } = require('./argv');
const { findLanguagePack } = require('./nls');
const { atomicWriteFile, commitFiles } = require('./transaction');

const STATE_SCHEMA = 2;
const STATE_FILE = 'install-state.json';

function argvPath(homeDir = os.homedir()) {
  return path.join(homeDir, '.cursor', 'argv.json');
}

function installStatePath(bdir) {
  return path.join(bdir, STATE_FILE);
}

function readState(file) {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`安装状态文件无效: ${error.message}`);
  }
  if (!state || state.schema !== STATE_SCHEMA || !state.argv
    || !state.languagePacks || typeof state.languagePacks !== 'object') {
    throw new Error('安装状态文件格式不受支持');
  }
  return state;
}

function captureInstallState(bdir, profile, options = {}) {
  const file = installStatePath(bdir);
  const homeDir = options.homeDir || os.homedir();
  if (fs.existsSync(file)) {
    const existing = readState(file);
    if (!Object.prototype.hasOwnProperty.call(existing.languagePacks, profile.languagePackId)) {
      existing.languagePacks[profile.languagePackId] = {
        existed: Boolean(findLanguagePack(profile.languagePackId, { homeDir })),
      };
      atomicWriteFile(file, JSON.stringify(existing, null, 2));
    }
    return existing;
  }

  const target = argvPath(homeDir);
  const existed = fs.existsSync(target);
  const raw = existed ? fs.readFileSync(target, 'utf8') : '{\n}';
  const locale = getLocaleState(raw);
  const languagePackDir = findLanguagePack(profile.languagePackId, { homeDir });
  const state = {
    schema: STATE_SCHEMA,
    createdAt: new Date().toISOString(),
    argv: {
      fileExisted: existed,
      localePresent: locale.present,
      localeValue: locale.present ? locale.value : null,
    },
    languagePacks: {
      [profile.languagePackId]: {
        existed: Boolean(languagePackDir),
      },
    },
  };
  atomicWriteFile(file, JSON.stringify(state, null, 2));
  return state;
}

function loadInstallState(bdir) {
  const file = installStatePath(bdir);
  if (!fs.existsSync(file)) throw new Error(`缺少安装状态文件: ${file}`);
  return readState(file);
}

function buildArgvRestoreEntry(state, options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const target = argvPath(homeDir);
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '{\n}';
  const updated = state.argv.localePresent
    ? setLocaleInArgv(current, state.argv.localeValue)
    : removeLocaleFromArgv(current);
  const parsed = parseArgvJsonc(updated);

  if (!state.argv.fileExisted && Object.keys(parsed).length === 0) {
    return { target, remove: true };
  }
  return { target, data: updated };
}

function restoreArgvState(state, options = {}) {
  const entry = buildArgvRestoreEntry(state, options);
  commitFiles([entry]);
  return { removed: entry.remove === true, path: entry.target };
}

module.exports = {
  argvPath,
  buildArgvRestoreEntry,
  captureInstallState,
  installStatePath,
  loadInstallState,
  restoreArgvState,
};
