#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const { locateApp, readProduct, resolveCandidates } = require('./locate');
const { CODE_TARGETS, NLS_MESSAGES, NLS_KEYS, PRODUCT_JSON, LANG_PACK_ID } = require('./config');
const { loadDicts } = require('./dict');
const { applyToText } = require('./engine');
const { patchNls } = require('./nls');
const { backupDir, ensureBackup, backupFilePath, listBackupFiles } = require('./backup');
const { sha256b64, ensureDir } = require('./util');
const { scanCode, scanNls } = require('./scan');
const { setLocaleInArgv } = require('./argv');

const ROOT = path.resolve(__dirname, '..');
const DICT_DIR = path.join(ROOT, 'dict');
const BUILD_DIR = path.join(ROOT, 'build');

function log(msg) { console.log(msg); }

function existingTargets(appDir) {
  return CODE_TARGETS.filter((rel) => fs.existsSync(path.join(appDir, rel)));
}

// 语法校验: 分别按 ESM/CJS 跑 node --check, 任一通过即可 (产物两种形态都有).
function syntaxCheck(text, rel) {
  const safeName = path.basename(rel).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'text';
  const base = path.join(os.tmpdir(), `cursor-i18n-check-${process.pid}-${safeName}`);
  let lastErr = '';
  for (const ext of ['.mjs', '.cjs']) {
    const tmp = base + ext;
    fs.writeFileSync(tmp, text);
    const r = cp.spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
    fs.rmSync(tmp, { force: true });
    if (r.status === 0) return;
    lastErr = r.stderr || String(r.status);
  }
  throw new Error(`补丁后语法校验未通过: ${rel}\n${lastErr.slice(0, 600)}`);
}

// 基于备份的原始 product.json 文本做替换, 保留原格式, 只更新受影响的 checksum 值.
function updateChecksums(appDir, bdir, patchedRels) {
  let raw = fs.readFileSync(backupFilePath(bdir, PRODUCT_JSON), 'utf8');
  const product = JSON.parse(raw);
  const updated = [];
  for (const rel of patchedRels) {
    const key = rel.replace(/^out\//, '');
    const old = product.checksums && product.checksums[key];
    if (!old) continue;
    const now = sha256b64(fs.readFileSync(path.join(appDir, rel)));
    raw = raw.split(`"${old}"`).join(`"${now}"`);
    updated.push(key);
  }
  fs.writeFileSync(path.join(appDir, PRODUCT_JSON), raw);
  return updated;
}

// 语言包缓存 (clp) 是按 nls 默认值合并生成的, 打补丁后必须清掉让其重建.
function clearClpCache() {
  const clp = path.join(process.env.APPDATA || '', 'Cursor', 'clp');
  if (process.env.APPDATA && fs.existsSync(clp)) {
    fs.rmSync(clp, { recursive: true, force: true });
    return true;
  }
  return false;
}

function cmdApply() {
  const appDir = locateApp();
  const product = readProduct(appDir);
  log(`Cursor ${product.version} (${(product.commit || '').slice(0, 8)}) @ ${appDir}`);

  const dicts = loadDicts(DICT_DIR);
  for (const w of dicts.warnings) log(`[词典警告] ${w}`);
  if (!dicts.code.size && !Object.keys(dicts.nls).length) {
    throw new Error('词典为空: dict/ 下没有可用条目');
  }
  log(`词典: 代码层 ${dicts.code.size} 条, nls 层 ${Object.keys(dicts.nls).length} 条`);

  const targets = existingTargets(appDir);
  const bdir = backupDir(ROOT, product.version);
  const warns = ensureBackup(appDir, [...targets, NLS_MESSAGES, NLS_KEYS, PRODUCT_JSON], bdir, product);
  for (const w of warns) log(`[备份警告] ${w}`);
  log(`备份就绪: ${path.relative(ROOT, bdir)}`);

  const report = { version: product.version, appliedAt: new Date().toISOString(), files: {}, misses: [] };
  const hit = new Set();

  for (const rel of targets) {
    const src = fs.readFileSync(backupFilePath(bdir, rel), 'utf8');
    const { text, counts, total } = applyToText(src, dicts.code);
    syntaxCheck(text, rel);
    fs.writeFileSync(path.join(appDir, rel), text);
    for (const en of counts.keys()) hit.add(en);
    report.files[rel] = total;
    log(`已打补丁: ${rel} (替换 ${total} 处)`);
  }

  {
    const { count, unknown, langPackCount, langPackDir } = patchNls(appDir, backupFilePath(bdir, NLS_MESSAGES), dicts.nls);
    report.files[NLS_MESSAGES] = { languagePack: langPackCount, cursorDict: count };
    if (langPackDir) log(`已导入官方中文语言包: ${path.basename(langPackDir)} (替换 ${langPackCount} 条)`);
    else log('[nls 警告] 未找到官方中文语言包, VS Code 基础界面不会由 nls 补丁覆盖');
    log(`已打补丁: ${NLS_MESSAGES} (Cursor 专有替换 ${count} 条)`);
    for (const k of unknown) log(`[nls 警告] 找不到 key: ${k}`);
  }

  const updated = updateChecksums(appDir, bdir, targets);
  log(`已更新 checksums: ${updated.join(', ') || '(无)'}`);
  if (clearClpCache()) log('已清除语言包缓存 (clp), 首次启动会自动重建');

  for (const en of dicts.code.keys()) if (!hit.has(en)) report.misses.push(en);
  ensureDir(BUILD_DIR);
  const reportPath = path.join(BUILD_DIR, 'apply-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  log(`未命中词条 ${report.misses.length} 个, 报告: ${path.relative(ROOT, reportPath)}`);
  log('完成. 完全退出 Cursor (含托盘图标) 后重启生效.');
}

function cmdRestore() {
  const appDir = locateApp();
  const product = readProduct(appDir);
  const bdir = backupDir(ROOT, product.version);
  const files = listBackupFiles(bdir);
  if (!files.length) throw new Error(`没有版本 ${product.version} 的备份, 无法还原`);
  for (const rel of files) {
    fs.copyFileSync(backupFilePath(bdir, rel), path.join(appDir, rel));
  }
  clearClpCache();
  log(`已还原 ${files.length} 个文件 (版本 ${product.version}). 重启 Cursor 生效.`);
}

function cmdStatus() {
  const appDir = locateApp();
  const product = readProduct(appDir);
  log(`Cursor: ${product.version} (${(product.commit || '').slice(0, 8)})`);
  log(`安装目录: ${appDir}`);
  const bdir = backupDir(ROOT, product.version);
  log(`备份: ${fs.existsSync(bdir) ? path.relative(ROOT, bdir) : '无'}`);
  const dicts = loadDicts(DICT_DIR);
  log(`词典: 代码层 ${dicts.code.size} 条, nls 层 ${Object.keys(dicts.nls).length} 条`);
  for (const rel of existingTargets(appDir)) {
    const key = rel.replace(/^out\//, '');
    const expected = product.checksums && product.checksums[key];
    const state = !expected
      ? '(无官方 checksum)'
      : sha256b64(fs.readFileSync(path.join(appDir, rel))) === expected ? '原版' : '已修改';
    log(`  ${rel}: ${state}`);
  }
  const argvPath = path.join(os.homedir(), '.cursor', 'argv.json');
  let locale = '(未设置)';
  if (fs.existsSync(argvPath)) {
    const m = fs.readFileSync(argvPath, 'utf8').match(/"locale"\s*:\s*"([^"]+)"/);
    if (m) locale = m[1];
  }
  log(`显示语言 locale: ${locale}`);
  const extDir = path.join(os.homedir(), '.cursor', 'extensions');
  const hasPack = fs.existsSync(extDir)
    && fs.readdirSync(extDir).some((d) => d.toLowerCase().startsWith(LANG_PACK_ID));
  log(`官方中文语言包: ${hasPack ? '已安装' : '未安装 (npm run lang 可安装)'}`);
}

function cmdLocate() {
  const verbose = process.argv.includes('--verbose');
  const items = resolveCandidates();
  if (!verbose) {
    const usable = items.filter((item) => item.appDir);
    if (!usable.length) throw new Error('未找到 Cursor 安装目录; 可用环境变量 CURSOR_APP_DIR 指定 resources/app 路径');
    log(`Cursor 安装目录: ${usable[0].appDir}`);
    const sources = [...new Set(usable.map((item) => item.source))].join(', ');
    log(`识别来源: ${sources}`);
    log('如需查看全部探测候选, 运行: npm run locate -- --verbose');
    return;
  }
  let found = false;
  for (const item of items) {
    const state = item.appDir ? `可用 -> ${item.appDir}` : '不可用';
    log(`${item.source}: ${item.value} (${state})`);
    if (item.appDir) found = true;
  }
  if (!found) throw new Error('未找到 Cursor 安装目录; 可用环境变量 CURSOR_APP_DIR 指定 resources/app 路径');
}

function cmdScan() {
  const appDir = locateApp();
  const targets = existingTargets(appDir);
  const code = scanCode(appDir, targets, BUILD_DIR);
  const nls = scanNls(appDir, BUILD_DIR);
  log(`代码层候选 ${code.total} 条 -> ${path.relative(ROOT, code.out)}`);
  log(`nls 层候选 ${nls.total} 条 -> ${path.relative(ROOT, nls.out)}`);
}

function cmdCheck() {
  const dicts = loadDicts(DICT_DIR);
  for (const w of dicts.warnings) log(`[词典警告] ${w}`);
  if (!dicts.code.size && !Object.keys(dicts.nls).length) {
    throw new Error('词典为空: dict/ 下没有可用条目');
  }
  log(`词典校验通过: 代码层 ${dicts.code.size} 条, nls 层 ${Object.keys(dicts.nls).length} 条`);

  try {
    const appDir = locateApp();
    const targets = existingTargets(appDir);
    log(`Cursor 安装目录可用: ${appDir}`);
    log(`可补丁目标: ${targets.join(', ') || '(无)'}`);
    for (const rel of targets) {
      const src = fs.readFileSync(path.join(appDir, rel), 'utf8');
      const { text, total } = applyToText(src, dicts.code);
      syntaxCheck(text, rel);
      log(`语法预检通过: ${rel} (预计替换 ${total} 处)`);
    }
  } catch (e) {
    log(`[环境提示] ${e.message}`);
  }
}

function cmdLang() {
  const argvPath = path.join(os.homedir(), '.cursor', 'argv.json');
  let raw = fs.existsSync(argvPath) ? fs.readFileSync(argvPath, 'utf8') : '{\n}';
  raw = setLocaleInArgv(raw, 'zh-cn');
  JSON.parse(raw);
  ensureDir(path.dirname(argvPath));
  fs.writeFileSync(argvPath, raw);
  log(`已设置 locale = zh-cn (${argvPath})`);

  const appDir = locateApp();
  const cli = path.join(appDir, 'bin', process.platform === 'win32' ? 'cursor.cmd' : 'cursor');
  if (!fs.existsSync(cli)) {
    log(`未找到 CLI (${cli}), 请在 Cursor 扩展面板手动安装: ${LANG_PACK_ID}`);
    return;
  }
  log(`正在安装官方中文语言包 ${LANG_PACK_ID} (需要网络) ...`);
  const r = cp.spawnSync(`"${cli}"`, ['--install-extension', LANG_PACK_ID], { encoding: 'utf8', shell: true });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  if (out) log(out);
  if (r.status !== 0) log('安装失败: 可在 Cursor 扩展面板搜索 "Chinese (Simplified)" 手动安装.');
}

const commands = { apply: cmdApply, restore: cmdRestore, status: cmdStatus, locate: cmdLocate, scan: cmdScan, lang: cmdLang, check: cmdCheck };
const cmd = process.argv[2];

if (!cmd || !commands[cmd]) {
  log('用法: node src/cli.js <apply|restore|status|locate|scan|lang|check>');
  log('  apply   打汉化补丁 (自动备份原文件, 可重复执行)');
  log('  restore 还原为原版文件');
  log('  status  查看安装/补丁/语言状态');
  log('  locate  显示 Cursor 安装目录自动探测结果');
  log('  scan    提取候选字符串到 build/ (维护词典用)');
  log('  lang    locale 设为 zh-cn 并安装官方中文语言包 (VS Code 基础界面)');
  log('  check   校验词典与本机 Cursor 路径, 不修改 Cursor');
  process.exit(cmd ? 1 : 0);
}

try {
  commands[cmd]();
} catch (e) {
  console.error(`[错误] ${e.message}`);
  process.exit(1);
}
