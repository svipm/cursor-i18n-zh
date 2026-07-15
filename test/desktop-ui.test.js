'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'desktop-sample', 'ui', 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'desktop-sample', 'ui', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'desktop-sample', 'ui', 'styles.css'), 'utf8');
const cargo = fs.readFileSync(path.join(root, 'desktop-sample', 'src-tauri', 'Cargo.toml'), 'utf8');
const network = fs.readFileSync(
  path.join(root, 'desktop-sample', 'src-tauri', 'src', 'network.rs'),
  'utf8',
);

test('desktop UI exposes usage and backup history controls', () => {
  for (const id of [
    'refreshUsageButton',
    'usageContent',
    'usageModelList',
    'backupHistoryList',
    'restoreConsentCheckbox',
    'backupRestoreProgress',
    'cursorCompatibility',
    'claudeCompatibility',
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(script, /invoke\("cursor_usage"\)/);
  assert.match(script, /invoke\("list_backups"\)/);
  assert.match(script, /backupVersion:\s*record\.version/);
  assert.match(script, /function runBackupRestore\(/);
  assert.match(script, /modalCompleted/);
  assert.match(script, /"完成"/);
  assert.match(script, /modalCompletedAction === "restore"/);
  assert.match(script, /app\.compatibilityMessage/);
  assert.match(script, /app\.autoCompatible === false/);
  const backupBody = script.slice(
    script.indexOf('async function runBackup(appId)'),
    script.indexOf('async function runBackupRestore(recordId)'),
  );
  const actionBody = script.slice(
    script.indexOf('async function runAction(action)'),
    script.indexOf('async function registerProgressListener()'),
  );
  assert.doesNotMatch(backupBody, /modalCompletedAction\s*=\s*action/);
  assert.match(actionBody, /modalCompletedAction\s*=\s*action/);
  assert.match(styles, /\.backup-history-row/);
  assert.match(styles, /\.usage-model-row/);
});

test('desktop UI exposes About, GitHub and optional update checks', () => {
  for (const id of [
    'about',
    'updateStatusCard',
    'updateState',
    'updateCurrentVersion',
    'updateLatestVersion',
    'checkUpdateButton',
    'viewUpdateButton',
    'githubAvatar',
    'reviewConsentButton',
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /github\.com\/svipm\/cursor-i18n-zh/);
  assert.match(html, /github\.com\/svipm\.png\?size=160/);
  assert.match(html, /不自动下载、不静默安装、不强制更新/);
  assert.match(script, /invoke\("check_for_updates"\)/);
  assert.match(script, /invoke\("open_project_page"/);
  assert.match(script, /content\.classList\.toggle\("about-mode", aboutMode\)/);
  assert.match(styles, /\.content:not\(\.about-mode\) > #about/);
  assert.match(styles, /\.content\.about-mode > :not\(#about\)/);
});

test('desktop UI gates first launch before local or network initialization', () => {
  for (const id of [
    'firstRunBackdrop',
    'firstRunTitle',
    'firstRunConsentCheckbox',
    'firstRunAcceptButton',
    'firstRunExitButton',
    'firstRunCloseButton',
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /软件声明/);
  assert.match(html, /隐私说明/);
  assert.match(script, /i18nWorkbench\.firstRunConsent\.v2/);
  assert.match(script, /await waitForFirstRunConsent\(\);\s*await refreshEnvironmentAndApps\(\);/);
  assert.ok(
    script.indexOf('await waitForFirstRunConsent();')
      < script.indexOf('await Promise.all([loadUsage(), loadUpdateStatus({ notify: true })]);'),
  );
});

test('desktop network uses the Windows trusted certificate chain', () => {
  assert.match(cargo, /"platform-verifier"/);
  assert.match(cargo, /"win-system-proxy"/);
  assert.match(network, /RootCerts::PlatformVerifier/);
  assert.doesNotMatch(network, /disable_verification\s*\(\s*true\s*\)/);
});

test('desktop UI exposes Node.js 18 runtime detection', () => {
  for (const id of [
    'nodeRuntimeCard',
    'nodeRuntimeState',
    'nodeRuntimeVersion',
    'nodeRuntimeRequired',
    'nodeRuntimePath',
    'nodeRuntimeRefreshButton',
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /仅 Cursor 汉化功能需要/);
  assert.match(html, /Node\.js 18\+/);
  assert.match(script, /invoke\("environment_status"\)/);
  assert.match(script, /function refreshEnvironmentAndApps\(/);
});

test('desktop frontend never receives or renders Cursor credentials', () => {
  const frontend = `${html}\n${script}\n${styles}`;
  assert.doesNotMatch(frontend, /accessToken/i);
  assert.doesNotMatch(frontend, /WorkosCursorSessionToken/i);
  assert.doesNotMatch(frontend, /Authorization\s*:/i);
});

test('desktop and package versions are synchronized', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const tauriConfig = JSON.parse(fs.readFileSync(
    path.join(root, 'desktop-sample', 'src-tauri', 'tauri.conf.json'),
    'utf8',
  ));
  assert.equal(packageJson.version, '0.3.6');
  assert.equal(tauriConfig.version, packageJson.version);
  assert.match(cargo, /^version = "0\.3\.6"$/m);
  assert.match(html, /v0\.3\.6/);
});
