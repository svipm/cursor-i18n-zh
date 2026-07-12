#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const { locateApp, readProduct, resolveCandidates } = require('./locate');
const { CODE_TARGETS, NLS_MESSAGES, NLS_KEYS, PRODUCT_JSON } = require('./config');
const { discoverTargets } = require('./discover');
const { loadDicts } = require('./dict');
const { applyToText } = require('./engine');
const { buildPatchedNls, findLanguagePack } = require('./nls');
const {
  backupDir,
  ensureBackup,
  backupFilePath,
  listBackupFiles,
  validateBackupSources,
  validateBackupFiles,
  formatBackupSourceIssues,
  formatBackupFileIssues,
} = require('./backup');
const { sha256b64, ensureDir } = require('./util');
const { scanCode, scanNls } = require('./scan');
const { getLocaleState, setLocaleInArgv, parseArgvJsonc } = require('./argv');
const { DEFAULT_LOCALE, getLanguageProfile, listLanguageProfiles } = require('./locale');
const { atomicWriteFile, commitFiles } = require('./transaction');
const {
  argvPath,
  buildArgvRestoreEntry,
  captureInstallState,
  installStatePath,
  loadInstallState,
} = require('./user-state');

const ROOT = path.resolve(__dirname, '..');
const DICT_DIR = path.join(ROOT, 'dict');
const BUILD_DIR = path.join(ROOT, 'build');

function log(msg) { console.log(msg); }

function optionValue(names, fallback = null) {
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    for (const name of names) {
      if (arg === name) return process.argv[i + 1] || fallback;
      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
    }
  }
  return fallback;
}

function selectedProfile() {
  return getLanguageProfile(optionValue(['--locale', '--lang'], DEFAULT_LOCALE));
}

function existingTargets(appDir) {
  return discoverTargets(appDir).filter((rel) => fs.existsSync(path.join(appDir, rel)));
}

// 通过 stdin 交给 Node 语法检查, 避免为每个超大入口包创建临时文件.
function syntaxCheck(text, rel) {
  const common = { encoding: 'utf8', input: text, maxBuffer: 1024 * 1024 };
  const cjs = cp.spawnSync(process.execPath, ['--check', '-'], common);
  if (cjs.status === 0) return;
  const esm = cp.spawnSync(process.execPath, ['--input-type=module', '--check', '-'], common);
  if (esm.status === 0) return;
  const detail = (esm.stderr || cjs.stderr || String(esm.status)).slice(0, 600);
  throw new Error(`补丁后语法校验未通过: ${rel}\n${detail}`);
}

function buildUpdatedProduct(raw, patchedFiles) {
  const product = JSON.parse(raw);
  const updated = [];
  for (const [rel, data] of patchedFiles) {
    const key = rel.replace(/^out\//, '');
    if (!product.checksums || !product.checksums[key]) continue;
    product.checksums[key] = sha256b64(Buffer.from(data));
    updated.push(key);
  }
  return { text: `${JSON.stringify(product, null, 2)}\n`, updated };
}

// 语言包缓存 (clp) 是按 nls 默认值合并生成的, 打补丁后必须清掉让其重建.

function backupGuardTranslations() {
  const values = new Set();
  const isLocalized = (value) => typeof value === 'string'
    && value.length >= 2
    && /[\u3400-\u9FFF\uF900-\uFAFF]/.test(value);
  for (const item of listLanguageProfiles()) {
    const dicts = loadDicts(DICT_DIR, { profile: item });
    for (const entry of dicts.code.values()) if (isLocalized(entry.zh)) values.add(entry.zh);
    for (const zh of Object.values(dicts.nls)) if (isLocalized(zh)) values.add(zh);
  }
  return [...values].sort((a, b) => b.length - a.length);
}

function clearClpCache() {
  const clp = path.join(process.env.APPDATA || '', 'Cursor', 'clp');
  if (process.env.APPDATA && fs.existsSync(clp)) {
    fs.rmSync(clp, { recursive: true, force: true });
    return true;
  }
  return false;
}

function cursorCliPath(appDir) {
  return path.join(appDir, 'bin', process.platform === 'win32' ? 'cursor.cmd' : 'cursor');
}

function runCursorExtensionCommand(appDir, action, extensionId, options = {}) {
  const cli = cursorCliPath(appDir);
  if (!fs.existsSync(cli)) throw new Error(`未找到 Cursor CLI: ${cli}`);
  const r = cp.spawnSync(`"${cli}"`, [action, extensionId], {
    encoding: 'utf8',
    shell: true,
    timeout: options.timeout || 180000,
  });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  if (out) log(out);
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`Cursor CLI 执行失败 (${action} ${extensionId}), exit ${r.status}`);
}

function stopCursor() {
  if (process.platform !== 'win32') return;
  cp.spawnSync('taskkill.exe', ['/IM', 'Cursor.exe', '/F'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000,
  });
  const check = cp.spawnSync('tasklist.exe', ['/FI', 'IMAGENAME eq Cursor.exe', '/NH', '/FO', 'CSV'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10000,
  });
  if (check.error || check.status !== 0) {
    throw new Error(`无法确认 Cursor.exe 是否已退出: ${(check.error && check.error.message) || check.stderr || check.status}`);
  }
  if (/"Cursor\.exe"/i.test(check.stdout || '')) {
    throw new Error('Cursor.exe 仍在运行, 无法安全修改文件. 请手动完全退出后重试');
  }
}

function invocationUserState(profile) {
  const target = argvPath();
  return {
    argv: {
      target,
      existed: fs.existsSync(target),
      raw: fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null,
    },
    languagePackExisted: Boolean(findLanguagePack(profile.languagePackId)),
  };
}

function restoreInvocationUserState(appDir, profile, state) {
  const errors = [];
  try {
    if (state.argv.existed) atomicWriteFile(state.argv.target, state.argv.raw);
    else commitFiles([{ target: state.argv.target, remove: true }]);
  } catch (error) {
    errors.push(`argv.json: ${error.message}`);
  }
  if (!state.languagePackExisted && findLanguagePack(profile.languagePackId)) {
    try {
      runCursorExtensionCommand(appDir, '--uninstall-extension', profile.languagePackId);
    } catch (error) {
      errors.push(`语言包: ${error.message}`);
    }
  }
  if (errors.length) throw new Error(errors.join('; '));
}

function configureLanguage(appDir, profile) {
  if (!findLanguagePack(profile.languagePackId)) {
    log(`正在安装官方中文语言包 ${profile.languagePackId} ...`);
    runCursorExtensionCommand(appDir, '--install-extension', profile.languagePackId);
    if (!findLanguagePack(profile.languagePackId)) {
      throw new Error(`Cursor CLI 返回成功, 但未找到已安装语言包: ${profile.languagePackId}`);
    }
  }

  const target = argvPath();
  const raw = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '{\n}';
  parseArgvJsonc(raw);
  atomicWriteFile(target, setLocaleInArgv(raw, profile.locale));
  log(`已设置 locale = ${profile.locale} (${target})`);
}

function loadPatchContext(profile) {
  const appDir = locateApp();
  const product = readProduct(appDir);
  log(`Cursor ${product.version} (${(product.commit || '').slice(0, 8)}) @ ${appDir}`);
  log(`目标语言: ${profile.name} (${profile.locale})`);

  const dicts = loadDicts(DICT_DIR, { profile });
  for (const w of dicts.warnings) log(`[词典警告] ${w}`);
  if (!dicts.code.size && !Object.keys(dicts.nls).length) {
    throw new Error('词典为空: dict/ 下没有可用条目');
  }
  log(`词典: 代码层 ${dicts.code.size} 条, nls 层 ${Object.keys(dicts.nls).length} 条`);

  const targets = existingTargets(appDir);
  if (!targets.length) {
    throw new Error('未找到任何可补丁的工作台入口包 (out/vs/workbench/workbench.*.js, out/main.js). 该 Cursor 版本可能不被支持, 或安装目录损坏.');
  }
  const backupRels = [...targets, NLS_MESSAGES, NLS_KEYS, PRODUCT_JSON];
  const bdir = backupDir(ROOT, product.version);
  const guardTranslations = backupGuardTranslations();
  const backupIssues = validateBackupSources(appDir, backupRels, bdir, product, { translations: guardTranslations });
  if (backupIssues.length) throw new Error(formatBackupSourceIssues(backupIssues, product.version));
  return { appDir, backupRels, bdir, dicts, guardTranslations, product, profile, targets };
}

function sourcePath(ctx, rel) {
  const backup = backupFilePath(ctx.bdir, rel);
  return fs.existsSync(backup) ? backup : path.join(ctx.appDir, rel);
}

function buildPatchPlan(ctx) {
  const entries = [];
  const codeFiles = new Map();
  const hit = new Set();
  const report = {
    version: ctx.product.version,
    commit: ctx.product.commit || null,
    locale: ctx.profile.locale,
    language: ctx.profile.name,
    appliedAt: new Date().toISOString(),
    files: {},
    misses: [],
  };

  for (const rel of ctx.targets) {
    const src = fs.readFileSync(sourcePath(ctx, rel), 'utf8');
    const { text, counts, total } = applyToText(src, ctx.dicts.code);
    syntaxCheck(text, rel);
    for (const en of counts.keys()) hit.add(en);
    report.files[rel] = total;
    codeFiles.set(rel, text);
    entries.push({ target: path.join(ctx.appDir, rel), data: text });
  }

  let nls = null;
  const backupKeys = backupFilePath(ctx.bdir, NLS_KEYS);
  const backupMessages = backupFilePath(ctx.bdir, NLS_MESSAGES);
  const liveKeys = path.join(ctx.appDir, NLS_KEYS);
  const liveMessages = path.join(ctx.appDir, NLS_MESSAGES);
  const hasBackupNls = fs.existsSync(backupKeys) && fs.existsSync(backupMessages);
  const keysPath = hasBackupNls ? backupKeys : liveKeys;
  const messagesPath = hasBackupNls ? backupMessages : liveMessages;
  if (fs.existsSync(keysPath) && fs.existsSync(messagesPath)) {
    nls = buildPatchedNls(ctx.appDir, messagesPath, ctx.dicts.nls, {
      keysPath,
      profile: ctx.profile,
      homeDir: ctx.homeDir,
    });
    report.files[NLS_MESSAGES] = {
      languagePack: nls.langPackCount,
      languagePackPlaceholderSkipped: nls.langPackPlaceholderSkipped,
      cursorDict: nls.count,
    };
    entries.push({ target: path.join(ctx.appDir, NLS_MESSAGES), data: nls.text });
  }

  const productRaw = fs.readFileSync(sourcePath(ctx, PRODUCT_JSON), 'utf8');
  const product = buildUpdatedProduct(productRaw, codeFiles);
  entries.push({ target: path.join(ctx.appDir, PRODUCT_JSON), data: product.text });

  for (const en of ctx.dicts.code.keys()) if (!hit.has(en)) report.misses.push(en);
  return { codeFiles, entries, nls, product, report };
}

function logPatchPlan(ctx, plan, prefix) {
  for (const rel of ctx.targets) {
    log(`${prefix}: ${rel} (替换 ${plan.report.files[rel]} 处)`);
  }
  if (!plan.nls) {
    log(`[nls 跳过] 当前 Cursor 版本无 ${NLS_KEYS} 或 ${NLS_MESSAGES}`);
  } else {
    if (plan.nls.langPackDir) {
      const fallback = plan.nls.usedFallbackLanguagePack ? ', fallback 后转换' : '';
      log(`官方中文语言包: ${path.basename(plan.nls.langPackDir)} (${plan.nls.langPackId}${fallback}, 替换 ${plan.nls.langPackCount} 条)`);
    } else {
      log(`[nls 警告] 未找到官方中文语言包 ${ctx.profile.languagePackId}`);
    }
    if (plan.nls.langPackPlaceholderSkipped > 0) {
      log(`[nls 警告] 官方语言包占位符不一致, 已跳过 ${plan.nls.langPackPlaceholderSkipped} 条`);
    }
    log(`${prefix}: ${NLS_MESSAGES} (Cursor 专有替换 ${plan.nls.count} 条)`);
    for (const item of plan.nls.ambiguousSkipped || []) log(`[nls 跳过] 歧义 key: ${item.id}`);
    for (const key of plan.nls.unknown) log(`[nls 警告] 找不到 key: ${key}`);
  }
  log(`checksums: ${plan.product.updated.join(', ') || '(无)'}`);
}

function ensurePatchBackup(ctx) {
  const issues = validateBackupSources(ctx.appDir, ctx.backupRels, ctx.bdir, ctx.product, {
    translations: ctx.guardTranslations,
  });
  if (issues.length) throw new Error(formatBackupSourceIssues(issues, ctx.product.version));
  const warns = ensureBackup(ctx.appDir, ctx.backupRels, ctx.bdir, ctx.product);
  for (const w of warns) log(`[备份警告] ${w}`);
  log(`备份就绪: ${path.relative(ROOT, ctx.bdir)}`);
}

function preflight(ctx) {
  const plan = buildPatchPlan(ctx);
  logPatchPlan(ctx, plan, '语法预检通过');
  return plan;
}

function commitPatchPlan(ctx, plan) {
  commitFiles(plan.entries);
  logPatchPlan(ctx, plan, '已打补丁');
  try {
    if (clearClpCache()) log('已清除语言包缓存 (clp), 首次启动会自动重建');
  } catch (error) {
    log(`[缓存警告] ${error.message}`);
  }
  try {
    ensureDir(BUILD_DIR);
    const reportPath = path.join(BUILD_DIR, 'apply-report.json');
    atomicWriteFile(reportPath, JSON.stringify(plan.report, null, 2));
    log(`未命中词条 ${plan.report.misses.length} 个, 报告: ${path.relative(ROOT, reportPath)}`);
  } catch (error) {
    log(`[报告警告] ${error.message}`);
  }
}

function cmdApply() {
  const ctx = loadPatchContext(selectedProfile());
  preflight(ctx);
  stopCursor();
  ensurePatchBackup(ctx);
  commitPatchPlan(ctx, buildPatchPlan(ctx));
  log('完成. 重新打开 Cursor 后生效.');
}

function cmdInstall() {
  const ctx = loadPatchContext(selectedProfile());
  preflight(ctx);
  stopCursor();
  ensurePatchBackup(ctx);

  const stateFile = installStatePath(ctx.bdir);
  const stateExisted = fs.existsSync(stateFile);
  const previousState = stateExisted ? fs.readFileSync(stateFile) : null;
  captureInstallState(ctx.bdir, ctx.profile);
  const invocationState = invocationUserState(ctx.profile);
  try {
    configureLanguage(ctx.appDir, ctx.profile);
    commitPatchPlan(ctx, buildPatchPlan(ctx));
  } catch (error) {
    let rollbackError = null;
    try {
      restoreInvocationUserState(ctx.appDir, ctx.profile, invocationState);
    } catch (stateError) {
      rollbackError = stateError;
    }
    if (!rollbackError) {
      if (stateExisted) atomicWriteFile(stateFile, previousState);
      else fs.rmSync(stateFile, { force: true });
    }
    if (rollbackError) {
      throw new Error(`${error.message}; 用户状态回滚失败: ${rollbackError.message}. 安装状态文件已保留, 可再次执行 restore 清理`);
    }
    throw error;
  }
  log('安装完成. 重新打开 Cursor 后生效.');
}

function cmdRestore() {
  const appDir = locateApp();
  const product = readProduct(appDir);
  const bdir = backupDir(ROOT, product.version);
  const files = listBackupFiles(bdir);
  if (!files.length) throw new Error(`没有版本 ${product.version} 的备份, 无法还原`);
  const backupFileIssues = validateBackupFiles(bdir, files, {
    product,
    translations: backupGuardTranslations(),
  });
  if (backupFileIssues.length) throw new Error(formatBackupFileIssues(backupFileIssues, product.version));
  const stateFile = installStatePath(bdir);
  const state = fs.existsSync(stateFile) ? loadInstallState(bdir) : null;
  const entries = files.map((rel) => ({
    target: path.join(appDir, rel),
    data: fs.readFileSync(backupFilePath(bdir, rel)),
  }));
  if (state) entries.push(buildArgvRestoreEntry(state));

  stopCursor();
  commitFiles(entries);

  if (state) {
    for (const [id, packState] of Object.entries(state.languagePacks)) {
      if (!packState.existed && findLanguagePack(id)) {
        try {
          runCursorExtensionCommand(appDir, '--uninstall-extension', id);
          if (findLanguagePack(id)) {
            throw new Error(`Cursor CLI 返回成功, 但语言包仍存在: ${id}`);
          }
        } catch (error) {
          throw new Error(`资源文件和 locale 已恢复, 但语言包卸载失败: ${error.message}`);
        }
      }
    }
    fs.rmSync(stateFile, { force: true });
  } else {
    log('[状态提示] 当前备份没有安装状态文件, 仅恢复 Cursor 资源文件, 保留现有 locale 和语言包.');
  }
  try { clearClpCache(); } catch (error) { log(`[缓存警告] ${error.message}`); }
  log(`已还原 ${files.length} 个文件和安装前语言状态 (版本 ${product.version}). 重启 Cursor 生效.`);
}

function cmdStatus() {
  const profile = selectedProfile();
  const appDir = locateApp();
  const product = readProduct(appDir);
  log(`Cursor: ${product.version} (${(product.commit || '').slice(0, 8)})`);
  log(`安装目录: ${appDir}`);
  const bdir = backupDir(ROOT, product.version);
  log(`备份: ${fs.existsSync(bdir) ? path.relative(ROOT, bdir) : '无'}`);
  const dicts = loadDicts(DICT_DIR, { profile });
  log(`词典: 代码层 ${dicts.code.size} 条, nls 层 ${Object.keys(dicts.nls).length} 条`);
  for (const rel of existingTargets(appDir)) {
    const key = rel.replace(/^out\//, '');
    const expected = product.checksums && product.checksums[key];
    const state = !expected
      ? '(无官方 checksum)'
      : sha256b64(fs.readFileSync(path.join(appDir, rel))) === expected ? '原版' : '已修改';
    log(`  ${rel}: ${state}`);
  }
  const argvFile = path.join(os.homedir(), '.cursor', 'argv.json');
  let locale = '(未设置)';
  if (fs.existsSync(argvFile)) {
    const state = getLocaleState(fs.readFileSync(argvFile, 'utf8'));
    if (state.present) locale = String(state.value);
  }
  log(`显示语言 locale: ${locale}`);
  log(`目标语言: ${profile.name} (${profile.locale})`);
  log(`官方中文语言包: ${profile.languagePackId} ${findLanguagePack(profile.languagePackId) ? '已安装' : '未安装 (npm run lang 可安装)'}`);
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
  if (process.argv.includes('--dict-only')) return cmdDictCheck();
  const ctx = loadPatchContext(selectedProfile());
  preflight(ctx);
}

function cmdDictCheck() {
  const profile = selectedProfile();
  const dicts = loadDicts(DICT_DIR, { profile });
  for (const w of dicts.warnings) log(`[词典警告] ${w}`);
  if (!dicts.code.size && !Object.keys(dicts.nls).length) {
    throw new Error('词典为空: dict/ 下没有可用条目');
  }
  log(`词典校验通过: ${profile.name} (${profile.locale}), 代码层 ${dicts.code.size} 条, nls 层 ${Object.keys(dicts.nls).length} 条`);
}

function cmdLang() {
  const profile = selectedProfile();
  const appDir = locateApp();
  const state = invocationUserState(profile);
  try {
    configureLanguage(appDir, profile);
  } catch (error) {
    restoreInvocationUserState(appDir, profile, state);
    throw error;
  }
}

const commands = {
  apply: cmdApply,
  install: cmdInstall,
  restore: cmdRestore,
  status: cmdStatus,
  locate: cmdLocate,
  scan: cmdScan,
  lang: cmdLang,
  check: cmdCheck,
  'dict-check': cmdDictCheck,
};
function printUsage() {
  log('用法: node src/cli.js <install|apply|restore|status|locate|scan|lang|check|dict-check> [--locale zh-cn|zh-tw]');
  log('  install 一键预检, 安装语言包并事务化应用汉化');
  log('  apply   打汉化补丁 (自动备份原文件, 可重复执行)');
  log('  restore 还原为原版文件');
  log('  status  查看安装/补丁/语言状态');
  log('  locate  显示 Cursor 安装目录自动探测结果');
  log('  scan    提取候选字符串到 build/ (维护词典用)');
  log('  lang    设置 locale 并安装对应官方中文语言包 (VS Code 基础界面)');
  log('  check   严格校验词典, 本机 Cursor 和补丁后语法, 不修改 Cursor');
  log('  dict-check 仅校验词典 (CI 使用)');
  log('  --locale zh-cn|zh-tw  选择简体中文或繁體中文, 默认 zh-cn');
}

function main() {
  const cmd = process.argv[2];
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    printUsage();
    return 0;
  }
  if (!commands[cmd]) {
    printUsage();
    return 1;
  }
  try {
    commands[cmd]();
    return 0;
  } catch (e) {
    console.error(`[错误] ${e.message}`);
    return 1;
  }
}

if (require.main === module) process.exit(main());

module.exports = {
  buildPatchPlan,
  buildUpdatedProduct,
  commitPatchPlan,
  loadPatchContext,
  main,
  preflight,
};
