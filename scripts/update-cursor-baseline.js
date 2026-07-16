#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1] || fallback;
  return fallback;
}

function repoPath(value) {
  return path.isAbsolute(value) ? value : path.join(ROOT, value);
}

const releasePath = repoPath(option('--release', 'build/cursor-release.json'));
const reportPath = repoPath(option('--report', 'build/cursor-compat-zh-cn.json'));
const outputPath = repoPath(option('--output', 'compat/cursor-stable.json'));
const current = fs.existsSync(outputPath) ? JSON.parse(fs.readFileSync(outputPath, 'utf8')) : {};
const release = JSON.parse(fs.readFileSync(releasePath, 'utf8'));
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

if (!report.evaluation || !report.evaluation.passed) {
  throw new Error('兼容性报告未通过, 禁止更新稳定版基线');
}
if (report.cursor.version !== release.version || report.cursor.commit !== release.commit) {
  throw new Error('兼容性报告与官方版本元数据不一致');
}

const metrics = report.evaluation.metrics;
const record = {
  schema: 1,
  channel: release.channel,
  platform: release.platform,
  version: release.version,
  commit: release.commit,
  validatedAt: report.generatedAt,
  metrics: {
    codeReplacements: metrics.codeReplacements,
    workbenchBundles: metrics.workbenchBundles,
    accountUsageBundles: metrics.accountUsageBundles,
    cursorNlsReplacements: metrics.cursorNlsReplacements,
  },
  gates: current.gates || {
    minCodeReplacementRatio: 0.7,
    minWorkbenchBundles: 1,
    minAccountUsageBundles: 1,
    minCursorNlsReplacements: 120,
  },
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`);
console.log(`已记录 Cursor ${record.version} 兼容性基线: ${path.relative(ROOT, outputPath)}`);
