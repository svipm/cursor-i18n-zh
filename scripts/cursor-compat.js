#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { loadPatchContext, preflight } = require('../src/cli');
const { evaluateCompatibility } = require('../src/compat');
const { getLanguageProfile } = require('../src/locale');
const { ensureDir } = require('../src/util');

const ROOT = path.resolve(__dirname, '..');

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1] || fallback;
  const prefix = `${name}=`;
  const item = process.argv.find((value) => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : fallback;
}

function resolveRepoPath(value) {
  return path.isAbsolute(value) ? value : path.join(ROOT, value);
}

function main() {
  const locale = option('--locale', 'zh-cn');
  const baselinePath = resolveRepoPath(option('--baseline', 'compat/cursor-stable.json'));
  const outputPath = resolveRepoPath(option('--output', `build/cursor-compat-${locale}.json`));
  const appDir = option('--app-dir', process.env.CURSOR_APP_DIR || '');
  if (appDir) process.env.CURSOR_APP_DIR = path.resolve(appDir);
  if (!fs.existsSync(baselinePath)) throw new Error(`缺少兼容性基线: ${baselinePath}`);

  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const ctx = loadPatchContext(getLanguageProfile(locale));
  const plan = preflight(ctx);
  const evaluation = evaluateCompatibility(plan.report, baseline);
  const result = {
    schema: 1,
    generatedAt: new Date().toISOString(),
    cursor: {
      version: ctx.product.version,
      commit: ctx.product.commit || null,
    },
    locale,
    baseline: {
      version: baseline.version,
      releaseCommit: baseline.releaseCommit || baseline.commit,
      commit: baseline.commit,
      metrics: baseline.metrics,
      gates: baseline.gates,
    },
    evaluation,
    patchReport: plan.report,
  };

  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`兼容性报告: ${path.relative(ROOT, outputPath)}`);
  console.log(`代码替换: ${evaluation.metrics.codeReplacements}, 工作台入口: ${evaluation.metrics.workbenchBundles}, 账号用量入口: ${evaluation.metrics.accountUsageBundles}, Cursor NLS: ${evaluation.metrics.cursorNlsReplacements}`);
  if (!evaluation.passed) throw new Error(`Cursor ${ctx.product.version} 未通过自动兼容门禁:\n- ${evaluation.errors.join('\n- ')}`);
  console.log(`Cursor ${ctx.product.version} (${String(ctx.product.commit || '').slice(0, 8)}) 自动兼容门禁通过.`);
}

// GitHub Actions 只把 workflow command 写进公开的 check-run annotation,
// 普通 stderr 需要仓库 admin 权限才能下载日志. 把门禁失败原因转成 annotation,
// 维护者无需登录下载日志就能看到具体是哪一项门禁未通过.
function escapeAnnotation(value) {
  return String(value)
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
}

try {
  main();
} catch (error) {
  console.error(`[错误] ${error.message}`);
  if (process.env.GITHUB_ACTIONS === 'true') {
    console.log(`::error title=Cursor compatibility gate::${escapeAnnotation(error.message)}`);
  }
  process.exitCode = 1;
}
