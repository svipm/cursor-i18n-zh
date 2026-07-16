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
const github = fs.readFileSync(
  path.join(root, 'desktop-sample', 'src-tauri', 'src', 'github.rs'),
  'utf8',
);
const desktopMain = fs.readFileSync(
  path.join(root, 'desktop-sample', 'src-tauri', 'src', 'main.rs'),
  'utf8',
);
const extensions = fs.readFileSync(
  path.join(root, 'desktop-sample', 'src-tauri', 'src', 'extensions.rs'),
  'utf8',
);
const extensionTargets = fs.readFileSync(
  path.join(root, 'desktop-sample', 'src-tauri', 'src', 'extensions', 'targets.rs'),
  'utf8',
);
const extensionHealth = fs.readFileSync(
  path.join(root, 'desktop-sample', 'src-tauri', 'src', 'extensions', 'health.rs'),
  'utf8',
);
const extensionHistory = fs.readFileSync(
  path.join(root, 'desktop-sample', 'src-tauri', 'src', 'extensions', 'history.rs'),
  'utf8',
);
const extensionSecurity = fs.readFileSync(
  path.join(root, 'desktop-sample', 'src-tauri', 'src', 'extensions', 'security.rs'),
  'utf8',
);
const extensionTransfer = fs.readFileSync(
  path.join(root, 'desktop-sample', 'src-tauri', 'src', 'extensions', 'transfer.rs'),
  'utf8',
);
const market = fs.readFileSync(
  path.join(root, 'desktop-sample', 'src-tauri', 'src', 'market.rs'),
  'utf8',
);
const release = fs.readFileSync(
  path.join(root, 'desktop-sample', 'src-tauri', 'src', 'release.rs'),
  'utf8',
);
const securityCheck = fs.readFileSync(path.join(root, 'scripts', 'security-check.js'), 'utf8');
const buildWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'build.yml'), 'utf8');
const cursorCompatWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'cursor-compat.yml'), 'utf8');

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
    'downloadUpdateButton',
    'updateDownloadProgress',
    'updateDownloadProgressText',
    'updateDownloadProgressValue',
    'updateDownloadProgressBar',
    'viewUpdateButton',
    'githubAvatar',
    'githubProjectsState',
    'githubProjectsGrid',
    'refreshProjectsButton',
    'reviewConsentButton',
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /github\.com\/svipm\/cursor-i18n-zh/);
  assert.match(html, /github\.com\/svipm\.png\?size=160/);
  assert.match(html, /不自动下载、不静默安装、不强制更新/);
  assert.match(script, /invoke\("check_for_updates"\)/);
  assert.match(script, /invoke\("github_projects"\)/);
  assert.match(script, /invoke\("open_github_url"/);
  assert.match(script, /invoke\("open_project_page"/);
  assert.match(script, /function renderGitHubProjects\(/);
  assert.match(script, /dataset\.projectUrl = project\.htmlUrl/);
  assert.match(script, /前往 Star/);
  assert.match(script, /登录后点击右上角 Star/);
  assert.match(script, /content\.classList\.toggle\("about-mode", aboutMode\)/);
  assert.match(styles, /\.content:not\(\.about-mode\) > #about/);
  assert.match(styles, /\.content\.about-mode > :not\(#about\)/);
  assert.match(styles, /\.github-project-grid/);
  assert.match(styles, /\.github-project-card/);
  assert.match(styles, /\.project-star-button/);
});

test('desktop GitHub project feed is public, sorted and URL restricted', () => {
  assert.match(github, /api\.github\.com\/users\/svipm\/repos/);
  assert.match(github, /right\s*\.stars\s*\.cmp\(&left\.stars\)/);
  assert.match(github, /!repository\.fork/);
  assert.match(github, /!repository\.archived/);
  assert.match(github, /projects\.truncate\(MAX_PROJECTS\)/);
  assert.match(github, /https:\/\/github\.com\/svipm\//);
  assert.match(desktopMain, /async fn github_projects\(/);
  assert.match(desktopMain, /fn open_github_url\(/);
  assert.match(desktopMain, /github::is_safe_project_url\(&url\)/);
  assert.doesNotMatch(`${html}\n${script}\n${github}`, /github[_-]?token/i);
});

test('desktop UI manages Cursor and Claude Code MCP, Skills, prompts and market', () => {
  for (const id of [
    'extensions',
    'extensionWorkspaceControl',
    'extensionMcpList',
    'extensionSkillList',
    'extensionPromptList',
    'extensionMarketList',
    'extensionHistoryList',
    'extensionTransferPanel',
    'extensionTargetMeta',
    'extensionActivityBanner',
    'addMcpButton',
    'addSkillButton',
    'addPromptButton',
    'refreshMarketButton',
    'checkAllMcpButton',
    'refreshExtensionHistoryButton',
    'previewExtensionCopyButton',
    'chooseExtensionImportButton',
    'previewSelectedImportButton',
    'extensionExportPassword',
    'extensionExportPasswordConfirm',
    'extensionImportPassword',
    'mcpEditorBackdrop',
    'skillEditorBackdrop',
    'promptEditorBackdrop',
    'mcpEnvInput',
    'mcpHeadersInput',
    'skillContentInput',
    'promptContentInput',
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  for (const command of [
    'extension_inventory',
    'extension_mcp_details',
    'extension_save_mcp',
    'extension_toggle_mcp',
    'extension_delete_mcp',
    'extension_skill_details',
    'extension_save_skill',
    'extension_toggle_skill',
    'extension_delete_skill',
    'extension_prompt_details',
    'extension_save_prompt',
    'extension_toggle_prompt',
    'extension_delete_prompt',
    'extension_market',
    'extension_install_market_item',
    'extension_targets',
    'extension_check_mcp',
    'extension_history',
    'extension_restore_history',
    'extension_export_bundle',
    'extension_preview_import',
    'extension_import_bundle',
    'extension_preview_copy',
    'extension_copy',
    'extension_batch_toggle',
    'choose_extension_bundle_path',
    'choose_extension_workspace',
  ]) {
    assert.match(script, new RegExp(`invoke\\("${command}"`));
    assert.match(desktopMain, new RegExp(command));
  }
  assert.match(script, /content\.classList\.toggle\("extensions-mode", extensionMode\)/);
  assert.match(script, /••••••/);
  assert.match(styles, /\.extension-item-card/);
  assert.match(styles, /\.extension-editor-modal/);
  assert.match(extensionTargets, /home\.join\("\.cursor\/mcp\.json"\)/);
  assert.match(extensionTargets, /home\.join\("\.claude\.json"\)/);
  assert.match(extensionTargets, /workspace\.join\("\.mcp\.json"\)/);
  assert.match(extensionTargets, /home\.join\("\.cursor\/skills-cursor"\)/);
  assert.match(extensionTargets, /home\.join\("\.cursor\/rules"\)/);
  assert.match(extensionTargets, /home\.join\("\.claude\/rules"\)/);
  assert.match(extensions, /REDACTED_VALUE/);
  assert.match(extensionHealth, /"method": "initialize"/);
  assert.match(extensionHistory, /MAX_HISTORY_RECORDS/);
  assert.match(extensionHistory, /restore_snapshot/);
  assert.match(extensionSecurity, /missing_markdown_references/);
  assert.match(extensionSecurity, /has_shell_commands/);
  assert.match(extensionTransfer, /MAX_BUNDLE_BYTES/);
  assert.match(extensionTransfer, /set_private_permissions/);
  assert.match(extensionTransfer, /Argon2id/);
  assert.match(extensionTransfer, /Aes256Gcm/);
  assert.match(extensionTransfer, /ENCRYPTED_AAD/);
  assert.match(extensionTransfer, /\.zeroize\(\)/);
  assert.match(extensionTransfer, /Zeroizing/);
  assert.match(extensionTransfer, /包含密钥的配置包必须使用密码加密导出/);
  assert.match(extensionTargets, /ExtensionTargetDescriptor/);
  assert.match(script, /loadExtensionTargets/);
  assert.match(extensions, /extension-registry/);
  assert.match(extensions, /install_skill_bundle/);
  assert.match(market, /MAX_TOTAL_BYTES/);
  assert.match(market, /fetch_repository_directory/);
  assert.match(market, /official.*verified.*community/);
  assert.match(market, /allow_overwrite_modified/);
  assert.match(market, /install_market_mcp/);
  assert.match(extensions, /install_market_skill_bundle/);
  assert.match(extensions, /install_market_prompt_with_origin/);
  assert.match(cargo, /windows-sys/);
  assert.match(market, /api\.github\.com\/repos\/\{slug\}\/commits/);
  assert.match(market, /raw\.githubusercontent\.com/);
  assert.match(buildWorkflow, /runs-on: macos-14/);
  assert.match(buildWorkflow, /package-macos\.sh/);
  assert.match(desktopMain, /target_os = "macos"/);
});

test('desktop release flow downloads verified optional updates and scans publish artifacts', () => {
  assert.match(script, /invoke\("download_latest_update"\)/);
  assert.match(script, /invoke\("open_downloaded_update"/);
  assert.match(desktopMain, /async fn download_latest_update\(/);
  assert.match(release, /SHA256SUMS-macos\.txt/);
  assert.match(release, /with_config\(\)\s*\.limit/);
  assert.match(release, /fn download_file\(/);
  assert.match(release, /\[0_u8; 64 \* 1024\]/);
  assert.match(release, /fn sha256_file\(/);
  assert.match(release, /fn commit_download\(/);
  assert.match(release, /pub cached: bool/);
  assert.match(script, /result\.cached/);
  assert.match(script, /update-download-progress/);
  assert.match(script, /setUpdateDownloadProgress/);
  assert.match(script, /updateProgressHideTimer/);
  assert.match(script, /更新包已完成校验, 但无法打开所在目录/);
  assert.match(script, /requestedBrowserUpdateProgress/);
  assert.match(desktopMain, /UpdateDownloadProgress/);
  assert.match(desktopMain, /app\.emit\(\s*"update-download-progress"/);
  assert.match(release, /releases\/download\//);
  assert.match(securityCheck, /cursor-session/);
  assert.match(securityCheck, /screenshot-email/);
  assert.match(buildWorkflow, /Scan sensitive information/);
  assert.match(buildWorkflow, /WINDOWS_CERTIFICATE/);
  assert.match(buildWorkflow, /Get-AuthenticodeSignature/);
  assert.match(buildWorkflow, /actions\/cache\/restore@v4/);
  assert.match(buildWorkflow, /actions\/cache\/save@v4/);
});

test('desktop UI provides accessible focus, keyboard navigation and long-operation feedback', () => {
  assert.match(html, /id="extensionActivityBanner"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /data-extension-tab="mcp"[^>]*aria-selected="true"/);
  assert.match(html, /id="toast"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(script, /function setExtensionActivity\(/);
  assert.match(script, /setAttribute\("aria-busy", String\(active\)\)/);
  assert.match(script, /\["ArrowLeft", "ArrowRight", "Home", "End"\]/);
  assert.match(script, /event\.key !== "Escape"/);
  assert.match(script, /requestAnimationFrame\(\(\) => \$\("#mcpNameInput"\)\.focus\(\)\)/);
  assert.match(styles, /button:focus-visible/);
  assert.match(styles, /\.extension-activity-banner/);
  assert.match(styles, /\.extension-section\.is-busy/);
  assert.match(styles, /animation-duration: \.01ms !important/);
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
  assert.match(script, /if \(!browserPreviewSection\) await waitForFirstRunConsent\(\);\s*await refreshEnvironmentAndApps\(\);/);
  assert.match(script, /get\("preview"\)/);
  assert.match(script, /\["about", "extensions"\]\.includes\(requestedBrowserPreview\)/);
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
  assert.match(network, /pub fn with_retry/);
  assert.match(network, /500 \| 502 \| 503 \| 504/);
  assert.match(github, /network::with_retry/);
  assert.match(market, /network::with_retry/);
  assert.match(release, /network::with_retry/);
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
  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/);
  assert.equal(tauriConfig.version, packageJson.version);
  assert.ok(cargo.split(/\r?\n/).includes(`version = "${packageJson.version}"`));
  assert.ok(html.includes(`v${packageJson.version}`));
});

test('Cursor compatibility workflow bounds and cleans silent installer execution', () => {
  assert.match(cursorCompatWorkflow, /compatibility:\s*[\s\S]*?timeout-minutes:\s*45/);
  assert.match(cursorCompatWorkflow, /Download and install official Cursor build\s*\n\s*timeout-minutes:\s*15/);
  assert.match(cursorCompatWorkflow, /Start-Process[^\n]+-PassThru\s*$/m);
  assert.doesNotMatch(cursorCompatWorkflow, /Start-Process[^\n]+-Wait/);
  for (const flag of ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/NOICONS', '/CURRENTUSER']) {
    assert.ok(cursorCompatWorkflow.includes(`'${flag}'`));
  }
  assert.match(cursorCompatWorkflow, /"\/DIR=\$installRoot"/);
  assert.match(cursorCompatWorkflow, /"\/LOG=\$installerLog"/);
  assert.match(cursorCompatWorkflow, /Detected installed Cursor identity/);
  assert.match(cursorCompatWorkflow, /Get-Content[^\n]+\$installerLog -Tail 160/);
  assert.match(cursorCompatWorkflow, /\[DateTime\]::UtcNow\.AddMinutes\(12\)/);
  assert.match(cursorCompatWorkflow, /candidate\.version[^\n]+release\.version/);
  assert.match(cursorCompatWorkflow, /candidate\.commit[^\n]+release\.commit/);
  assert.match(cursorCompatWorkflow, /taskkill\.exe \/PID \$process\.Id \/T \/F/);
  assert.match(cursorCompatWorkflow, /needs\.compatibility\.result != 'success'/);
});
