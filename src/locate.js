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

function uniqHints(list) {
  const seen = new Set();
  return list.filter((hint) => {
    if (!hint || !hint.value) return false;
    const key = path.resolve(hint.value).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanValue(value) {
  const raw = String(value || '')
    .trim()
    .replace(/^"([^"]+)".*$/, '$1')
    .replace(/,\d+$/, '')
    .replace(/^"|"$/g, '');
  const exe = raw.match(/^(.+?\.exe)(?:\s+.*)?$/i);
  if (exe) return exe[1];
  const cmd = raw.match(/^(.+?\.cmd)(?:\s+.*)?$/i);
  if (cmd) return cmd[1];
  return raw;
}

function appDirFrom(value) {
  if (!value) return null;
  const p = path.resolve(cleanValue(value));
  if (fs.existsSync(path.join(p, 'product.json'))) return p;
  if (fs.existsSync(path.join(p, 'resources', 'app', 'product.json'))) {
    return path.join(p, 'resources', 'app');
  }
  if (fs.existsSync(path.join(p, 'Contents', 'Resources', 'app', 'product.json'))) {
    return path.join(p, 'Contents', 'Resources', 'app');
  }

  const base = path.basename(p).toLowerCase();
  const dir = fs.existsSync(p) && fs.statSync(p).isFile() ? path.dirname(p) : p;
  if (fs.existsSync(path.join(dir, 'resources', 'app', 'product.json'))) {
    return path.join(dir, 'resources', 'app');
  }
  if (process.platform === 'darwin'
    && fs.existsSync(path.join(dir, '..', 'Resources', 'app', 'product.json'))) {
    return path.resolve(dir, '..', 'Resources', 'app');
  }
  if (base === 'cursor.exe' && fs.existsSync(path.join(dir, 'resources', 'app', 'product.json'))) {
    return path.join(dir, 'resources', 'app');
  }
  if ((base === 'cursor.cmd' || base === 'cursor') && fs.existsSync(path.join(dir, '..', 'product.json'))) {
    return path.resolve(dir, '..');
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
  const r = cp.spawnSync('where.exe', [command], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  if (r.status !== 0) return [];
  return r.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function runningProcessHints() {
  if (process.platform !== 'win32') return [];
  const script = "Get-CimInstance Win32_Process -Filter \"Name='Cursor.exe'\" | ForEach-Object { $_.ExecutablePath }";
  const r = cp.spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8', windowsHide: true, timeout: 5000,
  });
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
      const value = cleanValue(m[2]);
      if (/\\unins\d*\.exe$/i.test(value)) continue;
      hints.push(value);
    }
  }
  return hints;
}

function childCursorDirs(root) {
  if (!root || !fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!/cursor/i.test(entry.name)) continue;
    out.push(path.join(root, entry.name));
  }
  return out;
}

function sourceCandidates() {
  const list = [];
  const add = (source, values) => {
    for (const value of Array.isArray(values) ? values : [values]) {
      if (value) list.push({ source, value });
    }
  };

  add('CURSOR_APP_DIR', process.env.CURSOR_APP_DIR);
  add('CURSOR_EXE', process.env.CURSOR_EXE);

  const roots = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'cursor'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Cursor'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Cursor'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Cursor'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Cursor'),
    process.platform === 'darwin' && '/Applications/Cursor.app',
    process.platform === 'darwin' && path.join(process.env.HOME || '', 'Applications', 'Cursor.app'),
  ];
  for (const root of roots) if (root) add('常见安装目录', [
    root,
    path.join(root, 'resources', 'app'),
    path.join(root, 'Contents', 'Resources', 'app'),
  ]);

  add('常见父目录扫描', [
    ...childCursorDirs(process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')),
    ...childCursorDirs(process.env.ProgramFiles),
    ...childCursorDirs(process.env['ProgramFiles(x86)']),
  ]);

  for (const dir of splitPathEnv(process.env.PATH)) {
    const paths = [path.join(dir, 'cursor.cmd'), path.join(dir, 'cursor'), path.join(dir, 'Cursor.exe')]
      .filter((p) => fs.existsSync(p));
    add('PATH', paths);
  }
  add('where.exe', [...where('cursor'), ...where('Cursor.exe')]);
  add('运行中进程', runningProcessHints());
  add('注册表', registryInstallHints());

  return uniqHints(list);
}

function candidates() {
  const list = sourceCandidates().map((item) => item.value);
  return uniq(list);
}

function resolveCandidates() {
  return sourceCandidates().map((item) => ({ ...item, appDir: appDirFrom(item.value) }));
}

// 返回 resources/app 绝对路径.
function locateApp() {
  for (const item of resolveCandidates()) {
    if (item.appDir) return item.appDir;
  }
  throw new Error('未找到 Cursor 安装目录; 可用环境变量 CURSOR_APP_DIR 指定 resources/app 路径');
}

function readProduct(appDir) {
  return readJson(path.join(appDir, 'product.json'));
}

module.exports = { appDirFrom, candidates, locateApp, readProduct, resolveCandidates, sourceCandidates };
