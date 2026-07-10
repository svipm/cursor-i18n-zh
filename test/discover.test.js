'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { discoverTargets } = require('../src/discover');

function makeAppDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-i18n-discover-'));
  const wb = path.join(root, 'out', 'vs', 'workbench');
  fs.mkdirSync(wb, { recursive: true });
  // 锚点目标: 显式列在 CODE_TARGETS 的文件, 即使为空也应出现 (顺序最前).
  fs.writeFileSync(path.join(wb, 'workbench.desktop.main.js'), 'x'.repeat(1024 * 1024));
  // 新版本未知入口包: 不在 CODE_TARGETS, 但体积达标, 应被自动发现.
  fs.writeFileSync(path.join(wb, 'workbench.somefuture.main.js'), 'y'.repeat(2 * 1024 * 1024));
  // 非入口小文件: 体积不达标, 必须跳过, 避免误伤.
  fs.writeFileSync(path.join(wb, 'workbench.tiny.js'), 'z'.repeat(200));
  // 不匹配 workbench.*.js 的文件, 必须跳过.
  fs.writeFileSync(path.join(wb, 'bootstrap.js'), 'b'.repeat(1024 * 1024));
  return root;
}

test('discoverTargets keeps anchors first and appends large bundles in sorted order', () => {
  const root = makeAppDir();
  try {
    const targets = discoverTargets(root);
    // 锚点 (glass, desktop, anysphere, main) 固定最前, 哪怕缺失也保留位置.
    assert.ok(targets.includes('out/vs/workbench/workbench.desktop.main.js'));
    assert.ok(targets.includes('out/vs/workbench/workbench.glass.main.js'));
    // 自动发现的新入口包被追加.
    assert.ok(targets.includes('out/vs/workbench/workbench.somefuture.main.js'));
    // 小文件与非 workbench.*.js 文件被排除.
    assert.ok(!targets.includes('out/vs/workbench/workbench.tiny.js'));
    assert.ok(!targets.includes('out/vs/workbench/bootstrap.js'));
    // 锚点顺序在前, 自动发现的按文件名排序追加.
    const desktopIdx = targets.indexOf('out/vs/workbench/workbench.desktop.main.js');
    const futureIdx = targets.indexOf('out/vs/workbench/workbench.somefuture.main.js');
    assert.ok(desktopIdx < futureIdx);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('discoverTargets does not duplicate anchors that also exist on disk', () => {
  const root = makeAppDir();
  try {
    const targets = discoverTargets(root);
    const desktopCount = targets.filter((t) => t === 'out/vs/workbench/workbench.desktop.main.js').length;
    assert.equal(desktopCount, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('discoverTargets tolerates missing workbench directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-i18n-empty-'));
  try {
    const targets = discoverTargets(root);
    // 目录不存在时仅返回锚点列表, 不抛错.
    assert.deepEqual(targets, [
      'out/vs/workbench/workbench.glass.main.js',
      'out/vs/workbench/workbench.desktop.main.js',
      'out/vs/workbench/workbench.anysphere-ui-automations.js',
      'out/main.js',
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
