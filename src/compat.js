'use strict';

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function evaluateCompatibility(patchReport, baseline) {
  const files = patchReport && patchReport.files && typeof patchReport.files === 'object'
    ? patchReport.files
    : {};
  const gates = baseline && baseline.gates && typeof baseline.gates === 'object'
    ? baseline.gates
    : {};
  const baselineMetrics = baseline && baseline.metrics && typeof baseline.metrics === 'object'
    ? baseline.metrics
    : {};

  const codeFiles = Object.entries(files).filter(([, value]) => typeof value === 'number');
  const codeReplacements = codeFiles.reduce((sum, [, value]) => sum + value, 0);
  const workbenchBundles = codeFiles.filter(([name]) => /^out\/vs\/workbench\/workbench\..+\.js$/.test(name)).length;
  const accountUsageBundles = Array.isArray(patchReport && patchReport.accountUsageEmbedded)
    ? patchReport.accountUsageEmbedded.length
    : 0;
  const nls = files['out/nls.messages.json'];
  const cursorNlsReplacements = nls && typeof nls === 'object'
    ? finiteNumber(nls.cursorDict)
    : 0;
  const baselineCodeReplacements = finiteNumber(baselineMetrics.codeReplacements);
  const codeReplacementRatio = baselineCodeReplacements > 0
    ? codeReplacements / baselineCodeReplacements
    : 1;

  const metrics = {
    codeReplacements,
    workbenchBundles,
    accountUsageBundles,
    cursorNlsReplacements,
    codeReplacementRatio,
  };
  const errors = [];

  const minCodeReplacementRatio = finiteNumber(gates.minCodeReplacementRatio, 0.7);
  const minWorkbenchBundles = finiteNumber(gates.minWorkbenchBundles, 1);
  const minAccountUsageBundles = finiteNumber(gates.minAccountUsageBundles, 1);
  const minCursorNlsReplacements = finiteNumber(gates.minCursorNlsReplacements, 1);

  if (codeReplacementRatio < minCodeReplacementRatio) {
    errors.push(`代码替换量只有基线的 ${(codeReplacementRatio * 100).toFixed(1)}%, 低于 ${(minCodeReplacementRatio * 100).toFixed(1)}%`);
  }
  if (workbenchBundles < minWorkbenchBundles) {
    errors.push(`工作台入口包仅 ${workbenchBundles} 个, 少于要求的 ${minWorkbenchBundles} 个`);
  }
  if (accountUsageBundles < minAccountUsageBundles) {
    errors.push(`Cursor 账号用量入口仅嵌入 ${accountUsageBundles} 个包, 少于要求的 ${minAccountUsageBundles} 个`);
  }
  if (cursorNlsReplacements < minCursorNlsReplacements) {
    errors.push(`Cursor NLS 替换仅 ${cursorNlsReplacements} 条, 少于要求的 ${minCursorNlsReplacements} 条`);
  }

  return { passed: errors.length === 0, metrics, errors };
}

module.exports = { evaluateCompatibility };
