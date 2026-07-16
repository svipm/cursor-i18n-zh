'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const updater = path.join(root, 'scripts', 'update-cursor-baseline.js');

test('records a validated Cursor compatibility report as the next baseline', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-compat-baseline-'));
  const releasePath = path.join(dir, 'release.json');
  const reportPath = path.join(dir, 'report.json');
  const outputPath = path.join(dir, 'baseline.json');
  try {
    fs.writeFileSync(releasePath, JSON.stringify({
      channel: 'stable',
      platform: 'win32-x64-user',
      version: '2.0.0',
      commit: '2222222222222222222222222222222222222222',
    }));
    fs.writeFileSync(reportPath, JSON.stringify({
      generatedAt: '2026-07-16T00:00:00.000Z',
      cursor: {
        version: '2.0.0',
        commit: '2222222222222222222222222222222222222222',
      },
      evaluation: {
        passed: true,
        metrics: {
          codeReplacements: 900,
          workbenchBundles: 2,
          accountUsageBundles: 1,
          cursorNlsReplacements: 130,
        },
      },
    }));

    const result = cp.spawnSync(process.execPath, [
      updater,
      '--release', releasePath,
      '--report', reportPath,
      '--output', outputPath,
    ], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const baseline = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    assert.equal(baseline.version, '2.0.0');
    assert.equal(baseline.releaseCommit, '2222222222222222222222222222222222222222');
    assert.equal(baseline.commit, '2222222222222222222222222222222222222222');
    assert.equal(baseline.metrics.codeReplacements, 900);
    assert.equal(baseline.gates.minCodeReplacementRatio, 0.7);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('records distinct API and signed installer commits without repeating release detection', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-compat-baseline-'));
  const releasePath = path.join(dir, 'release.json');
  const reportPath = path.join(dir, 'report.json');
  const outputPath = path.join(dir, 'baseline.json');
  try {
    fs.writeFileSync(releasePath, JSON.stringify({
      channel: 'stable',
      platform: 'win32-x64-user',
      version: '3.12.10',
      commit: '24a12dbd9cabf48956ce5bb3dbd234e41385b3df',
    }));
    fs.writeFileSync(reportPath, JSON.stringify({
      generatedAt: '2026-07-16T00:00:00.000Z',
      cursor: {
        version: '3.12.10',
        commit: '24a12dbd9cabf48956ce5bb3dbd234e41385b3d0',
      },
      evaluation: {
        passed: true,
        metrics: {
          codeReplacements: 900,
          workbenchBundles: 2,
          accountUsageBundles: 1,
          cursorNlsReplacements: 130,
        },
      },
    }));

    const result = cp.spawnSync(process.execPath, [
      updater,
      '--release', releasePath,
      '--report', reportPath,
      '--output', outputPath,
    ], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const baseline = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    assert.equal(baseline.releaseCommit, '24a12dbd9cabf48956ce5bb3dbd234e41385b3df');
    assert.equal(baseline.commit, '24a12dbd9cabf48956ce5bb3dbd234e41385b3d0');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses to record a failed compatibility report', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-compat-baseline-'));
  const releasePath = path.join(dir, 'release.json');
  const reportPath = path.join(dir, 'report.json');
  const outputPath = path.join(dir, 'baseline.json');
  try {
    fs.writeFileSync(releasePath, JSON.stringify({ version: '2.0.0', commit: 'same' }));
    fs.writeFileSync(reportPath, JSON.stringify({
      cursor: { version: '2.0.0', commit: 'same' },
      evaluation: { passed: false, metrics: {} },
    }));

    const result = cp.spawnSync(process.execPath, [
      updater,
      '--release', releasePath,
      '--report', reportPath,
      '--output', outputPath,
    ], { cwd: root, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /禁止更新稳定版基线/);
    assert.equal(fs.existsSync(outputPath), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
