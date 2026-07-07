'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { readJson } = require('./util');

function uniq(list) {
  const seen = new Set();
  return list.filter((item) => {
    if (!item) return false;
    const key = path.resolve(item).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function appDirFrom(value) {
  if (!value) return null;
  const p = path.resolve(String(value).replace(/^"|"$/g, ''));
  if (fs.existsSync(path.join(p, 'product.json'))) return p;
  if (fs.existsSync(path.join(p, 'resources', 'app', 'product.json'))) {
    return path.join(p, 'resources', 'app');
  }

  const base = path.basename(p).toLowerCase();
  const dir = fs.existsSync(p) && fs.statSync(p).isFile() ? path.dirname(p) : p;
  if (base === 'cursor.exe' && fs.existsSync(path.join(dir, 'resources', 'app', 'product.json'))) {
    return path.join(dir, 'resources', 'app');
  }
  if ((base === 'cursor.cmd' || base === 'cursor') && fs.existsSync(path.join(dir, '..', 'resources', 'app', 'product.json'))) {
    return path.resolve(dir, '..', 'resources', 'app');
  }
  return null;
}

function splitPathEnv(value) {
  return String(value || '').split(path.delimiter).filter(Boolean);
}

function where(command) {
  if (process.platform !== 'win32') return [];
  const r = cp.spawnSync('where.exe', [command], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) return [];
  return r.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function registryInstallHints() {
  if (process.platform !== 'win32') return [];
  const roots = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ];
  const hints = [];
  for (const root of roots) {
    const r = cp.spawnSync('reg.exe', ['query', root, '/s', '/f', 'Cursor', '/d'], { encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) continue;
    for (const line of r.stdout.split(/\r?\n/)) {
      const m = line.match(/^\s+(InstallLocation|DisplayIcon|UninstallString)\s+REG_\w+\s+(.+)$/i);
      if (!m) continue;
      let value = m[2].trim();
      value = value.replace(/^"([^"]+)".*$/, '$1').replace(/,\d+$/, '');
      hints.push(value);
    }
  }
  return hints;
}

function candidates() {
  const list = [];
  if (process.env.CURSOR_APP_DIR) list.push(process.env.CURSOR_APP_DIR);

  const roots = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'cursor'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Cursor'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Cursor'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Cursor'),
  ];
  for (const root of roots) if (root) list.push(root, path.join(root, 'resources', 'app'));

  for (const dir of splitPathEnv(process.env.PATH)) {
    list.push(path.join(dir, 'cursor.cmd'), path.join(dir, 'Cursor.exe'));
  }
  list.push(...where('cursor'), ...where('Cursor.exe'), ...registryInstallHints());

  return uniq(list);
}

// 返回 resources/app 绝对路径.
function locateApp() {
  for (const dir of candidates()) {
    const appDir = appDirFrom(dir);
    if (appDir) return appDir;
  }
  throw new Error('未找到 Cursor 安装目录; 可用环境变量 CURSOR_APP_DIR 指定 resources/app 路径');
}

function readProduct(appDir) {
  return readJson(path.join(appDir, 'product.json'));
}

module.exports = { appDirFrom, candidates, locateApp, readProduct };
