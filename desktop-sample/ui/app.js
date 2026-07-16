const state = {
  apps: [],
  backups: [],
  usage: null,
  usageLoading: false,
  updateStatus: null,
  updateLoading: false,
  updateDownloading: false,
  updateDownloadPercent: 0,
  updateProgressHideTimer: null,
  githubProjects: [],
  githubProjectsLoading: false,
  githubProjectsLoaded: false,
  extensionTarget: "cursor",
  extensionTargets: [],
  extensionScope: "user",
  extensionWorkspace: "",
  extensionTab: "mcp",
  extensionInventory: null,
  extensionMcpHealth: {},
  extensionMarket: [],
  extensionHistory: [],
  extensionHistoryLoading: false,
  extensionTransferPreview: null,
  extensionTransferMode: "",
  extensionImportPath: "",
  extensionSelection: new Set(),
  extensionSearch: "",
  extensionStatusFilter: "all",
  extensionMarketLoading: false,
  extensionLoading: false,
  extensionRunning: false,
  environmentLoading: false,
  selectedApp: null,
  locale: "zh-cn",
  running: false,
  activeOperation: null,
  modalCompletedAction: null,
  firstRunRequired: false,
  firstRunResolve: null,
  environment: { isAdmin: false },
};

const FIRST_RUN_CONSENT_KEY = "i18nWorkbench.firstRunConsent.v2";
const EXTENSION_GUIDE_KEY = "i18nWorkbench.extensionGuide.v1";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const tauri = window.__TAURI__;
const invoke = tauri?.core?.invoke;
const listen = tauri?.event?.listen;
const appWindow = tauri?.window?.getCurrentWindow?.();
const requestedBrowserPreview = !invoke
  ? new URLSearchParams(window.location.search).get("preview")
  : null;
const requestedBrowserEditor = !invoke
  ? new URLSearchParams(window.location.search).get("editor")
  : null;
const requestedBrowserTab = !invoke
  ? new URLSearchParams(window.location.search).get("tab")
  : null;
const requestedBrowserUpdateProgress = !invoke
  ? new URLSearchParams(window.location.search).get("updateProgress")
  : null;
const browserPreviewSection = ["about", "extensions"].includes(requestedBrowserPreview)
  ? requestedBrowserPreview
  : null;

function timeNow() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

function normalizeError(error) {
  if (typeof error === "string") return error;
  if (error?.message) return error.message;
  return String(error);
}

function hasFirstRunConsent() {
  try {
    return window.localStorage.getItem(FIRST_RUN_CONSENT_KEY) === "accepted";
  } catch {
    return false;
  }
}

function saveFirstRunConsent() {
  try {
    window.localStorage.setItem(FIRST_RUN_CONSENT_KEY, "accepted");
    return true;
  } catch {
    return false;
  }
}

function showFirstRunDialog(required) {
  state.firstRunRequired = required;
  const checkbox = $("#firstRunConsentCheckbox");
  checkbox.checked = false;
  $("#firstRunConsentRow").hidden = !required;
  $("#firstRunExitButton").hidden = !required;
  $("#firstRunCloseButton").hidden = required;
  $("#firstRunTitle").textContent = required ? "首次使用须知" : "软件声明与隐私说明";
  const acceptButton = $("#firstRunAcceptButton");
  acceptButton.textContent = required ? "同意并进入" : "关闭";
  acceptButton.disabled = required;
  $("#firstRunBackdrop").classList.remove("hidden");
  window.requestAnimationFrame(() => (required ? checkbox : acceptButton).focus());
}

function closeFirstRunDialog() {
  if (state.firstRunRequired) return;
  $("#firstRunBackdrop").classList.add("hidden");
}

function waitForFirstRunConsent() {
  if (hasFirstRunConsent()) return Promise.resolve();
  return new Promise((resolve) => {
    state.firstRunResolve = resolve;
    showFirstRunDialog(true);
  });
}

function acceptFirstRunConsent() {
  if (!state.firstRunRequired) {
    closeFirstRunDialog();
    return;
  }
  if (!$("#firstRunConsentCheckbox").checked) return;
  if (!saveFirstRunConsent()) {
    addLog("WARN", "无法保存首次启动确认状态, 下次启动时将再次显示声明.");
  }
  state.firstRunRequired = false;
  $("#firstRunBackdrop").classList.add("hidden");
  const resolve = state.firstRunResolve;
  state.firstRunResolve = null;
  resolve?.();
}

function loadGitHubAvatar() {
  const avatar = $("#githubAvatar");
  if (avatar.dataset.loaded === "true") return;
  avatar.dataset.loaded = "true";
  avatar.src = avatar.dataset.src;
}

function addLog(level, message) {
  const normalized = level === "ERROR" ? "WARN" : level;
  const typeClass = normalized === "DONE" ? "log-ok" : normalized === "WARN" ? "log-warn" : "log-info";
  const line = document.createElement("div");
  line.className = "log-line";
  line.innerHTML = `<time>${timeNow()}</time><span class="${typeClass}">${normalized}</span><p></p>`;
  line.querySelector("p").textContent = message;
  $("#logArea").appendChild(line);
  $("#logArea").scrollTop = $("#logArea").scrollHeight;
}

let toastTimer;
function showToast(message, tone = "success") {
  const toast = $("#toast");
  $("#toastIcon").textContent = tone === "warning" ? "!" : "✓";
  toast.querySelector("p").textContent = message;
  toast.classList.toggle("warning", tone === "warning");
  toast.classList.remove("hidden");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.add("hidden"), 3600);
}

function browserFallbackApps() {
  return [
    {
      id: "cursor", name: "Cursor", installed: true, ready: true, path: "浏览器预览模式",
      version: "preview", state: "适配器可用", stateTone: "success", adapterVersion: "0.4.2",
      backupAvailable: true, backupPath: "浏览器预览模式\\backup\\preview", backupFiles: 7,
      backupMessage: "浏览器预览样例: 7 个文件已通过完整性校验", localized: false, reason: null,
      autoCompatible: true, compatibilityMessage: "已按资源结构自动适配未来 Cursor 版本, 安装前仍会执行完整语法预检",
      locales: [{ id: "zh-cn", label: "简体中文", tag: "zh-CN" }, { id: "zh-tw", label: "繁體中文", tag: "zh-TW" }],
    },
    {
      id: "claude", name: "Claude Desktop", installed: true, ready: true, path: "浏览器预览模式",
      version: "preview", state: "适配器可用", stateTone: "success", adapterVersion: "0.1.0",
      backupAvailable: true, backupPath: "浏览器预览模式\\backups\\claude\\preview\\original", backupFiles: 3,
      backupMessage: "浏览器预览样例: 3 个文件已通过完整性校验", localized: false, reason: null,
      autoCompatible: true, compatibilityMessage: "已按资源结构自动适配 Claude Desktop, 3 个 JSON 已通过结构校验",
      locales: [{ id: "zh-cn", label: "简体中文", tag: "zh-CN" }],
    },
  ];
}

function browserFallbackBackups() {
  const now = Math.floor(Date.now() / 1000);
  return [
    {
      id: "cursor:preview", appId: "cursor", appName: "Cursor", version: "preview",
      createdAtIso: new Date((now - 3600) * 1000).toISOString(), createdAtUnix: null,
      path: "浏览器预览模式\\backup\\preview", files: 7, valid: true, current: true,
      canRestore: true, status: "可恢复", detail: "完整性校验通过, 与当前安装版本匹配",
    },
    {
      id: "claude:preview", appId: "claude", appName: "Claude Desktop", version: "preview",
      createdAtIso: null, createdAtUnix: now - 7200,
      path: "浏览器预览模式\\backups\\claude\\preview\\original", files: 3, valid: true,
      current: true, canRestore: true, status: "可恢复", detail: "完整性校验通过, 与当前安装版本匹配",
    },
  ];
}

function browserFallbackUsage() {
  return {
    accountEmail: "preview@example.com",
    membershipType: "pro",
    planUsed: 128.5,
    planLimit: 500,
    planRemaining: 371.5,
    totalPercentUsed: 25.7,
    apiPercentUsed: 3.2,
    billingCycleStart: "2026-07-01T00:00:00Z",
    billingCycleEnd: "2026-08-01T00:00:00Z",
    requestTotal: 152,
    tokenTotal: 1284300,
    refreshedAtUnix: Math.floor(Date.now() / 1000),
    models: [
      { name: "claude-4-sonnet", requests: 96, requestLimit: 500, tokens: 876400 },
      { name: "gpt-5", requests: 56, requestLimit: 500, tokens: 407900 },
    ],
  };
}

function browserFallbackUpdateStatus() {
  return {
    currentVersion: "0.4.2",
    latestVersion: "0.4.2",
    updateAvailable: false,
    currentAhead: false,
    releaseUrl: "https://github.com/svipm/cursor-i18n-zh/releases",
    publishedAt: new Date().toISOString(),
    message: "浏览器预览样例: 当前 v0.4.2 已是最新版本",
  };
}

function browserFallbackGitHubProjects() {
  return [
    {
      name: "cursor-i18n-zh",
      fullName: "svipm/cursor-i18n-zh",
      description: "为 Cursor 和 Claude Desktop 提供安全备份, 汉化安装, 原版恢复和用量监控的桌面工作台.",
      htmlUrl: "https://github.com/svipm/cursor-i18n-zh",
      language: "JavaScript",
      stars: 13,
      forks: 2,
      topics: ["cursor", "localization", "tauri"],
      updatedAt: new Date().toISOString(),
    },
  ];
}

function browserFallbackExtensionInventory(query) {
  const cursor = query.target === "cursor";
  return {
    target: query.target,
    targetLabel: cursor ? "Cursor" : "Claude Code",
    scope: query.scope,
    workspace: query.workspace || null,
    mcpConfigPath: query.scope === "project"
      ? `${query.workspace}\\${cursor ? ".cursor\\mcp.json" : ".mcp.json"}`
      : cursor ? "C:\\Users\\demo\\.cursor\\mcp.json" : "C:\\Users\\demo\\.claude.json",
    skillRoot: query.scope === "project"
      ? `${query.workspace}\\${cursor ? ".cursor" : ".claude"}\\skills`
      : `C:\\Users\\demo\\.${cursor ? "cursor" : "claude"}\\skills`,
    promptRoot: query.scope === "project"
      ? `${query.workspace}\\${cursor ? ".cursor" : ".claude"}\\rules`
      : `C:\\Users\\demo\\.${cursor ? "cursor" : "claude"}\\rules`,
    activeMcpCount: 2,
    enabledSkillCount: 2,
    enabledPromptCount: cursor && query.scope === "user" ? 0 : 1,
    promptEditable: !(cursor && query.scope === "user"),
    capabilities: ["mcp", "skills", "health-check", "transfer", ...(!(cursor && query.scope === "user") ? ["prompts"] : [])],
    promptNote: cursor && query.scope === "user"
      ? "Cursor 全局 User Rules 只能在 Customize > Rules 中维护. 请选择项目级规则."
      : "当前范围支持文件化提示词规则.",
    note: query.scope === "project" ? "项目级配置仅作用于当前选择的工作区" : "用户级配置会作用于当前系统账号",
    mcpServers: [
      { name: "filesystem", transport: "stdio", endpoint: "npx", enabled: true, envKeys: ["ROOT_PATH"], headerKeys: [], argsCount: 2, source: query.scope === "project" ? "项目级" : "用户级", localModified: false },
      { name: "github", transport: "http", endpoint: "https://api.example.com/mcp", enabled: true, envKeys: [], headerKeys: ["Authorization"], argsCount: 0, source: query.scope === "project" ? "项目级" : "用户级", localModified: true },
      { name: "database", transport: "stdio", endpoint: "node", enabled: false, envKeys: ["DATABASE_URL"], headerKeys: [], argsCount: 1, source: query.scope === "project" ? "项目级" : "用户级", localModified: false },
    ],
    skills: [
      { id: "code-review", name: "code-review", description: "在用户要求代码审查和质量检查时使用.", enabled: true, builtIn: false, source: query.scope === "project" ? "项目级" : "用户级", path: "preview", localModified: false, audit: { riskLevel: "low", riskScore: 10, findings: [], fileCount: 3, sha256: "0123456789abcdef", trustedSource: true, hasScripts: false, hasNetworkAccess: false, hasShellCommands: false } },
      { id: "release-helper", name: "release-helper", description: "生成发布说明并检查版本一致性.", enabled: true, builtIn: false, source: query.scope === "project" ? "项目级" : "用户级", path: "preview", localModified: false, audit: { riskLevel: "medium", riskScore: 35, findings: ["包含 Shell 命令"], fileCount: 4, sha256: "fedcba9876543210", trustedSource: false, hasScripts: true, hasNetworkAccess: false, hasShellCommands: true } },
      ...(cursor && query.scope === "user" ? [{ id: "builtin-browser", name: "builtin-browser", description: "Cursor 内置 Skill 示例, 仅支持查看.", enabled: true, builtIn: true, source: "Cursor 内置", path: "preview" }] : []),
    ],
    prompts: cursor && query.scope === "user" ? [] : [
      { id: "engineering-quality", name: "engineering-quality", description: "工程质量和验证闭环规则.", enabled: true, source: query.scope === "project" ? "项目级" : "用户级", path: "preview", repository: "https://github.com/svipm/cursor-i18n-zh", revision: "preview", localModified: false },
    ],
  };
}

function browserFallbackMarket(query) {
  return [
    { id: "playwright-mcp", kind: "mcp", name: "playwright", title: "Playwright MCP", description: "让 Agent 操作浏览器.", repository: "https://github.com/microsoft/playwright-mcp", trust: "official", license: "Apache-2.0", installed: false, updateAvailable: false, localModified: false, status: "未安装" },
    { id: "anthropic-frontend-design", kind: "skill", name: "frontend-design", title: "Frontend Design", description: "Anthropic 官方前端设计 Skill.", repository: "https://github.com/anthropics/skills", trust: "official", license: "Apache-2.0", installed: false, updateAvailable: false, localModified: false, status: "未安装" },
    ...(query.target === "cursor"
      ? [{ id: "cursor-code-review-prompt", kind: "prompt", name: "code-review", title: "Cursor 代码审查规则", description: "根因优先的代码审查提示词.", repository: "https://github.com/svipm/cursor-i18n-zh", trust: "official", license: "MIT", installed: false, updateAvailable: false, localModified: false, status: "未安装" }]
      : [{ id: "claude-code-engineering-prompt", kind: "prompt", name: "engineering-quality", title: "Claude Code 工程质量规则", description: "工程质量和验证闭环提示词.", repository: "https://github.com/svipm/cursor-i18n-zh", trust: "official", license: "MIT", installed: true, updateAvailable: false, localModified: false, status: "已安装" }]),
  ];
}

function updateEnvironmentView() {
  const elevated = state.environment.isAdmin;
  const mac = state.environment.platform === "macos";
  $("#permissionCard").classList.toggle("elevated", elevated);
  $("#permissionTitle").textContent = elevated ? "管理员模式" : "标准权限";
  $("#permissionText").textContent = elevated
    ? (mac ? "可修改并重签名 Applications" : "可修改 WindowsApps")
    : "预检可用, Claude 安装需提权";
  const runtime = state.environment.nodeRuntime || {
    installed: Boolean(state.environment.nodeVersion),
    compatible: Boolean(state.environment.nodeVersion),
    version: state.environment.nodeVersion || null,
    executable: null,
    requiredVersion: ">=18",
    message: state.environment.nodeVersion
      ? `Node.js ${state.environment.nodeVersion} 已就绪`
      : "未检测到 Node.js. Cursor 汉化需要 Node.js 18 或更高版本",
  };
  const card = $("#nodeRuntimeCard");
  card.classList.remove("checking", "ready", "incompatible");
  card.classList.add(runtime.compatible ? "ready" : "incompatible");
  const statePill = $("#nodeRuntimeState");
  statePill.textContent = runtime.compatible ? "已就绪" : runtime.installed ? "版本过低" : "未安装";
  statePill.className = `pill ${runtime.compatible ? "success" : "warning"}`;
  $("#nodeRuntimeMessage").textContent = runtime.message;
  $("#nodeRuntimeVersion").textContent = runtime.version ? `v${runtime.version}` : "未检测到";
  $("#nodeRuntimeRequired").textContent = `Node.js ${String(runtime.requiredVersion || ">=18").replace(">=", "")}+`;
  $("#nodeRuntimePath").textContent = runtime.executable || "PATH 中未找到 node.exe";
  $("#nodeRuntimePath").title = runtime.executable || "";
  $("#engineHint").textContent = runtime.compatible
    ? `Cursor 引擎: Node.js ${runtime.version} 已就绪`
    : runtime.installed
      ? `Cursor 引擎: Node.js ${runtime.version || "未知"} 版本过低`
      : "Cursor 引擎: 未安装 Node.js 18+";
}

async function loadEnvironment() {
  if (state.environmentLoading) return;
  state.environmentLoading = true;
  const button = $("#nodeRuntimeRefreshButton");
  button.disabled = true;
  button.classList.add("scanning");
  $("#nodeRuntimeCard").className = "runtime-card checking";
  $("#nodeRuntimeState").textContent = "正在检测";
  $("#nodeRuntimeState").className = "pill neutral";
  $("#nodeRuntimeMessage").textContent = "正在检查 Node.js 安装状态和版本...";
  try {
    state.environment = invoke
      ? await invoke("environment_status")
      : {
          isAdmin: false,
          cursorEnginePath: "browser",
          dataDir: "browser",
          nodeRuntime: {
            installed: true,
            compatible: true,
            version: "preview",
            executable: "浏览器预览模式",
            requiredVersion: ">=18",
            message: "浏览器预览样例: Node.js 运行环境已就绪",
          },
        };
    updateEnvironmentView();
    updateBackupHistoryButtons();
  } catch (error) {
    const message = normalizeError(error);
    $("#nodeRuntimeCard").className = "runtime-card incompatible";
    $("#nodeRuntimeState").textContent = "检测失败";
    $("#nodeRuntimeState").className = "pill warning";
    $("#nodeRuntimeMessage").textContent = message;
    addLog("WARN", `环境检查失败: ${message}`);
  } finally {
    state.environmentLoading = false;
    button.disabled = false;
    button.classList.remove("scanning");
  }
}

async function refreshEnvironmentAndApps() {
  if (state.running || state.environmentLoading) return;
  await loadEnvironment();
  await scanApps();
}

function updateAppCard(app) {
  const card = $(`.app-card[data-app="${app.id}"]`);
  if (!card) return;
  const pill = $(`#${app.id}State`);
  const path = $(`#${app.id}InstallState`);
  const version = $(`#${app.id}Version`);
  const compatibility = $(`#${app.id}Compatibility`);
  const button = card.querySelector(".configure-button");

  pill.textContent = app.state;
  pill.className = `pill ${app.stateTone || (app.ready ? "success" : "warning")}`;
  path.textContent = app.path || app.reason || "本机未检测到";
  path.title = app.path || app.reason || "";
  version.textContent = `版本: ${app.version || "未知"}`;
  compatibility.textContent = app.compatibilityMessage || "尚未完成新版本兼容性检测";
  compatibility.title = app.compatibilityMessage || "";
  compatibility.classList.toggle("warning", app.autoCompatible === false);
  button.disabled = !app.ready;
  button.textContent = app.ready
    ? app.localized ? "汉化已完成 →" : "配置汉化 →"
    : app.installed && app.autoCompatible === false ? "结构待适配" : app.installed ? "环境未就绪" : "未检测到应用";
  card.classList.toggle("muted", !app.ready);
  card.classList.toggle("localized", Boolean(app.localized));
}

function updateBackupCard(app) {
  const card = $(`.backup-card[data-backup-app="${app.id}"]`);
  if (!card) return;
  const ready = Boolean(app.backupAvailable);
  const pill = $(`#${app.id}BackupState`);
  const path = $(`#${app.id}BackupPath`);
  const button = card.querySelector(".backup-action");

  pill.textContent = ready ? "已校验" : app.installed ? "必须备份" : "未安装";
  pill.className = `pill ${ready ? "success" : "warning"}`;
  $(`#${app.id}BackupVersion`).textContent = `版本: ${app.version || "未知"}`;
  $(`#${app.id}BackupFiles`).textContent = app.backupFiles || 0;
  $(`#${app.id}BackupMessage`).textContent = app.backupMessage || app.reason || "备份状态未知";
  path.textContent = app.backupPath || "--";
  path.title = app.backupPath || "";
  const existingBackup = ready || (app.backupMessage || "").startsWith("备份校验失败");
  button.textContent = existingBackup ? "重新校验备份" : "创建并校验备份";
  card.classList.toggle("ready", ready);
  card.classList.toggle("invalid", app.installed && !ready);
}

function updateBackupActionButtons() {
  const consent = $("#backupConsentCheckbox").checked;
  $$(".backup-action[data-backup-app]").forEach((button) => {
    const app = state.apps.find((item) => item.id === button.dataset.backupApp);
    button.disabled = state.running || !consent || !app?.ready;
  });
}

function formatNumber(value, maximumFractionDigits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits }).format(number);
}

function formatBackupTime(record) {
  const date = record.createdAtIso
    ? new Date(record.createdAtIso)
    : record.createdAtUnix
      ? new Date(record.createdAtUnix * 1000)
      : null;
  if (!date || Number.isNaN(date.getTime())) return "时间未记录";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(date);
}

function backupStatusTone(record) {
  if (!record.valid) return "invalid";
  return record.canRestore ? "restorable" : "historical";
}

function restoreBlockedReason(record) {
  if (!record.valid) return record.detail || "备份完整性校验失败";
  if (!record.current) return record.detail || "备份版本与当前软件版本不匹配";
  if (!state.environment.isAdmin && (record.appId === "claude" || state.environment.platform === "macos")) return "恢复应用资源需要管理员权限";
  if (!$("#restoreConsentCheckbox").checked) return "请先确认已保存工作并同意关闭目标应用";
  return "";
}

function updateBackupHistoryButtons() {
  $$("[data-restore-backup]").forEach((button) => {
    const record = state.backups.find((item) => item.id === button.dataset.restoreBackup);
    const blocked = record ? restoreBlockedReason(record) : "备份记录不存在";
    button.disabled = state.running || Boolean(blocked) || !record?.canRestore;
    button.title = state.running ? "当前有操作正在执行" : blocked;
  });
}

function renderBackupHistory() {
  const container = $("#backupHistoryList");
  container.replaceChildren();
  if (!state.backups.length) {
    const empty = document.createElement("div");
    empty.className = "empty-row";
    empty.textContent = "尚未发现备份记录. 请先为当前软件版本创建备份.";
    container.appendChild(empty);
    return;
  }

  for (const record of state.backups) {
    const row = document.createElement("article");
    row.className = `backup-history-row ${backupStatusTone(record)}`;
    row.title = record.path || record.detail || "";
    row.innerHTML = `
      <div class="backup-history-app">
        <span class="history-app-logo"></span>
        <div><strong></strong><small></small></div>
      </div>
      <div class="backup-history-time"><strong></strong><small>备份创建时间</small></div>
      <div class="backup-history-files"><strong></strong><small>完整文件</small></div>
      <div class="backup-history-state"><span class="history-state-pill"></span><small></small></div>
      <button class="history-restore-button" type="button">一键恢复</button>`;
    row.querySelector(".history-app-logo").textContent = record.appId === "claude" ? "AI" : "C";
    row.querySelector(".history-app-logo").classList.add(record.appId === "claude" ? "claude" : "cursor");
    row.querySelector(".backup-history-app strong").textContent = record.appName;
    row.querySelector(".backup-history-app small").textContent = `版本 ${record.version}`;
    row.querySelector(".backup-history-time strong").textContent = formatBackupTime(record);
    row.querySelector(".backup-history-files strong").textContent = `${record.files} 个`;
    row.querySelector(".history-state-pill").textContent = record.status;
    row.querySelector(".backup-history-state small").textContent = record.detail;
    const button = row.querySelector(".history-restore-button");
    button.dataset.restoreBackup = record.id;
    button.addEventListener("click", () => runBackupRestore(record.id));
    container.appendChild(row);
  }
  updateBackupHistoryButtons();
}

async function loadBackups() {
  const container = $("#backupHistoryList");
  container.classList.add("loading");
  try {
    state.backups = invoke ? await invoke("list_backups") : browserFallbackBackups();
    renderBackupHistory();
  } catch (error) {
    state.backups = [];
    container.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "empty-row error";
    empty.textContent = `备份列表读取失败: ${normalizeError(error)}`;
    container.appendChild(empty);
    addLog("WARN", empty.textContent);
  } finally {
    container.classList.remove("loading");
  }
}

function membershipLabel(value) {
  const labels = { free: "Free", pro: "Pro", business: "Business", ultra: "Ultra" };
  const normalized = String(value || "unknown").toLowerCase();
  return labels[normalized] || value || "未知套餐";
}

function formatCycleDate(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function renderUsage(usage) {
  state.usage = usage;
  $("#usageError").classList.add("hidden");
  $("#usageContent").classList.remove("loading");
  $("#usageMembership").textContent = membershipLabel(usage.membershipType);
  $("#usageAccount").textContent = usage.accountEmail || "Cursor 账户已登录";
  $("#usagePlanAmount").textContent = `${formatNumber(usage.planUsed, 2)} / ${formatNumber(usage.planLimit, 2)}`;
  $("#usageRemaining").textContent = `剩余 ${formatNumber(usage.planRemaining, 2)}`;
  $("#usageRequests").textContent = formatNumber(usage.requestTotal);
  $("#usageTokens").textContent = `Token ${formatNumber(usage.tokenTotal)}`;

  const percent = Math.max(0, Math.min(100, Number(usage.totalPercentUsed) || 0));
  $("#usagePercent").textContent = `${formatNumber(percent, 1)}%`;
  $("#usageMeterBar").style.width = `${percent}%`;
  $("#usageApiPercent").textContent = `API 用量 ${formatNumber(usage.apiPercentUsed, 1)}%`;
  $("#usageCycle").textContent = `${formatCycleDate(usage.billingCycleStart)} - ${formatCycleDate(usage.billingCycleEnd)}`;
  $("#usageRefreshedAt").textContent = `刷新于 ${formatBackupTime({ createdAtUnix: usage.refreshedAtUnix })}`;

  const models = Array.isArray(usage.models) ? usage.models : [];
  $("#usageModelCount").textContent = `${models.length} 个模型`;
  const list = $("#usageModelList");
  list.replaceChildren();
  if (!models.length) {
    const empty = document.createElement("div");
    empty.className = "empty-row";
    empty.textContent = "当前计费周期尚无模型用量记录.";
    list.appendChild(empty);
    return;
  }
  for (const model of models) {
    const row = document.createElement("div");
    row.className = "usage-model-row";
    row.innerHTML = "<strong></strong><span></span><span></span><span></span>";
    row.querySelector("strong").textContent = model.name;
    const values = row.querySelectorAll("span");
    values[0].textContent = formatNumber(model.requests);
    values[1].textContent = model.requestLimit ? formatNumber(model.requestLimit) : "--";
    values[2].textContent = formatNumber(model.tokens);
    list.appendChild(row);
  }
}

async function loadUsage() {
  if (state.usageLoading) return;
  state.usageLoading = true;
  const button = $("#refreshUsageButton");
  button.disabled = true;
  button.classList.add("scanning");
  $("#usageContent").classList.add("loading");
  $("#usageError").classList.add("hidden");
  try {
    const usage = invoke ? await invoke("cursor_usage") : browserFallbackUsage();
    renderUsage(usage);
    addLog("DONE", "Cursor 用量数据已刷新.");
  } catch (error) {
    const message = normalizeError(error);
    state.usage = null;
    $("#usageContent").classList.remove("loading");
    $("#usageError").textContent = message;
    $("#usageError").classList.remove("hidden");
    addLog("WARN", `Cursor 用量读取失败: ${message}`);
  } finally {
    state.usageLoading = false;
    button.disabled = false;
    button.classList.remove("scanning");
  }
}

function renderUpdateStatus(status, notify = false) {
  state.updateStatus = status;
  const card = $("#updateStatusCard");
  card.className = `about-update-card ${status.updateAvailable ? "available" : "current"}`;
  const pill = $("#updateState");
  pill.textContent = status.updateAvailable ? "发现新版本" : status.currentAhead ? "开发版本" : "已是最新";
  pill.className = `pill ${status.updateAvailable ? "warning" : "success"}`;
  $("#updateCurrentVersion").textContent = `v${status.currentVersion}`;
  $("#updateLatestVersion").textContent = `v${status.latestVersion}`;
  $("#updateMessage").textContent = status.message;
  $("#viewUpdateButton").classList.toggle("hidden", !status.updateAvailable);
  $("#downloadUpdateButton").classList.toggle("hidden", !status.updateAvailable);
  if (notify && status.updateAvailable) {
    showToast(`发现新版本 v${status.latestVersion}, 不会强制更新.`, "warning");
  }
}

async function loadUpdateStatus({ notify = false } = {}) {
  if (state.updateLoading) return;
  state.updateLoading = true;
  const card = $("#updateStatusCard");
  const button = $("#checkUpdateButton");
  card.className = "about-update-card checking";
  $("#updateState").textContent = "正在检查";
  $("#updateState").className = "pill neutral";
  $("#updateMessage").textContent = "正在连接 GitHub 检查正式发行版...";
  button.disabled = true;
  button.classList.add("scanning");
  try {
    const status = invoke ? await invoke("check_for_updates") : browserFallbackUpdateStatus();
    renderUpdateStatus(status, notify);
    addLog("DONE", `版本检查完成: ${status.message}`);
  } catch (error) {
    const message = normalizeError(error);
    card.className = "about-update-card failed";
    $("#updateState").textContent = "检查失败";
    $("#updateState").className = "pill warning";
    $("#updateLatestVersion").textContent = "--";
    $("#updateMessage").textContent = `${message}. 不影响当前版本使用, 可以稍后重新检查.`;
    $("#viewUpdateButton").classList.add("hidden");
    addLog("WARN", `版本检查失败: ${message}`);
    if (notify) showToast("版本检查失败, 不影响当前使用.", "warning");
  } finally {
    state.updateLoading = false;
    button.disabled = false;
    button.classList.remove("scanning");
  }
}

async function downloadLatestUpdate() {
  if (state.updateDownloading) return;
  state.updateDownloading = true;
  window.clearTimeout(state.updateProgressHideTimer);
  state.updateProgressHideTimer = null;
  const button = $("#downloadUpdateButton");
  setButtonBusy(button, true, "下载中...");
  setUpdateDownloadProgress(1, "正在准备更新下载...");
  try {
    const result = invoke
      ? await invoke("download_latest_update")
      : { version: "0.4.2", path: "D:\\Downloads\\localization-workbench.zip", sha256: "demo", cached: false };
    addLog("DONE", `更新包 v${result.version} ${result.cached ? "已从本地缓存复用" : "已流式下载"}并通过 SHA256 校验: ${result.path}`);
    setUpdateDownloadProgress(100, result.cached ? "本地缓存已通过 SHA256 校验" : "更新包已下载并通过 SHA256 校验", "complete");
    showToast(`更新包 v${result.version} ${result.cached ? "缓存已校验" : "下载已完成"}.`, "success");
    if (invoke) {
      try {
        await invoke("open_downloaded_update", { path: result.path });
      } catch (error) {
        addLog("WARN", `更新包已完成校验, 但无法打开所在目录: ${normalizeError(error)}`);
        showToast("更新包已完成校验, 但无法自动打开所在目录.", "warning");
      }
    }
  } catch (error) {
    addLog("WARN", `更新包下载失败: ${normalizeError(error)}`);
    setUpdateDownloadProgress(state.updateDownloadPercent || 1, "更新包下载或校验失败", "failed");
    showToast("更新包下载或校验失败.", "warning");
  } finally {
    state.updateDownloading = false;
    setButtonBusy(button, false);
    state.updateProgressHideTimer = window.setTimeout(() => {
      $("#updateDownloadProgress").classList.add("hidden");
      state.updateProgressHideTimer = null;
    }, 3200);
  }
}

function setUpdateDownloadProgress(percent, message, tone = "active") {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  state.updateDownloadPercent = value;
  const progress = $("#updateDownloadProgress");
  progress.classList.remove("hidden", "complete", "failed");
  if (tone !== "active") progress.classList.add(tone);
  $("#updateDownloadProgressText").textContent = message;
  $("#updateDownloadProgressValue").textContent = `${value}%`;
  $("#updateDownloadProgressBar").style.width = `${value}%`;
}

async function openProjectPage(page) {
  try {
    if (invoke) await invoke("open_project_page", { page });
    else window.open(
      page === "repository"
        ? "https://github.com/svipm/cursor-i18n-zh"
        : "https://github.com/svipm/cursor-i18n-zh/releases",
      "_blank",
      "noopener,noreferrer",
    );
  } catch (error) {
    const message = normalizeError(error);
    addLog("WARN", `打开项目页面失败: ${message}`);
    showToast("无法打开默认浏览器.", "warning");
  }
}

function projectLanguageColor(language) {
  const colors = {
    JavaScript: "#f1e05a",
    TypeScript: "#3178c6",
    Rust: "#dea584",
    Python: "#3572a5",
    Go: "#00add8",
    HTML: "#e34c26",
    CSS: "#563d7c",
    Vue: "#41b883",
  };
  return colors[language] || "#8b5cf6";
}

function formatProjectDate(value) {
  if (!value) return "近期维护";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "近期维护";
  return `${new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date)} 更新`;
}

function setGitHubProjectsState(tone, title, message) {
  const panel = $("#githubProjectsState");
  const icons = { loading: "↻", empty: "◇", failed: "!" };
  panel.className = `project-loading-state ${tone}`;
  panel.querySelector(".project-state-icon").textContent = icons[tone] || "↻";
  panel.querySelector("strong").textContent = title;
  panel.querySelector("p").textContent = message;
}

function createProjectStat(icon, value, label) {
  const item = document.createElement("span");
  const symbol = document.createElement("b");
  const count = document.createElement("strong");
  const caption = document.createElement("small");
  symbol.textContent = icon;
  count.textContent = formatNumber(value);
  caption.textContent = label;
  item.append(symbol, count, caption);
  return item;
}

function renderGitHubProjects(projects) {
  const grid = $("#githubProjectsGrid");
  grid.replaceChildren();
  state.githubProjects = Array.isArray(projects) ? projects : [];
  if (!state.githubProjects.length) {
    setGitHubProjectsState("empty", "暂时没有可展示的项目", "公开仓库列表为空, 稍后可以重新刷新.");
    return;
  }

  $("#githubProjectsState").className = "project-loading-state hidden";
  state.githubProjects.forEach((project, index) => {
    const card = document.createElement("article");
    card.className = "github-project-card";
    card.style.setProperty("--project-delay", `${Math.min(index * 45, 225)}ms`);

    const header = document.createElement("div");
    header.className = "github-project-card-header";
    const mark = document.createElement("div");
    mark.className = "project-repository-mark";
    mark.textContent = (project.name || "P").slice(0, 1).toUpperCase();
    const identity = document.createElement("div");
    identity.className = "project-identity";
    const owner = document.createElement("span");
    owner.textContent = "svipm / public";
    const name = document.createElement("h4");
    name.textContent = project.name || "未命名项目";
    identity.append(owner, name);
    const starBadge = document.createElement("span");
    starBadge.className = "project-star-badge";
    starBadge.textContent = `★ ${formatNumber(project.stars)}`;
    header.append(mark, identity, starBadge);

    const description = document.createElement("p");
    description.className = "github-project-description";
    description.textContent = project.description || "一个持续维护的开源项目, 欢迎查看源码和参与改进.";

    const topics = document.createElement("div");
    topics.className = "project-topics";
    const visibleTopics = Array.isArray(project.topics) ? project.topics.slice(0, 3) : [];
    if (!visibleTopics.length) visibleTopics.push("open-source");
    visibleTopics.forEach((topic) => {
      const tag = document.createElement("span");
      tag.textContent = topic;
      topics.appendChild(tag);
    });

    const meta = document.createElement("div");
    meta.className = "project-meta";
    const language = document.createElement("span");
    language.className = "project-language";
    const languageDot = document.createElement("i");
    languageDot.style.backgroundColor = projectLanguageColor(project.language);
    const languageText = document.createElement("strong");
    languageText.textContent = project.language || "多语言";
    language.append(languageDot, languageText);
    const updated = document.createElement("span");
    updated.className = "project-updated";
    updated.textContent = formatProjectDate(project.updatedAt);
    meta.append(language, updated);

    const stats = document.createElement("div");
    stats.className = "project-stats";
    stats.append(
      createProjectStat("★", project.stars, "Stars"),
      createProjectStat("⑂", project.forks, "Forks"),
    );

    const actions = document.createElement("div");
    actions.className = "project-card-actions";
    const viewButton = document.createElement("button");
    viewButton.className = "secondary-button";
    viewButton.dataset.projectUrl = project.htmlUrl;
    viewButton.dataset.projectAction = "view";
    viewButton.textContent = "查看项目";
    const starButton = document.createElement("button");
    starButton.className = "primary-button project-star-button";
    starButton.dataset.projectUrl = project.htmlUrl;
    starButton.dataset.projectAction = "star";
    starButton.innerHTML = "<span aria-hidden=\"true\">★</span>前往 Star";
    actions.append(viewButton, starButton);

    card.append(header, description, topics, meta, stats, actions);
    grid.appendChild(card);
  });
}

async function loadGitHubProjects({ force = false } = {}) {
  if (state.githubProjectsLoading || (state.githubProjectsLoaded && !force)) return;
  state.githubProjectsLoading = true;
  const button = $("#refreshProjectsButton");
  button.disabled = true;
  button.classList.add("scanning");
  if (!state.githubProjects.length) {
    setGitHubProjectsState("loading", "正在读取公开项目", "正在连接 GitHub 获取最新 Star 和维护信息.");
  }
  try {
    const projects = invoke ? await invoke("github_projects") : browserFallbackGitHubProjects();
    const normalizedProjects = Array.isArray(projects) ? projects : [];
    renderGitHubProjects(normalizedProjects);
    state.githubProjectsLoaded = true;
    addLog("DONE", `GitHub 热门项目已刷新, 共展示 ${normalizedProjects.length} 个公开仓库.`);
  } catch (error) {
    const message = normalizeError(error);
    state.githubProjectsLoaded = false;
    if (state.githubProjects.length) {
      setGitHubProjectsState("failed", "刷新失败, 已保留上次结果", `${message}. 可以稍后重试.`);
    } else {
      $("#githubProjectsGrid").replaceChildren();
      setGitHubProjectsState("failed", "暂时无法读取项目", `${message}. 不影响工作台其他功能.`);
    }
    addLog("WARN", `GitHub 项目读取失败: ${message}`);
  } finally {
    state.githubProjectsLoading = false;
    button.disabled = false;
    button.classList.remove("scanning");
  }
}

async function openGitHubProject(url, action) {
  if (!/^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/?$/.test(url || "")) {
    addLog("WARN", "已阻止不受支持的 GitHub 项目链接.");
    showToast("项目链接未通过安全校验.", "warning");
    return;
  }
  try {
    if (invoke) await invoke("open_github_url", { url });
    else window.open(url, "_blank", "noopener,noreferrer");
    if (action === "star") {
      showToast("已打开 GitHub, 登录后点击右上角 Star 即可支持项目.");
    }
  } catch (error) {
    const message = normalizeError(error);
    addLog("WARN", `打开 GitHub 项目失败: ${message}`);
    showToast("无法打开 GitHub 项目.", "warning");
  }
}

function extensionQuery() {
  return {
    target: state.extensionTarget,
    scope: state.extensionScope,
    workspace: state.extensionScope === "project" ? state.extensionWorkspace || null : null,
  };
}

function setExtensionEmptyState(kind, message, error = false) {
  const panel = $(`#extension${kind}State`);
  panel.textContent = message;
  panel.classList.toggle("error", error);
  panel.classList.remove("hidden");
}

function setExtensionActivity(active, title = "正在处理扩展配置", detail = "请稍候, 完成后会自动刷新当前状态.") {
  const section = $("#extensions");
  const banner = $("#extensionActivityBanner");
  section.classList.toggle("is-busy", active);
  section.setAttribute("aria-busy", String(active));
  banner.classList.toggle("hidden", !active);
  if (active) {
    $("#extensionActivityTitle").textContent = title;
    $("#extensionActivityDetail").textContent = detail;
  }
}

function setButtonBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.idleLabel = button.textContent;
    button.textContent = label;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  } else {
    button.textContent = button.dataset.idleLabel || button.textContent;
    delete button.dataset.idleLabel;
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

function updateExtensionControls() {
  $$(`[data-extension-target]`).forEach((button) => {
    const active = button.dataset.extensionTarget === state.extensionTarget;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $$(`[data-extension-scope]`).forEach((button) => {
    const active = button.dataset.extensionScope === state.extensionScope;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $$(`[data-extension-tab]`).forEach((button) => {
    const active = button.dataset.extensionTab === state.extensionTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  $("#extensionWorkspaceControl").classList.toggle("hidden", state.extensionScope !== "project");
  $("#extensionWorkspacePath").value = state.extensionWorkspace;
  $("#extensionMcpPanel").classList.toggle("hidden", state.extensionTab !== "mcp");
  $("#extensionSkillPanel").classList.toggle("hidden", state.extensionTab !== "skill");
  $("#extensionPromptPanel").classList.toggle("hidden", state.extensionTab !== "prompt");
  $("#extensionMarketPanel").classList.toggle("hidden", state.extensionTab !== "market");
  $("#extensionHistoryPanel").classList.toggle("hidden", state.extensionTab !== "history");
  $("#extensionTransferPanel").classList.toggle("hidden", state.extensionTab !== "transfer");
  for (const [name, panel] of [["mcp", "#extensionMcpPanel"], ["skill", "#extensionSkillPanel"], ["prompt", "#extensionPromptPanel"], ["market", "#extensionMarketPanel"], ["history", "#extensionHistoryPanel"], ["transfer", "#extensionTransferPanel"]]) {
    $(panel).setAttribute("aria-hidden", String(state.extensionTab !== name));
  }
  if ($("#extensionCopyTarget").value === state.extensionTarget) {
    $("#extensionCopyTarget").value = state.extensionTarget === "cursor" ? "claude-code" : "cursor";
  }
  renderExtensionTargetMeta();
  updateExtensionSelectionControls();
}

function renderExtensionTargetMeta() {
  const descriptor = state.extensionTargets.find((target) => target.id === state.extensionTarget);
  const meta = $("#extensionTargetMeta");
  if (!descriptor) {
    meta.textContent = "内置适配器";
    return;
  }
  const capabilities = state.extensionScope === "project"
    ? descriptor.projectCapabilities
    : descriptor.userCapabilities;
  const labels = {
    mcp: "MCP",
    skills: "Skills",
    prompts: "提示词",
    "health-check": "健康检测",
    transfer: "迁移",
  };
  meta.textContent = `适配器 v${descriptor.adapterVersion} · ${(capabilities || []).map((value) => labels[value] || value).join(" / ")}`;
  meta.title = descriptor.description;
}

async function loadExtensionTargets() {
  if (state.extensionTargets.length) return;
  state.extensionTargets = invoke
    ? await invoke("extension_targets")
    : [
        { id: "cursor", label: "Cursor", adapterVersion: "1.0.0", description: "管理 Cursor 扩展", userCapabilities: ["mcp", "skills", "health-check", "transfer"], projectCapabilities: ["mcp", "skills", "prompts", "health-check", "transfer"] },
        { id: "claude-code", label: "Claude Code", adapterVersion: "1.0.0", description: "管理 Claude Code 扩展", userCapabilities: ["mcp", "skills", "prompts", "health-check", "transfer"], projectCapabilities: ["mcp", "skills", "prompts", "health-check", "transfer"] },
      ];
  const segment = $("#extensionTargetSegment");
  segment.replaceChildren(...state.extensionTargets.map((target) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.extensionTarget = target.id;
    const mark = document.createElement("span");
    mark.className = `extension-target-mark ${target.id === "cursor" ? "cursor" : target.id === "claude-code" ? "claude" : "generic"}`;
    mark.textContent = target.id === "cursor" ? "C" : target.id === "claude-code" ? "AI" : target.label.slice(0, 2).toUpperCase();
    const label = document.createElement("span");
    label.dataset.extensionTargetLabel = "";
    label.textContent = target.label;
    button.append(mark, label);
    return button;
  }));
  const options = $("#extensionCopyTarget");
  options.replaceChildren(...state.extensionTargets.map((target) => {
    const option = document.createElement("option");
    option.value = target.id;
    option.textContent = target.label;
    return option;
  }));
  updateExtensionControls();
}

function renderExtensionHistory(records) {
  const list = $("#extensionHistoryList");
  list.replaceChildren();
  if (!records.length) {
    $("#extensionHistoryState").textContent = "当前目标和作用域还没有修改历史.";
    $("#extensionHistoryState").classList.remove("hidden", "error");
    return;
  }
  $("#extensionHistoryState").classList.add("hidden");
  records.forEach((record) => {
    const card = document.createElement("article");
    card.className = "extension-history-card";
    const heading = document.createElement("div");
    heading.className = "extension-history-heading";
    const title = document.createElement("div");
    const name = document.createElement("h4");
    name.textContent = record.summary;
    const meta = document.createElement("p");
    meta.textContent = `${formatBackupTime(record)} · ${record.targetLabel} · ${record.scope === "project" ? "项目级" : "用户级"}`;
    title.append(name, meta);
    const count = document.createElement("span");
    count.textContent = `${(record.changes || []).length} 项变更`;
    heading.append(title, count);
    const changes = document.createElement("div");
    changes.className = "extension-history-changes";
    (record.changes || []).slice(0, 6).forEach((change) => {
      const row = document.createElement("span");
      row.className = change.kind;
      row.textContent = `${change.kind === "added" ? "+" : change.kind === "deleted" ? "-" : "~"} ${change.path}`;
      changes.appendChild(row);
    });
    if ((record.changes || []).length > 6) {
      const more = document.createElement("span");
      more.textContent = `另有 ${(record.changes || []).length - 6} 项变更`;
      changes.appendChild(more);
    }
    const actions = document.createElement("div");
    actions.className = "extension-item-actions";
    const restore = createExtensionButton("恢复到此状态", "restore-history", record.id);
    restore.dataset.historyId = record.id;
    restore.disabled = !record.canRestore;
    actions.appendChild(restore);
    card.append(heading, changes, actions);
    list.appendChild(card);
  });
}

async function loadExtensionHistory() {
  if (state.extensionHistoryLoading) return;
  if (state.extensionScope === "project" && !state.extensionWorkspace) {
    renderExtensionHistory([]);
    return;
  }
  state.extensionHistoryLoading = true;
  setButtonBusy($("#refreshExtensionHistoryButton"), true, "刷新中...");
  try {
    const query = extensionQuery();
    state.extensionHistory = invoke ? await invoke("extension_history", { query }) : [];
    renderExtensionHistory(state.extensionHistory);
  } catch (error) {
    $("#extensionHistoryState").textContent = normalizeError(error);
    $("#extensionHistoryState").classList.remove("hidden");
    $("#extensionHistoryState").classList.add("error");
  } finally {
    state.extensionHistoryLoading = false;
    setButtonBusy($("#refreshExtensionHistoryButton"), false);
  }
}

async function restoreExtensionHistory(id, triggerButton) {
  if (state.extensionRunning) return;
  if (!window.confirm("确定恢复到这条历史记录修改前的状态吗? 当前配置会先生成一条新的可恢复快照.")) return;
  state.extensionRunning = true;
  setButtonBusy(triggerButton, true, "恢复中...");
  setExtensionActivity(true, "正在恢复扩展配置", "正在校验快照并原子替换 MCP、Skill、提示词和来源注册表.");
  try {
    const request = { ...extensionQuery(), id };
    const result = invoke
      ? await invoke("extension_restore_history", { request })
      : { message: "扩展配置已恢复", inventory: state.extensionInventory };
    renderExtensionInventory(result.inventory);
    await loadExtensionHistory();
    addLog("DONE", result.message);
    showToast("扩展配置已恢复.", "success");
  } catch (error) {
    const message = normalizeError(error);
    addLog("WARN", `扩展历史恢复失败: ${message}`);
    showToast("扩展历史恢复失败.", "warning");
  } finally {
    state.extensionRunning = false;
    setButtonBusy(triggerButton, false);
    setExtensionActivity(false);
  }
}

function destinationExtensionQuery() {
  return {
    target: $("#extensionCopyTarget").value,
    scope: state.extensionScope,
    workspace: state.extensionScope === "project" ? state.extensionWorkspace : null,
  };
}

function renderTransferPreview(preview, mode) {
  state.extensionTransferPreview = preview;
  state.extensionTransferMode = mode;
  const source = preview.sourceTarget === "cursor" ? "Cursor" : "Claude Code";
  const destination = preview.destinationTarget === "cursor" ? "Cursor" : "Claude Code";
  $("#extensionTransferPreviewTitle").textContent = `${source} → ${destination}`;
  const protection = preview.encrypted
    ? "私密内容已通过密码解密."
    : preview.includesSecrets
      ? mode === "copy"
        ? "应用间复制仅在内存中保留密钥."
        : "检测到旧版明文私密包, 导入后请立即删除源文件."
      : "配置包已脱敏.";
  $("#extensionTransferPreviewSummary").textContent = `MCP ${preview.mcpCount}, Skill ${preview.skillCount}, 提示词 ${preview.promptCount}, 同名冲突 ${(preview.conflicts || []).length}. ${protection}`;
  const conflicts = $("#extensionTransferConflicts");
  conflicts.replaceChildren();
  (preview.conflicts || []).forEach((conflict) => {
    const row = document.createElement("article");
    const name = document.createElement("strong");
    name.textContent = `${String(conflict.kind).toUpperCase()} · ${conflict.name}`;
    const summary = document.createElement("span");
    summary.textContent = conflict.summary;
    row.append(name, summary);
    conflicts.appendChild(row);
  });
  if (!conflicts.childElementCount) {
    const row = document.createElement("article");
    const name = document.createElement("strong");
    name.textContent = "未发现同名冲突";
    const summary = document.createElement("span");
    summary.textContent = "可以直接执行迁移.";
    row.append(name, summary);
    conflicts.appendChild(row);
  }
  $("#extensionConflictPolicy").value = (preview.conflicts || []).length ? "fail" : "overwrite";
  $("#extensionTransferPreview").classList.remove("hidden");
}

function invalidateExtensionTransferPreview() {
  state.extensionTransferPreview = null;
  state.extensionTransferMode = "";
  $("#extensionTransferPreview").classList.add("hidden");
}

async function previewExtensionCopy() {
  if (state.extensionRunning) return;
  const destination = destinationExtensionQuery();
  if (destination.target === state.extensionTarget) {
    showToast("复制目标不能与当前应用相同.", "warning");
    return;
  }
  if (destination.scope === "project" && !destination.workspace) {
    showToast("请先选择项目工作区.", "warning");
    return;
  }
  const button = $("#previewExtensionCopyButton");
  setButtonBusy(button, true, "预检中...");
  try {
    const request = { source: extensionQuery(), destination };
    const preview = invoke
      ? await invoke("extension_preview_copy", { request })
      : { sourceTarget: state.extensionTarget, destinationTarget: destination.target, mcpCount: 2, skillCount: 1, promptCount: 1, conflicts: [], includesSecrets: true };
    renderTransferPreview(preview, "copy");
  } catch (error) {
    showToast("扩展复制预检失败.", "warning");
    addLog("WARN", `扩展复制预检失败: ${normalizeError(error)}`);
  } finally {
    setButtonBusy(button, false);
  }
}

async function exportExtensionBundle(includeSecrets) {
  if (state.extensionRunning) return;
  const password = includeSecrets ? $("#extensionExportPassword").value : "";
  const confirmation = includeSecrets ? $("#extensionExportPasswordConfirm").value : "";
  if (includeSecrets) {
    const passwordBytes = new TextEncoder().encode(password).length;
    if (passwordBytes < 10) {
      showToast("私密包密码至少需要 10 个字节.", "warning");
      return;
    }
    if (passwordBytes > 256) {
      showToast("私密包密码不能超过 256 个字节.", "warning");
      return;
    }
    if (password !== confirmation) {
      showToast("两次输入的私密包密码不一致.", "warning");
      return;
    }
    if (!window.confirm("私密配置包将包含 MCP 密钥, 并使用当前密码加密. 密码丢失后无法恢复, 是否继续?")) return;
  }
  const button = includeSecrets ? $("#exportPrivateBundleButton") : $("#exportRedactedBundleButton");
  setButtonBusy(button, true, "导出中...");
  try {
    const path = invoke
      ? await invoke("choose_extension_bundle_path", { mode: includeSecrets ? "save-private" : "save-redacted" })
      : includeSecrets
        ? "D:\\Downloads\\i18n-workbench-private.iwbundle"
        : "D:\\Downloads\\i18n-workbench-extensions.json";
    if (!path) return;
    const request = { ...extensionQuery(), path, includeSecrets, password: includeSecrets ? password : null };
    const result = invoke
      ? await invoke("extension_export_bundle", { request })
      : { path, includesSecrets: includeSecrets, encrypted: includeSecrets, mcpCount: 2, skillCount: 1, promptCount: 1 };
    addLog("DONE", `扩展配置包已导出: ${result.path}`);
    if (includeSecrets) {
      $("#extensionExportPassword").value = "";
      $("#extensionExportPasswordConfirm").value = "";
    }
    showToast(includeSecrets ? "加密私密配置包已导出." : "脱敏配置包已导出.", "success");
  } catch (error) {
    addLog("WARN", `扩展配置包导出失败: ${normalizeError(error)}`);
    showToast("扩展配置包导出失败.", "warning");
  } finally {
    setButtonBusy(button, false);
  }
}

async function chooseAndPreviewExtensionImport() {
  if (state.extensionRunning) return;
  const button = $("#chooseExtensionImportButton");
  setButtonBusy(button, true, "读取中...");
  try {
    const path = invoke
      ? await invoke("choose_extension_bundle_path", { mode: "open" })
      : "D:\\Downloads\\i18n-workbench-extensions.json";
    if (!path) return;
    invalidateExtensionTransferPreview();
    state.extensionImportPath = path;
    $("#extensionImportPath").textContent = path;
    $("#extensionImportPath").title = path;
    $("#previewSelectedImportButton").disabled = false;
    await previewSelectedExtensionImport();
  } catch (error) {
    addLog("WARN", `配置包预检失败: ${normalizeError(error)}`);
    showToast("配置包预检失败.", "warning");
  } finally {
    setButtonBusy(button, false);
  }
}

async function previewSelectedExtensionImport() {
  if (state.extensionRunning || !state.extensionImportPath) return;
  const button = $("#previewSelectedImportButton");
  setButtonBusy(button, true, "预检中...");
  try {
    const password = $("#extensionImportPassword").value;
    if (new TextEncoder().encode(password).length > 256) {
      showToast("私密包密码不能超过 256 个字节.", "warning");
      return;
    }
    const request = {
      ...extensionQuery(),
      path: state.extensionImportPath,
      password: password || null,
    };
    const preview = invoke
      ? await invoke("extension_preview_import", { request })
      : { sourceTarget: "claude-code", destinationTarget: state.extensionTarget, mcpCount: 2, skillCount: 1, promptCount: 1, conflicts: [], includesSecrets: true, encrypted: true };
    renderTransferPreview(preview, "import");
  } catch (error) {
    addLog("WARN", `配置包预检失败: ${normalizeError(error)}`);
    showToast(normalizeError(error).includes("密码") ? "配置包密码错误或尚未填写." : "配置包预检失败.", "warning");
  } finally {
    setButtonBusy(button, false);
  }
}

async function applyExtensionTransfer() {
  if (state.extensionRunning || !state.extensionTransferPreview) return;
  const policy = $("#extensionConflictPolicy").value;
  const conflicts = state.extensionTransferPreview.conflicts || [];
  if (conflicts.length && policy === "fail") {
    showToast("存在同名冲突, 请明确选择跳过或覆盖.", "warning");
    return;
  }
  if (policy === "overwrite" && conflicts.length && !window.confirm(`将覆盖 ${conflicts.length} 个同名项目. 当前状态会先进入历史快照, 是否继续?`)) return;
  const button = $("#applyExtensionTransferButton");
  state.extensionRunning = true;
  setButtonBusy(button, true, "执行中...");
  setExtensionActivity(true, "正在迁移扩展配置", "正在写入 MCP、完整 Skill 目录和提示词, 失败时自动恢复操作前快照.");
  try {
    let result;
    if (state.extensionTransferMode === "copy") {
      const request = { source: extensionQuery(), destination: destinationExtensionQuery(), conflictPolicy: policy };
      result = invoke ? await invoke("extension_copy", { request }) : { message: "扩展复制完成", inventory: state.extensionInventory };
    } else {
      const request = {
        ...extensionQuery(),
        path: state.extensionImportPath,
        conflictPolicy: policy,
        password: $("#extensionImportPassword").value || null,
      };
      result = invoke ? await invoke("extension_import_bundle", { request }) : { message: "配置包导入完成", inventory: state.extensionInventory };
    }
    if (state.extensionTransferMode === "import") {
      renderExtensionInventory(result.inventory);
      await loadExtensionHistory();
      $("#extensionImportPassword").value = "";
    }
    $("#extensionTransferPreview").classList.add("hidden");
    state.extensionTransferPreview = null;
    addLog("DONE", result.message);
    showToast("扩展迁移完成.", "success");
  } catch (error) {
    addLog("WARN", `扩展迁移失败: ${normalizeError(error)}`);
    showToast("扩展迁移失败, 已尝试自动回滚.", "warning");
  } finally {
    state.extensionRunning = false;
    setButtonBusy(button, false);
    setExtensionActivity(false);
  }
}

function marketStatusFor(kind, name) {
  return state.extensionMarket.find((entry) => entry.kind === kind && entry.name === name) || null;
}

function createRepositoryButton(repository) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "GitHub 仓库";
  button.dataset.extensionAction = "open-repository";
  button.dataset.repository = repository;
  return button;
}

function handleCommonExtensionAction(button) {
  if (button.dataset.extensionAction === "open-repository") {
    openGitHubProject(button.dataset.repository, "repository");
    return true;
  }
  if (button.dataset.extensionAction === "install-market") {
    installMarketItem(button.dataset.marketId, button);
    return true;
  }
  if (button.dataset.extensionAction === "check-market") {
    state.extensionTab = "market";
    updateExtensionControls();
    loadExtensionMarket();
    return true;
  }
  return false;
}

function createExtensionButton(label, action, name, tone = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.dataset.extensionAction = action;
  button.dataset.extensionName = name;
  if (tone) button.classList.add(tone);
  return button;
}

function extensionMcpHealthKey(name) {
  return JSON.stringify([state.extensionTarget, state.extensionScope, state.extensionWorkspace || "", name]);
}

function extensionSelectionKey(kind, name) {
  return `${kind}:${name}`;
}

function currentExtensionKind() {
  return ["mcp", "skill", "prompt"].includes(state.extensionTab) ? state.extensionTab : "";
}

function extensionMatchesFilter(item, kind) {
  const query = state.extensionSearch.trim().toLowerCase();
  const searchable = [item.name, item.description, item.endpoint, item.source, item.repository]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (query && !searchable.includes(query)) return false;
  if (state.extensionStatusFilter === "enabled" && !item.enabled) return false;
  if (state.extensionStatusFilter === "disabled" && item.enabled) return false;
  if (state.extensionStatusFilter === "issues") {
    const health = kind === "mcp" ? state.extensionMcpHealth[extensionMcpHealthKey(item.name)] : null;
    const issue = item.localModified
      || health?.status === "failed"
      || ["high", "invalid"].includes(item.audit?.riskLevel);
    if (!issue) return false;
  }
  return true;
}

function createExtensionSelector(kind, name, disabled = false) {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "extension-item-select";
  input.dataset.extensionSelectKind = kind;
  input.dataset.extensionSelectName = name;
  input.checked = state.extensionSelection.has(extensionSelectionKey(kind, name));
  input.disabled = disabled;
  input.setAttribute("aria-label", `选择 ${name}`);
  return input;
}

function clearExtensionSelection() {
  state.extensionSelection.clear();
  updateExtensionSelectionControls();
  if (state.extensionInventory) renderExtensionInventory(state.extensionInventory);
}

function updateExtensionSelectionControls() {
  const kind = currentExtensionKind();
  const names = [...state.extensionSelection].filter((key) => key.startsWith(`${kind}:`));
  $("#extensionSelectedCount").textContent = `已选择 ${names.length} 项`;
  $("#batchEnableExtensionsButton").disabled = !names.length;
  $("#batchDisableExtensionsButton").disabled = !names.length;
  $("#clearExtensionSelectionButton").disabled = !state.extensionSelection.size;
  $("#extensionListTools").classList.toggle("hidden", !kind);
}

async function batchToggleExtensions(enabled) {
  const kind = currentExtensionKind();
  const names = [...state.extensionSelection]
    .filter((key) => key.startsWith(`${kind}:`))
    .map((key) => key.slice(kind.length + 1));
  if (!kind || !names.length || state.extensionRunning) return;
  const button = enabled ? $("#batchEnableExtensionsButton") : $("#batchDisableExtensionsButton");
  state.extensionRunning = true;
  setButtonBusy(button, true, "处理中...");
  setExtensionActivity(true, `正在批量${enabled ? "启用" : "停用"}`, `已选择 ${names.length} 个项目, 操作前会创建完整历史快照.`);
  try {
    const request = { ...extensionQuery(), kind, names, enabled };
    const result = invoke
      ? await invoke("extension_batch_toggle", { request })
      : { message: "批量操作完成", inventory: state.extensionInventory };
    state.extensionSelection.clear();
    renderExtensionInventory(result.inventory);
    addLog("DONE", result.message);
    showToast(result.message, "success");
  } catch (error) {
    addLog("WARN", `扩展批量操作失败: ${normalizeError(error)}`);
    showToast("扩展批量操作失败.", "warning");
  } finally {
    state.extensionRunning = false;
    setButtonBusy(button, false);
    setExtensionActivity(false);
    updateExtensionSelectionControls();
  }
}

function renderExtensionMcp(servers) {
  const list = $("#extensionMcpList");
  list.replaceChildren();
  const visible = servers.filter((server) => extensionMatchesFilter(server, "mcp"));
  if (!visible.length) {
    setExtensionEmptyState("Mcp", servers.length ? "没有符合当前搜索和筛选条件的 MCP 服务." : "当前范围没有 MCP 服务. 点击“添加 MCP”创建第一个配置.");
    return;
  }
  $("#extensionMcpState").classList.add("hidden");
  visible.forEach((server) => {
    const market = marketStatusFor("mcp", server.name);
    const health = state.extensionMcpHealth[extensionMcpHealthKey(server.name)] || null;
    const card = document.createElement("article");
    card.className = `extension-item-card${server.enabled ? "" : " disabled"}`;
    const header = document.createElement("div");
    header.className = "extension-item-header";
    const icon = document.createElement("div");
    icon.className = `extension-item-icon ${server.transport === "stdio" ? "" : "http"}`;
    icon.textContent = server.transport === "stdio" ? "IO" : "WEB";
    const title = document.createElement("div");
    title.className = "extension-item-title";
    const heading = document.createElement("h4");
    heading.textContent = server.name;
    const endpoint = document.createElement("p");
    endpoint.textContent = `${String(server.transport).toUpperCase()} · ${server.endpoint || "未设置端点"}`;
    title.append(heading, endpoint);
    const status = document.createElement("span");
    status.className = "extension-state-pill";
    status.textContent = market?.localModified
      ? "本地已修改"
      : market?.updateAvailable
      ? "有更新"
      : health?.status === "healthy"
        ? "连接正常"
        : health?.status === "failed"
          ? "检测失败"
          : server.enabled ? "已启用" : "已停用";
    status.classList.toggle("update", Boolean(market?.updateAvailable));
    status.classList.toggle("modified", Boolean(market?.localModified));
    status.classList.toggle("failed", health?.status === "failed");
    header.append(createExtensionSelector("mcp", server.name), icon, title, status);

    const description = document.createElement("p");
    description.className = "extension-item-description";
    description.textContent = `${server.source}配置, ${server.argsCount || 0} 个命令参数. 敏感字段仅显示名称, 不返回实际值.`;
    const tags = document.createElement("div");
    tags.className = "extension-secret-tags";
    [...(server.envKeys || []).map((key) => `ENV · ${key}`), ...(server.headerKeys || []).map((key) => `HEADER · ${key}`)]
      .slice(0, 5)
      .forEach((label) => {
        const tag = document.createElement("span");
        tag.textContent = label;
        tags.appendChild(tag);
      });
    if (!tags.childElementCount) {
      const tag = document.createElement("span");
      tag.textContent = "无敏感字段";
      tags.appendChild(tag);
    }
    const healthSummary = document.createElement("div");
    healthSummary.className = `mcp-health-summary${health ? ` ${health.status}` : ""}`;
    if (health) {
      const protocol = health.protocolVersion ? ` · 协议 ${health.protocolVersion}` : "";
      healthSummary.textContent = `${health.summary} · ${health.latencyMs} ms${protocol}`;
      healthSummary.title = (health.diagnostics || []).join("\n");
    } else {
      healthSummary.textContent = "尚未执行实际连接检测";
    }
    const actions = document.createElement("div");
    actions.className = "extension-item-actions";
    actions.append(
      createExtensionButton("检测", "check-mcp", server.name),
      createExtensionButton("编辑", "edit-mcp", server.name),
      createExtensionButton(server.enabled ? "停用" : "启用", "toggle-mcp", server.name),
      createExtensionButton("删除", "delete-mcp", server.name, "danger"),
    );
    if (server.repository) actions.insertBefore(createRepositoryButton(server.repository), actions.lastElementChild);
    if (server.repository && !market) actions.insertBefore(createExtensionButton("检查更新", "check-market", server.name), actions.lastElementChild);
    if (market?.updateAvailable) {
      const update = createExtensionButton("一键更新", "install-market", server.name);
      update.dataset.marketId = market.id;
      actions.insertBefore(update, actions.lastElementChild);
    }
    card.append(header, description, tags, healthSummary, actions);
    list.appendChild(card);
  });
}

async function checkMcp(name, triggerButton = null) {
  if (state.extensionRunning) return;
  state.extensionRunning = true;
  setButtonBusy(triggerButton, true, "检测中...");
  setExtensionActivity(true, `正在检测 MCP: ${name}`, "将实际启动 stdio 服务或向远程端点发送 initialize 请求, 敏感字段不会进入日志.");
  try {
    const request = { ...extensionQuery(), name };
    const result = invoke
      ? await invoke("extension_check_mcp", { request })
      : {
          name,
          transport: "stdio",
          status: "healthy",
          summary: "初始化握手成功",
          diagnostics: ["浏览器预览模式模拟检测"],
          latencyMs: 36,
          protocolVersion: "2025-06-18",
          enabled: true,
          checkedAtUnix: Math.floor(Date.now() / 1000),
        };
    state.extensionMcpHealth[extensionMcpHealthKey(name)] = result;
    renderExtensionMcp(state.extensionInventory?.mcpServers || []);
    addLog(result.status === "healthy" ? "DONE" : "WARN", `MCP ${name}: ${result.summary}, ${result.latencyMs} ms.`);
    showToast(result.status === "healthy" ? `${name} 连接正常.` : `${name} 检测失败.`, result.status === "healthy" ? "success" : "warning");
  } catch (error) {
    const message = normalizeError(error);
    state.extensionMcpHealth[extensionMcpHealthKey(name)] = {
      status: "failed",
      summary: "检测失败",
      diagnostics: [message],
      latencyMs: 0,
    };
    renderExtensionMcp(state.extensionInventory?.mcpServers || []);
    addLog("WARN", `MCP ${name} 检测失败: ${message}`);
    showToast(`${name} 检测失败.`, "warning");
  } finally {
    state.extensionRunning = false;
    setButtonBusy(triggerButton, false);
    setExtensionActivity(false);
  }
}

async function checkAllMcp() {
  const servers = state.extensionInventory?.mcpServers || [];
  if (!servers.length || state.extensionRunning) return;
  const button = $("#checkAllMcpButton");
  setButtonBusy(button, true, "检测中...");
  for (const server of servers) {
    await checkMcp(server.name);
  }
  setButtonBusy(button, false);
}

function renderExtensionSkills(skills) {
  const list = $("#extensionSkillList");
  list.replaceChildren();
  const visible = skills.filter((skill) => extensionMatchesFilter(skill, "skill"));
  if (!visible.length) {
    setExtensionEmptyState("Skill", skills.length ? "没有符合当前搜索和筛选条件的 Skill." : "当前范围没有 Skill. 点击“新建 Skill”创建 SKILL.md.");
    return;
  }
  $("#extensionSkillState").classList.add("hidden");
  visible.forEach((skill) => {
    const market = marketStatusFor("skill", skill.id || skill.name);
    const audit = skill.audit || {};
    const card = document.createElement("article");
    card.className = `extension-item-card${skill.enabled ? "" : " disabled"}${skill.builtIn ? " builtin" : ""}`;
    const header = document.createElement("div");
    header.className = "extension-item-header";
    const icon = document.createElement("div");
    icon.className = "extension-item-icon skill";
    icon.textContent = "SK";
    const title = document.createElement("div");
    title.className = "extension-item-title";
    const heading = document.createElement("h4");
    heading.textContent = skill.name;
    const source = document.createElement("p");
    source.textContent = skill.source;
    title.append(heading, source);
    const status = document.createElement("span");
    status.className = "extension-state-pill";
    status.textContent = market?.localModified ? "本地已修改" : market?.updateAvailable ? "有更新" : skill.builtIn ? "内置只读" : skill.enabled ? "已启用" : "已停用";
    status.classList.toggle("update", Boolean(market?.updateAvailable));
    status.classList.toggle("modified", Boolean(market?.localModified));
    if (skill.builtIn) {
      header.classList.add("no-select");
      header.append(icon, title, status);
    } else {
      header.append(createExtensionSelector("skill", skill.id || skill.name), icon, title, status);
    }
    const description = document.createElement("p");
    description.className = "extension-item-description";
    description.textContent = skill.description || "未提供 Skill 描述";
    const tags = document.createElement("div");
    tags.className = "extension-secret-tags";
    for (const label of [
      "SKILL.md",
      skill.enabled ? "ACTIVE" : "DISABLED",
      `${audit.fileCount || 0} FILES`,
      audit.trustedSource ? "PINNED SOURCE" : "UNVERIFIED SOURCE",
    ]) {
      const tag = document.createElement("span");
      tag.textContent = label;
      tags.appendChild(tag);
    }
    const auditSummary = document.createElement("div");
    const risk = audit.riskLevel || "unknown";
    auditSummary.className = `skill-audit-summary ${risk}`;
    const auditTitle = document.createElement("strong");
    auditTitle.textContent = risk === "low"
      ? "低风险"
      : risk === "medium"
        ? "中风险"
        : risk === "high"
          ? "高风险"
          : risk === "invalid" ? "配置无效" : "尚未审计";
    const auditText = document.createElement("span");
    const capabilities = [audit.hasScripts && "脚本", audit.hasNetworkAccess && "网络", audit.hasShellCommands && "Shell"]
      .filter(Boolean)
      .join(" / ");
    auditText.textContent = `${audit.riskScore || 0} 分${capabilities ? ` · ${capabilities}` : " · 纯文档"} · SHA256 ${(audit.sha256 || "--").slice(0, 12)}`;
    auditSummary.title = (audit.findings || []).join("\n") || "未发现明显风险";
    auditSummary.append(auditTitle, auditText);
    const actions = document.createElement("div");
    actions.className = "extension-item-actions";
    if (!skill.builtIn) {
      const skillId = skill.id || skill.name;
      actions.append(
        createExtensionButton("编辑", "edit-skill", skillId),
        createExtensionButton(skill.enabled ? "停用" : "启用", "toggle-skill", skillId),
        createExtensionButton("删除", "delete-skill", skillId, "danger"),
      );
      if (skill.repository) actions.insertBefore(createRepositoryButton(skill.repository), actions.lastElementChild);
      if (skill.repository && !market) actions.insertBefore(createExtensionButton("检查更新", "check-market", skillId), actions.lastElementChild);
      if (market?.updateAvailable) {
        const update = createExtensionButton("一键更新", "install-market", skillId);
        update.dataset.marketId = market.id;
        actions.insertBefore(update, actions.lastElementChild);
      }
      actions.querySelectorAll("button").forEach((button) => {
        button.dataset.extensionEnabled = String(skill.enabled);
      });
    } else {
      const label = document.createElement("span");
      label.className = "engine-hint";
      label.textContent = "由 Cursor 管理, 工作台不会修改";
      actions.appendChild(label);
    }
    card.append(header, description, tags, auditSummary, actions);
    list.appendChild(card);
  });
}

function renderExtensionPrompts(prompts) {
  const list = $("#extensionPromptList");
  list.replaceChildren();
  const visible = prompts.filter((prompt) => extensionMatchesFilter(prompt, "prompt"));
  if (!visible.length) {
    setExtensionEmptyState("Prompt", prompts.length ? "没有符合当前搜索和筛选条件的提示词." : "当前范围没有提示词. 点击“新建提示词”创建第一条规则.");
    return;
  }
  $("#extensionPromptState").classList.add("hidden");
  visible.forEach((prompt) => {
    const market = marketStatusFor("prompt", prompt.id || prompt.name);
    const card = document.createElement("article");
    card.className = `extension-item-card${prompt.enabled ? "" : " disabled"}`;
    const header = document.createElement("div");
    header.className = "extension-item-header";
    const icon = document.createElement("div");
    icon.className = "extension-item-icon prompt";
    icon.textContent = "PR";
    const title = document.createElement("div");
    title.className = "extension-item-title";
    const heading = document.createElement("h4");
    heading.textContent = prompt.name;
    const source = document.createElement("p");
    source.textContent = prompt.source;
    title.append(heading, source);
    const status = document.createElement("span");
    status.className = "extension-state-pill";
    status.textContent = market?.localModified ? "本地已修改" : market?.updateAvailable ? "有更新" : prompt.enabled ? "已启用" : "已停用";
    status.classList.toggle("update", Boolean(market?.updateAvailable));
    status.classList.toggle("modified", Boolean(market?.localModified));
    header.append(createExtensionSelector("prompt", prompt.id || prompt.name), icon, title, status);
    const description = document.createElement("p");
    description.className = "extension-item-description";
    description.textContent = prompt.description || "未提供提示词描述";
    const tags = document.createElement("div");
    tags.className = "extension-secret-tags";
    for (const label of [state.extensionTarget === "cursor" ? "RULE.mdc" : "RULE.md", prompt.enabled ? "ACTIVE" : "DISABLED"]) {
      const tag = document.createElement("span");
      tag.textContent = label;
      tags.appendChild(tag);
    }
    const actions = document.createElement("div");
    actions.className = "extension-item-actions";
    const promptId = prompt.id || prompt.name;
    actions.append(
      createExtensionButton("编辑", "edit-prompt", promptId),
      createExtensionButton(prompt.enabled ? "停用" : "启用", "toggle-prompt", promptId),
      createExtensionButton("删除", "delete-prompt", promptId, "danger"),
    );
    actions.querySelectorAll("button").forEach((button) => {
      button.dataset.extensionEnabled = String(prompt.enabled);
    });
    if (prompt.repository) actions.insertBefore(createRepositoryButton(prompt.repository), actions.lastElementChild);
    if (prompt.repository && !market) actions.insertBefore(createExtensionButton("检查更新", "check-market", promptId), actions.lastElementChild);
    if (market?.updateAvailable) {
      const update = createExtensionButton("一键更新", "install-market", promptId);
      update.dataset.marketId = market.id;
      actions.insertBefore(update, actions.lastElementChild);
    }
    card.append(header, description, tags, actions);
    list.appendChild(card);
  });
}

function renderExtensionMarket(items) {
  const list = $("#extensionMarketList");
  list.replaceChildren();
  if (!items.length) {
    setExtensionEmptyState("Market", "当前目标暂无可用市场项目.");
    return;
  }
  $("#extensionMarketState").classList.add("hidden");
  items.forEach((entry) => {
    const card = document.createElement("article");
    card.className = `extension-item-card market-item${entry.installed ? " installed" : ""}${entry.localModified ? " locally-modified" : ""}`;
    const header = document.createElement("div");
    header.className = "extension-item-header no-select";
    const icon = document.createElement("div");
    icon.className = `extension-item-icon ${entry.kind === "skill" ? "skill" : entry.kind === "prompt" ? "prompt" : ""}`;
    icon.textContent = entry.kind === "mcp" ? "M" : entry.kind === "skill" ? "SK" : "PR";
    const title = document.createElement("div");
    title.className = "extension-item-title";
    const heading = document.createElement("h4");
    heading.textContent = entry.title;
    const repository = document.createElement("p");
    repository.textContent = entry.repository.replace("https://github.com/", "");
    title.append(heading, repository);
    const status = document.createElement("span");
    status.className = "extension-state-pill";
    status.textContent = entry.status;
    status.classList.toggle("update", Boolean(entry.updateAvailable));
    status.classList.toggle("modified", Boolean(entry.localModified));
    header.append(icon, title, status);
    const description = document.createElement("p");
    description.className = "extension-item-description";
    description.textContent = entry.description;
    const tags = document.createElement("div");
    tags.className = "extension-secret-tags";
    const trustLabel = entry.trust === "official" ? "官方来源" : entry.trust === "verified" ? "已验证社区" : "社区来源";
    for (const label of [entry.kind.toUpperCase(), trustLabel, entry.license ? `LICENSE · ${entry.license}` : "LICENSE · 未声明", entry.latestRevision ? `REV · ${entry.latestRevision.slice(0, 8)}` : "VERSION · 未获取"]) {
      const tag = document.createElement("span");
      tag.textContent = label;
      tags.appendChild(tag);
    }
    const actions = document.createElement("div");
    actions.className = "extension-item-actions";
    actions.append(createRepositoryButton(entry.repository));
    if (entry.installable !== false) {
      const install = createExtensionButton(entry.updateAvailable ? "更新" : entry.installed ? "重新安装" : "安装", "install-market", entry.name);
      install.dataset.marketId = entry.id;
      actions.append(install);
    }
    card.append(header, description, tags, actions);
    list.appendChild(card);
  });
}

async function loadExtensionMarket() {
  if (state.extensionMarketLoading) return;
  if (state.extensionScope === "project" && !state.extensionWorkspace) {
    setExtensionEmptyState("Market", "请先选择要安装扩展的工作区.");
    return;
  }
  state.extensionMarketLoading = true;
  const refreshButton = $("#refreshMarketButton");
  setButtonBusy(refreshButton, true, "正在检查...");
  setExtensionActivity(true, "正在检查 GitHub 更新", "正在读取仓库最新提交并与本机安装记录比对.");
  setExtensionEmptyState("Market", "正在读取 GitHub 仓库最新提交并比对已安装版本...");
  try {
    const query = extensionQuery();
    state.extensionMarket = invoke ? await invoke("extension_market", { query }) : browserFallbackMarket(query);
    renderExtensionMarket(state.extensionMarket);
    if (state.extensionInventory) renderExtensionInventory(state.extensionInventory);
    addLog("DONE", `扩展市场已刷新, 共 ${state.extensionMarket.length} 个项目.`);
  } catch (error) {
    const message = normalizeError(error);
    setExtensionEmptyState("Market", message, true);
    addLog("WARN", `扩展市场刷新失败: ${message}`);
  } finally {
    state.extensionMarketLoading = false;
    setButtonBusy(refreshButton, false);
    setExtensionActivity(false);
  }
}

async function installMarketItem(id, triggerButton = null) {
  if (!id || state.extensionRunning) return;
  const marketItem = state.extensionMarket.find((entry) => entry.id === id) || null;
  let allowOverwriteModified = false;
  if (marketItem?.localModified) {
    allowOverwriteModified = window.confirm("本地内容已修改. 更新会覆盖本地改动, 但操作前会创建完整历史快照. 是否明确继续覆盖?");
    if (!allowOverwriteModified) return;
  }
  state.extensionRunning = true;
  setButtonBusy(triggerButton, true, "正在处理...");
  setExtensionActivity(true, "正在安装或更新扩展", "正在下载并校验来源文件, 已有配置和启停状态会被保留.");
  try {
    const request = { ...extensionQuery(), id, allowOverwriteModified };
    const result = invoke
      ? await invoke("extension_install_market_item", { request })
      : { message: "市场项目已安装或更新", inventory: browserFallbackExtensionInventory(extensionQuery()) };
    renderExtensionInventory(result.inventory);
    await loadExtensionMarket();
    addLog("DONE", result.message);
    showToast(result.message);
  } catch (error) {
    const message = normalizeError(error);
    addLog("WARN", `市场安装失败: ${message}`);
    showToast("市场安装失败.", "warning");
  } finally {
    state.extensionRunning = false;
    setButtonBusy(triggerButton, false);
    setExtensionActivity(false);
  }
}

function renderExtensionInventory(inventory) {
  state.extensionInventory = inventory;
  $("#extensionMcpCount").textContent = formatNumber(inventory.activeMcpCount);
  $("#extensionSkillCount").textContent = formatNumber(inventory.enabledSkillCount);
  $("#extensionPromptCount").textContent = formatNumber(inventory.enabledPromptCount || 0);
  $("#extensionPromptDescription").textContent = inventory.promptNote || "管理当前目标的文件化提示词规则.";
  $("#addPromptButton").disabled = inventory.promptEditable === false;
  document.querySelector('[data-open-extension-location="prompt"]').disabled = inventory.promptEditable === false;
  $("#extensionConfigPath").textContent = inventory.mcpConfigPath;
  $("#extensionConfigPath").title = inventory.mcpConfigPath;
  $("#extensionScopeNote").textContent = inventory.note;
  const extensionBadge = $("#extensionNavBadge");
  extensionBadge.textContent = `${inventory.activeMcpCount}/${inventory.enabledSkillCount}/${inventory.enabledPromptCount || 0}`;
  extensionBadge.title = `MCP ${inventory.activeMcpCount}, Skill ${inventory.enabledSkillCount}, 提示词 ${inventory.enabledPromptCount || 0}`;
  extensionBadge.setAttribute("aria-label", extensionBadge.title);
  renderExtensionMcp(inventory.mcpServers || []);
  renderExtensionSkills(inventory.skills || []);
  renderExtensionPrompts(inventory.prompts || []);
  const mcpIssues = (inventory.mcpServers || []).filter((server) => {
    const health = state.extensionMcpHealth[extensionMcpHealthKey(server.name)];
    return server.localModified || health?.status === "failed";
  }).length;
  const skillIssues = (inventory.skills || []).filter((skill) => skill.localModified || ["high", "invalid"].includes(skill.audit?.riskLevel)).length;
  const promptIssues = (inventory.prompts || []).filter((prompt) => prompt.localModified).length;
  const issues = mcpIssues + skillIssues + promptIssues;
  $("#extensionRiskBanner").classList.toggle("hidden", !issues);
  $("#extensionRiskBanner").textContent = issues
    ? `发现 ${issues} 个需要关注的扩展: MCP ${mcpIssues}, Skill ${skillIssues}, 提示词 ${promptIssues}. 可以使用“仅异常或风险”筛选查看.`
    : "";
  $("#extensionOverviewIssues").textContent = formatNumber(issues);
  $("#extensionOverviewMcp").textContent = formatNumber((inventory.mcpServers || []).length);
  $("#extensionOverviewSkills").textContent = formatNumber((inventory.skills || []).filter((skill) => !skill.builtIn).length);
  $("#extensionOverviewState").textContent = issues ? "需要关注" : "状态正常";
  $("#extensionOverviewState").className = `pill ${issues ? "warning" : "success"}`;
  $("#extensionOverviewMessage").textContent = issues
    ? `检测到 ${issues} 个连接失败、高风险或本地修改项目.`
    : "当前扫描范围没有发现高风险或本地修改项目.";
  extensionBadge.classList.toggle("warn", Boolean(issues));
  updateExtensionSelectionControls();
  if (inventory.promptEditable === false) {
    $("#extensionPromptList").replaceChildren();
    setExtensionEmptyState("Prompt", inventory.promptNote);
  }
}

async function loadExtensionInventory() {
  if (state.extensionLoading) return;
  await loadExtensionTargets();
  updateExtensionControls();
  if (state.extensionScope === "project" && !state.extensionWorkspace) {
    state.extensionInventory = null;
    $("#extensionMcpList").replaceChildren();
    $("#extensionSkillList").replaceChildren();
    $("#extensionPromptList").replaceChildren();
    setExtensionEmptyState("Mcp", "请先选择要管理的工作区.");
    setExtensionEmptyState("Skill", "请先选择要管理的工作区.");
    setExtensionEmptyState("Prompt", "请先选择要管理的工作区.");
    $("#extensionConfigPath").textContent = "尚未选择工作区";
    $("#extensionScopeNote").textContent = "项目级配置不会影响其他项目";
    return;
  }
  state.extensionLoading = true;
  const button = $("#refreshExtensionsButton");
  button.disabled = true;
  button.classList.add("scanning");
  setExtensionActivity(true, "正在刷新扩展配置", "正在扫描当前目标和作用域中的 MCP, Skill 与提示词.");
  setExtensionEmptyState("Mcp", "正在读取 MCP 配置...");
  setExtensionEmptyState("Skill", "正在扫描 Skill...");
  setExtensionEmptyState("Prompt", "正在扫描提示词...");
  try {
    const query = extensionQuery();
    const inventory = invoke
      ? await invoke("extension_inventory", { query })
      : browserFallbackExtensionInventory(query);
    renderExtensionInventory(inventory);
    addLog("DONE", `${inventory.targetLabel} 扩展配置已刷新.`);
  } catch (error) {
    const message = normalizeError(error);
    setExtensionEmptyState("Mcp", message, true);
    setExtensionEmptyState("Skill", message, true);
    setExtensionEmptyState("Prompt", message, true);
    addLog("WARN", `扩展配置读取失败: ${message}`);
  } finally {
    state.extensionLoading = false;
    button.disabled = false;
    button.classList.remove("scanning");
    setExtensionActivity(false);
  }
}

async function chooseExtensionWorkspace() {
  try {
    const path = invoke
      ? await invoke("choose_extension_workspace")
      : "D:\\workspace\\demo-project";
    if (!path) return;
    state.extensionWorkspace = path;
    updateExtensionControls();
    await loadExtensionInventory();
  } catch (error) {
    const message = normalizeError(error);
    addLog("WARN", `选择工作区失败: ${message}`);
    showToast("无法选择工作区.", "warning");
  }
}

function closeMcpEditor() {
  if (state.extensionRunning) return;
  $("#mcpEditorBackdrop").classList.add("hidden");
}

function updateMcpEditorTransport() {
  const transport = $("#mcpTransportSelect").value;
  const stdio = transport === "stdio";
  $("#mcpCommandField").classList.toggle("hidden", !stdio);
  $("#mcpArgsField").classList.toggle("hidden", !stdio);
  $("#mcpEnvField").classList.toggle("hidden", !stdio);
  $("#mcpUrlField").classList.toggle("hidden", stdio);
  $("#mcpHeadersField").classList.toggle("hidden", stdio);
}

function fieldsToText(fields) {
  return (fields || []).map((field) => `${field.key}=${field.value}`).join("\n");
}

function browserFallbackMcpDetails(name) {
  const server = state.extensionInventory?.mcpServers.find((item) => item.name === name);
  return {
    name,
    transport: server?.transport || "stdio",
    command: server?.transport === "stdio" ? server.endpoint : "",
    url: server?.transport === "stdio" ? "" : server?.endpoint || "",
    args: Array.from({ length: server?.argsCount || 0 }, (_, index) => `argument-${index + 1}`),
    env: (server?.envKeys || []).map((key) => ({ key, value: "••••••" })),
    headers: (server?.headerKeys || []).map((key) => ({ key, value: "••••••" })),
    enabled: server?.enabled ?? true,
  };
}

async function openMcpEditor(name = "") {
  $("#mcpEditorMessage").textContent = "";
  $("#mcpEditorTitle").textContent = name ? "编辑 MCP 服务" : "添加 MCP 服务";
  $("#mcpOriginalName").value = name;
  $("#mcpNameInput").value = name;
  $("#mcpTransportSelect").value = "stdio";
  $("#mcpCommandInput").value = "";
  $("#mcpUrlInput").value = "";
  $("#mcpArgsInput").value = "";
  $("#mcpEnvInput").value = "";
  $("#mcpHeadersInput").value = "";
  $("#mcpEnabledCheckbox").checked = true;
  $("#mcpEditorBackdrop").classList.remove("hidden");
  window.requestAnimationFrame(() => $("#mcpNameInput").focus());
  if (name) {
    try {
      const request = { ...extensionQuery(), name };
      const details = invoke
        ? await invoke("extension_mcp_details", { request })
        : browserFallbackMcpDetails(name);
      $("#mcpNameInput").value = details.name;
      $("#mcpTransportSelect").value = details.transport;
      $("#mcpCommandInput").value = details.command || "";
      $("#mcpUrlInput").value = details.url || "";
      $("#mcpArgsInput").value = (details.args || []).join("\n");
      $("#mcpEnvInput").value = fieldsToText(details.env);
      $("#mcpHeadersInput").value = fieldsToText(details.headers);
      $("#mcpEnabledCheckbox").checked = details.enabled;
    } catch (error) {
      $("#mcpEditorMessage").textContent = normalizeError(error);
    }
  }
  updateMcpEditorTransport();
}

function parseSecretFieldText(value) {
  const fields = [];
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) throw new Error(`字段格式错误: ${trimmed}. 请使用 KEY=VALUE.`);
    fields.push({ key: trimmed.slice(0, separator).trim(), value: trimmed.slice(separator + 1) });
  }
  return fields;
}

async function saveMcpEditor() {
  if (state.extensionRunning) return;
  let request;
  try {
    request = {
      ...extensionQuery(),
      originalName: $("#mcpOriginalName").value || null,
      name: $("#mcpNameInput").value.trim(),
      transport: $("#mcpTransportSelect").value,
      command: $("#mcpCommandInput").value.trim(),
      url: $("#mcpUrlInput").value.trim(),
      args: $("#mcpArgsInput").value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
      env: parseSecretFieldText($("#mcpEnvInput").value),
      headers: parseSecretFieldText($("#mcpHeadersInput").value),
      enabled: $("#mcpEnabledCheckbox").checked,
    };
  } catch (error) {
    $("#mcpEditorMessage").textContent = normalizeError(error);
    return;
  }
  state.extensionRunning = true;
  $("#mcpEditorSaveButton").disabled = true;
  $("#mcpEditorMessage").textContent = "正在保存并备份原配置...";
  try {
    const result = invoke
      ? await invoke("extension_save_mcp", { request })
      : { message: `MCP 服务 ${request.name} 已保存`, inventory: browserFallbackExtensionInventory(extensionQuery()) };
    renderExtensionInventory(result.inventory);
    $("#mcpEditorBackdrop").classList.add("hidden");
    addLog("DONE", result.message);
    showToast(result.message);
  } catch (error) {
    const message = normalizeError(error);
    $("#mcpEditorMessage").textContent = message;
    addLog("WARN", `MCP 保存失败: ${message}`);
  } finally {
    state.extensionRunning = false;
    $("#mcpEditorSaveButton").disabled = false;
  }
}

async function toggleMcp(name) {
  const server = state.extensionInventory?.mcpServers.find((item) => item.name === name);
  if (!server || state.extensionRunning) return;
  state.extensionRunning = true;
  try {
    const request = { ...extensionQuery(), name, enabled: !server.enabled };
    const result = invoke
      ? await invoke("extension_toggle_mcp", { request })
      : { message: `MCP 服务 ${name} 已${request.enabled ? "启用" : "停用"}`, inventory: browserFallbackExtensionInventory(extensionQuery()) };
    renderExtensionInventory(result.inventory);
    addLog("DONE", result.message);
    showToast(result.message);
  } catch (error) {
    const message = normalizeError(error);
    addLog("WARN", `MCP 状态修改失败: ${message}`);
    showToast("MCP 状态修改失败.", "warning");
  } finally {
    state.extensionRunning = false;
  }
}

async function deleteMcp(name) {
  if (state.extensionRunning) return;
  if (!window.confirm(`确定删除 MCP 服务“${name}”吗? 原配置会先保存到工作台备份目录.`)) return;
  state.extensionRunning = true;
  try {
    const request = { ...extensionQuery(), name };
    const result = invoke
      ? await invoke("extension_delete_mcp", { request })
      : { message: `MCP 服务 ${name} 已删除`, inventory: browserFallbackExtensionInventory(extensionQuery()) };
    renderExtensionInventory(result.inventory);
    addLog("DONE", result.message);
    showToast(result.message);
  } catch (error) {
    const message = normalizeError(error);
    addLog("WARN", `MCP 删除失败: ${message}`);
    showToast("MCP 删除失败.", "warning");
  } finally {
    state.extensionRunning = false;
  }
}

function closeSkillEditor() {
  if (state.extensionRunning) return;
  $("#skillEditorBackdrop").classList.add("hidden");
}

function defaultSkillContent() {
  return `---\nname: new-skill\ndescription: 当用户提出对应任务时使用\n---\n\n# Instructions\n\n- 明确触发条件.\n- 按步骤完成任务并验证结果.\n`;
}

async function openSkillEditor(name = "", enabled = true) {
  $("#skillEditorMessage").textContent = "";
  $("#skillEditorTitle").textContent = name ? "编辑 Skill" : "新建 Skill";
  $("#skillOriginalName").value = name;
  $("#skillNameInput").value = name || "new-skill";
  $("#skillContentInput").value = defaultSkillContent();
  $("#skillEnabledCheckbox").checked = enabled;
  $("#skillEditorBackdrop").classList.remove("hidden");
  window.requestAnimationFrame(() => $("#skillNameInput").focus());
  if (!name) return;
  try {
    const request = { ...extensionQuery(), name, enabled };
    const details = invoke
      ? await invoke("extension_skill_details", { request })
      : { name, content: `---\nname: ${name}\ndescription: 浏览器预览 Skill\n---\n\n# Instructions\n`, enabled, builtIn: false };
    $("#skillNameInput").value = details.name;
    $("#skillContentInput").value = details.content;
    $("#skillEnabledCheckbox").checked = details.enabled;
  } catch (error) {
    $("#skillEditorMessage").textContent = normalizeError(error);
  }
}

async function saveSkillEditor() {
  if (state.extensionRunning) return;
  const request = {
    ...extensionQuery(),
    originalName: $("#skillOriginalName").value || null,
    name: $("#skillNameInput").value.trim(),
    content: $("#skillContentInput").value,
    enabled: $("#skillEnabledCheckbox").checked,
  };
  state.extensionRunning = true;
  $("#skillEditorSaveButton").disabled = true;
  $("#skillEditorMessage").textContent = "正在保存 Skill...";
  try {
    const result = invoke
      ? await invoke("extension_save_skill", { request })
      : { message: `Skill ${request.name} 已保存`, inventory: browserFallbackExtensionInventory(extensionQuery()) };
    renderExtensionInventory(result.inventory);
    $("#skillEditorBackdrop").classList.add("hidden");
    addLog("DONE", result.message);
    showToast(result.message);
  } catch (error) {
    const message = normalizeError(error);
    $("#skillEditorMessage").textContent = message;
    addLog("WARN", `Skill 保存失败: ${message}`);
  } finally {
    state.extensionRunning = false;
    $("#skillEditorSaveButton").disabled = false;
  }
}

async function toggleSkill(name, enabled) {
  if (state.extensionRunning) return;
  state.extensionRunning = true;
  try {
    const request = { ...extensionQuery(), name, enabled: !enabled };
    const result = invoke
      ? await invoke("extension_toggle_skill", { request })
      : { message: `Skill ${name} 已${request.enabled ? "启用" : "停用"}`, inventory: browserFallbackExtensionInventory(extensionQuery()) };
    renderExtensionInventory(result.inventory);
    addLog("DONE", result.message);
    showToast(result.message);
  } catch (error) {
    const message = normalizeError(error);
    addLog("WARN", `Skill 状态修改失败: ${message}`);
    showToast("Skill 状态修改失败.", "warning");
  } finally {
    state.extensionRunning = false;
  }
}

async function deleteSkill(name, enabled) {
  if (state.extensionRunning) return;
  if (!window.confirm(`确定删除 Skill“${name}”吗? 它会被移动到工作台回收目录.`)) return;
  state.extensionRunning = true;
  try {
    const request = { ...extensionQuery(), name, enabled };
    const result = invoke
      ? await invoke("extension_delete_skill", { request })
      : { message: `Skill ${name} 已移入回收目录`, inventory: browserFallbackExtensionInventory(extensionQuery()) };
    renderExtensionInventory(result.inventory);
    addLog("DONE", result.message);
    showToast(result.message);
  } catch (error) {
    const message = normalizeError(error);
    addLog("WARN", `Skill 删除失败: ${message}`);
    showToast("Skill 删除失败.", "warning");
  } finally {
    state.extensionRunning = false;
  }
}

function closePromptEditor() {
  if (state.extensionRunning) return;
  $("#promptEditorBackdrop").classList.add("hidden");
}

function defaultPromptContent() {
  const cursorFields = state.extensionTarget === "cursor" ? "\nglobs:\nalwaysApply: true" : "";
  return `---\nname: engineering-quality\ndescription: 工程质量和验证规则${cursorFields}\n---\n\n处理任务时先检查现状和约束. 修改后完成直接相关的验证.\n`;
}

async function openPromptEditor(name = "", enabled = true) {
  $("#promptEditorMessage").textContent = "";
  $("#promptEditorTitle").textContent = name ? "编辑提示词" : "新建提示词";
  $("#promptOriginalName").value = name;
  $("#promptNameInput").value = name || "engineering-quality";
  $("#promptContentInput").value = defaultPromptContent();
  $("#promptEnabledCheckbox").checked = enabled;
  $("#promptEditorBackdrop").classList.remove("hidden");
  window.requestAnimationFrame(() => $("#promptNameInput").focus());
  if (!name) return;
  try {
    const request = { ...extensionQuery(), name, enabled };
    const details = invoke
      ? await invoke("extension_prompt_details", { request })
      : { name, content: defaultPromptContent(), enabled };
    $("#promptNameInput").value = details.name;
    $("#promptContentInput").value = details.content;
    $("#promptEnabledCheckbox").checked = details.enabled;
  } catch (error) {
    $("#promptEditorMessage").textContent = normalizeError(error);
  }
}

async function savePromptEditor() {
  if (state.extensionRunning) return;
  const request = {
    ...extensionQuery(),
    originalName: $("#promptOriginalName").value || null,
    name: $("#promptNameInput").value.trim(),
    content: $("#promptContentInput").value,
    enabled: $("#promptEnabledCheckbox").checked,
  };
  state.extensionRunning = true;
  $("#promptEditorSaveButton").disabled = true;
  $("#promptEditorMessage").textContent = "正在保存提示词...";
  try {
    const result = invoke
      ? await invoke("extension_save_prompt", { request })
      : { message: `提示词 ${request.name} 已保存`, inventory: browserFallbackExtensionInventory(extensionQuery()) };
    renderExtensionInventory(result.inventory);
    $("#promptEditorBackdrop").classList.add("hidden");
    addLog("DONE", result.message);
    showToast(result.message);
  } catch (error) {
    const message = normalizeError(error);
    $("#promptEditorMessage").textContent = message;
    addLog("WARN", `提示词保存失败: ${message}`);
  } finally {
    state.extensionRunning = false;
    $("#promptEditorSaveButton").disabled = false;
  }
}

async function togglePrompt(name, enabled) {
  if (state.extensionRunning) return;
  state.extensionRunning = true;
  try {
    const request = { ...extensionQuery(), name, enabled: !enabled };
    const result = invoke
      ? await invoke("extension_toggle_prompt", { request })
      : { message: `提示词 ${name} 已${request.enabled ? "启用" : "停用"}`, inventory: browserFallbackExtensionInventory(extensionQuery()) };
    renderExtensionInventory(result.inventory);
    addLog("DONE", result.message);
    showToast(result.message);
  } catch (error) {
    const message = normalizeError(error);
    addLog("WARN", `提示词状态修改失败: ${message}`);
    showToast("提示词状态修改失败.", "warning");
  } finally {
    state.extensionRunning = false;
  }
}

async function deletePrompt(name, enabled) {
  if (state.extensionRunning) return;
  if (!window.confirm(`确定删除提示词“${name}”吗? 它会被移动到工作台回收目录.`)) return;
  state.extensionRunning = true;
  try {
    const request = { ...extensionQuery(), name, enabled };
    const result = invoke
      ? await invoke("extension_delete_prompt", { request })
      : { message: `提示词 ${name} 已移入回收目录`, inventory: browserFallbackExtensionInventory(extensionQuery()) };
    renderExtensionInventory(result.inventory);
    addLog("DONE", result.message);
    showToast(result.message);
  } catch (error) {
    const message = normalizeError(error);
    addLog("WARN", `提示词删除失败: ${message}`);
    showToast("提示词删除失败.", "warning");
  } finally {
    state.extensionRunning = false;
  }
}

async function openExtensionLocation(kind) {
  try {
    if (invoke) await invoke("open_extension_location", { query: extensionQuery(), kind });
    else showToast(`浏览器预览: 已请求打开 ${kind === "mcp" ? "MCP 配置" : kind === "skill" ? "Skill" : "提示词"} 目录.`);
  } catch (error) {
    const message = normalizeError(error);
    addLog("WARN", `打开扩展目录失败: ${message}`);
    showToast("无法打开扩展目录.", "warning");
  }
}

async function scanApps() {
  const button = $("#scanButton");
  button.classList.add("scanning");
  button.disabled = true;
  $("#headerStatus").textContent = "正在扫描本机软件";
  addLog("INFO", "开始扫描 Cursor 和 Claude Desktop.");

  try {
    const apps = invoke ? await invoke("detect_apps") : browserFallbackApps();
    state.apps = apps;
    apps.forEach((app) => {
      updateAppCard(app);
      updateBackupCard(app);
    });
    const backupReady = apps.filter((app) => app.backupAvailable).length;
    $("#detectedCount").textContent = apps.filter((app) => app.installed).length;
    $("#localizedCount").textContent = apps.filter((app) => app.localized).length;
    $("#adapterCount").textContent = backupReady;
    $("#backupNavBadge").textContent = `${backupReady}/${apps.length}`;
    updateBackupActionButtons();
    const selected = selectedStatus();
    if (selected && !$("#modalBackdrop").classList.contains("hidden")) {
      updateModalBackupGate(selected);
      updateActionButtons();
    }
    await loadBackups();
    addLog("DONE", `扫描完成, ${apps.filter((app) => app.installed).length}/2 个应用已检测.`);
  } catch (error) {
    addLog("WARN", `扫描失败: ${normalizeError(error)}`);
    showToast("扫描失败, 请查看运行日志.", "warning");
  } finally {
    button.classList.remove("scanning");
    button.disabled = false;
    $("#headerStatus").textContent = "服务运行正常";
  }
}

function selectedStatus() {
  return state.apps.find((app) => app.id === state.selectedApp);
}

function renderLocales(app) {
  const container = $("#languageOptions");
  container.replaceChildren();
  state.locale = app.locales[0]?.id || "zh-cn";
  for (const [index, locale] of app.locales.entries()) {
    const button = document.createElement("button");
    button.className = `language-option${index === 0 ? " selected" : ""}`;
    button.dataset.locale = locale.id;
    button.innerHTML = "<strong></strong><span></span>";
    button.querySelector("strong").textContent = locale.label;
    button.querySelector("span").textContent = locale.tag;
    button.addEventListener("click", () => {
      $$(".language-option").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
      state.locale = locale.id;
    });
    container.appendChild(button);
  }
  container.classList.toggle("single-option", app.locales.length === 1);
}

function updateActionButtons() {
  const app = selectedStatus();
  if (!app) return;
  const installButton = $("#installButton");
  const restoreButton = $("#restoreButton");
  restoreButton.className = "danger-button";
  if (state.modalCompletedAction) {
    $("#previewButton").disabled = true;
    const restored = state.modalCompletedAction === "restore";
    installButton.disabled = restored;
    installButton.textContent = restored ? "安装汉化" : "完成";
    installButton.title = restored ? "" : "关闭当前操作窗口";
    restoreButton.disabled = !restored;
    restoreButton.textContent = restored ? "完成" : "恢复原版";
    restoreButton.title = restored ? "关闭当前操作窗口" : "";
    if (restored) restoreButton.className = "primary-button completion-button";
    return;
  }
  const consent = $("#consentCheckbox").checked;
  const needsAdmin = !state.environment.isAdmin && (app.id === "claude" || state.environment.platform === "macos");
  $("#previewButton").disabled = state.running || !app.ready;
  installButton.disabled = state.running || !app.ready || !app.backupAvailable || !consent || needsAdmin;
  restoreButton.disabled = state.running || !app.ready || !app.backupAvailable || !consent || needsAdmin;
  restoreButton.textContent = "恢复原版";
  restoreButton.title = "";
  installButton.textContent = "安装汉化";
  installButton.title = app.backupAvailable ? "" : "必须先在备份选项卡创建并校验备份";
}

function updateModalBackupGate(app) {
  const ready = Boolean(app.backupAvailable);
  const gate = $("#modalBackupGate");
  gate.classList.toggle("ready", ready);
  $("#modalBackupIcon").textContent = ready ? "✓" : "!";
  $("#modalBackupTitle").textContent = ready ? "备份已校验" : "必须先完成备份";
  $("#modalBackupText").textContent = ready
    ? `${app.backupFiles || 0} 个文件已通过完整性校验, 可以安装汉化.`
    : app.backupMessage || "请前往备份选项卡创建并校验当前版本备份.";
  $("#goBackupButton").hidden = ready;
}

function openModal(appId) {
  const app = state.apps.find((item) => item.id === appId);
  if (!app?.ready) {
    showToast(app?.reason || "该应用尚未就绪.", "warning");
    return;
  }
  state.selectedApp = appId;
  state.modalCompletedAction = null;
  $("#modalTitle").textContent = `配置 ${app.name} 汉化`;
  $("#modalVersion").textContent = `版本: ${app.version || "未知"}`;
  $("#modalState").textContent = app.state;
  $("#modalLogo").className = `app-logo ${appId === "claude" ? "claude-logo" : "cursor-logo"}`;
  $("#modalLogo").textContent = appId === "claude" ? "AI" : "C";
  $("#safetyText").innerHTML = appId === "claude"
    ? "<strong>自动兼容资源模式</strong><br>自动定位最新版本并校验 3 个 en-US.json, 不修改 app.asar 或客户端配置. macOS 修改后会执行本机 ad-hoc 重签名."
    : "<strong>自动兼容引擎模式</strong><br>按资源结构发现新入口包, 安装前执行严格语法预检, 版本备份和事务化恢复.";
  updateModalBackupGate(app);
  renderLocales(app);
  const needsAdmin = !state.environment.isAdmin && (appId === "claude" || state.environment.platform === "macos");
  $("#adminNote").classList.toggle("hidden", !needsAdmin);
  $("#adminNoteTitle").textContent = `${app.name} 安装需要管理员权限`;
  $("#adminNoteText").textContent = state.environment.platform === "macos"
    ? "Applications 目录和应用签名受系统保护. 预检不需要提权, 安装和恢复需要输入 Mac 登录密码."
    : "WindowsApps 默认受保护. 预检不需要提权, 安装和恢复需要重新启动工作台.";
  $("#consentCheckbox").checked = false;
  $("#progressWrap").classList.add("hidden");
  $("#progressBar").style.width = "0%";
  $("#progressValue").textContent = "0%";
  $("#operationMessage").textContent = app.reason || "";
  $("#modalBackdrop").classList.remove("hidden");
  window.requestAnimationFrame(() => $("#consentCheckbox").focus());
  updateActionButtons();
}

function closeModal() {
  if (state.running) return;
  $("#modalBackdrop").classList.add("hidden");
}

function setProgress(percent, message) {
  $("#progressWrap").classList.remove("hidden");
  $("#progressText").textContent = message;
  $("#progressValue").textContent = `${percent}%`;
  $("#progressBar").style.width = `${percent}%`;
}

function setBackupProgress(appId, percent, message) {
  $(`#${appId}BackupProgress`).classList.remove("hidden");
  $(`#${appId}BackupProgressText`).textContent = message;
  $(`#${appId}BackupProgressValue`).textContent = `${percent}%`;
  $(`#${appId}BackupProgressBar`).style.width = `${percent}%`;
}

function setBackupRestoreProgress(percent, message) {
  $("#backupRestoreProgress").classList.remove("hidden");
  $("#backupRestoreProgressText").textContent = message;
  $("#backupRestoreProgressValue").textContent = `${percent}%`;
  $("#backupRestoreProgressBar").style.width = `${percent}%`;
}

async function runBackup(appId) {
  const app = state.apps.find((item) => item.id === appId);
  if (!app?.ready || state.running) return;
  if (!invoke) {
    showToast("浏览器预览模式不会执行本机备份.", "warning");
    return;
  }
  if (!$("#backupConsentCheckbox").checked) {
    showToast("请先确认已保存工作并同意关闭目标应用.", "warning");
    return;
  }

  state.running = true;
  state.activeOperation = { appId, action: "backup", source: "backup" };
  updateBackupActionButtons();
  updateActionButtons();
  $("#scanButton").disabled = true;
  $("#headerStatus").textContent = `正在备份 ${app.name}`;
  $("#activitySubtitle").textContent = `${app.name}: 创建并校验完整备份`;
  setBackupProgress(appId, 3, "正在启动备份适配器...");
  addLog("INFO", `${app.name} 开始创建并校验当前版本原始备份.`);

  try {
    const result = await invoke("run_app_action", {
      request: { appId, action: "backup", locale: app.locales[0]?.id || "zh-cn" },
    });
    setBackupProgress(appId, 100, result.title);
    addLog("DONE", `${result.title}: ${result.message}`);
    showToast(result.title);
    await scanApps();
  } catch (error) {
    const message = normalizeError(error);
    setBackupProgress(appId, 100, "备份未通过校验");
    $(`#${appId}BackupMessage`).textContent = message;
    addLog("WARN", `${app.name} 备份失败: ${message}`);
    showToast("备份失败, 请查看运行日志.", "warning");
  } finally {
    state.running = false;
    state.activeOperation = null;
    $("#scanButton").disabled = false;
    $("#headerStatus").textContent = "服务运行正常";
    updateBackupActionButtons();
    updateActionButtons();
    updateBackupHistoryButtons();
  }
}

async function runBackupRestore(recordId) {
  const record = state.backups.find((item) => item.id === recordId);
  if (!record || state.running) return;
  const blocked = restoreBlockedReason(record);
  if (!record.canRestore || blocked) {
    showToast(blocked || record.detail || "当前备份不可恢复.", "warning");
    return;
  }
  if (!invoke) {
    showToast("浏览器预览模式不会执行本机恢复.", "warning");
    return;
  }

  const app = state.apps.find((item) => item.id === record.appId);
  state.running = true;
  state.activeOperation = { appId: record.appId, action: "restore", source: "history" };
  updateBackupActionButtons();
  updateActionButtons();
  updateBackupHistoryButtons();
  $("#scanButton").disabled = true;
  $("#headerStatus").textContent = `正在恢复 ${record.appName}`;
  $("#activitySubtitle").textContent = `${record.appName}: 从 ${record.version} 备份恢复原版`;
  setBackupRestoreProgress(3, "正在启动恢复适配器...");
  addLog("INFO", `${record.appName} 开始从版本 ${record.version} 的完整备份恢复原版.`);

  try {
    const result = await invoke("run_app_action", {
      request: {
        appId: record.appId,
        action: "restore",
        locale: app?.locales?.[0]?.id || "zh-cn",
        backupVersion: record.version,
      },
    });
    setBackupRestoreProgress(100, result.title);
    addLog("DONE", `${result.title}: ${result.message}`);
    showToast(result.title);
    await scanApps();
  } catch (error) {
    const message = normalizeError(error);
    setBackupRestoreProgress(100, "恢复失败");
    addLog("WARN", `${record.appName} 恢复失败: ${message}`);
    showToast("恢复失败, 请查看运行日志.", "warning");
  } finally {
    state.running = false;
    state.activeOperation = null;
    $("#scanButton").disabled = false;
    $("#headerStatus").textContent = "服务运行正常";
    updateBackupActionButtons();
    updateActionButtons();
    updateBackupHistoryButtons();
  }
}

async function runAction(action) {
  const app = selectedStatus();
  if (!app || state.running) return;
  if (!invoke) {
    showToast("浏览器预览模式不会执行本机操作.", "warning");
    return;
  }
  if (action === "install" && !app.backupAvailable) {
    showToast("必须先在备份选项卡创建并校验备份.", "warning");
    return;
  }
  if (action !== "preview" && !$("#consentCheckbox").checked) return;

  state.running = true;
  state.activeOperation = { appId: app.id, action, source: "modal" };
  updateActionButtons();
  updateBackupActionButtons();
  $("#modalCloseButton").disabled = true;
  $("#headerStatus").textContent = `正在处理 ${app.name}`;
  $("#activitySubtitle").textContent = `${app.name}: ${action === "install" ? "安装汉化" : action === "restore" ? "恢复原版" : "安全预检"}`;
  $("#operationMessage").textContent = "";
  setProgress(3, "正在启动适配器...");
  addLog("INFO", `${app.name} 开始${action === "install" ? "安装汉化" : action === "restore" ? "恢复原版" : "安全预检"}.`);

  try {
    const result = await invoke("run_app_action", {
      request: {
        appId: app.id,
        action,
        locale: state.locale,
        backupVersion: action === "restore" ? app.version : null,
      },
    });
    setProgress(100, result.title);
    $("#operationMessage").textContent = result.message;
    addLog("DONE", `${result.title}: ${result.message}`);
    showToast(result.title);
    if (action === "install" || action === "restore") state.modalCompletedAction = action;
    await scanApps();
  } catch (error) {
    const message = normalizeError(error);
    $("#operationMessage").textContent = message;
    if (message.includes("管理员身份重新启动汉化工作台")) {
      $("#adminNote").classList.remove("hidden");
      $("#adminNoteTitle").textContent = "需要管理员权限结束 Cursor";
      $("#adminNoteText").textContent = "Cursor 进程树已自动清理但仍有受保护进程. 点击管理员重启后再次执行操作.";
    }
    addLog("WARN", `${app.name} 操作失败: ${message}`);
    showToast("操作失败, 请查看运行日志.", "warning");
  } finally {
    state.running = false;
    state.activeOperation = null;
    $("#modalCloseButton").disabled = false;
    $("#headerStatus").textContent = "服务运行正常";
    updateActionButtons();
    updateBackupActionButtons();
    updateBackupHistoryButtons();
  }
}

async function registerProgressListener() {
  if (!listen) return;
  await listen("operation-progress", ({ payload }) => {
    if (payload.appId !== state.activeOperation?.appId || payload.action !== state.activeOperation?.action) return;
    if (payload.action === "backup") setBackupProgress(payload.appId, payload.percent, payload.message);
    else if (state.activeOperation?.source === "history") setBackupRestoreProgress(payload.percent, payload.message);
    else setProgress(payload.percent, payload.message);
    addLog(payload.level, payload.message);
  });
  await listen("update-download-progress", ({ payload }) => {
    if (!state.updateDownloading) return;
    setUpdateDownloadProgress(payload.percent, payload.message);
  });
}

function activateSection(section) {
  $$(`.nav-item[data-section]`).forEach((item) => {
    const active = item.dataset.section === section;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  const content = $(".content");
  const aboutMode = section === "about";
  const extensionMode = section === "extensions";
  content.classList.toggle("about-mode", aboutMode);
  content.classList.toggle("extensions-mode", extensionMode);
  if (aboutMode) {
    content.scrollTop = 0;
    loadGitHubAvatar();
    loadGitHubProjects();
    return;
  }
  if (extensionMode) {
    content.scrollTop = 0;
    loadExtensionInventory();
    return;
  }
  document.getElementById(section)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

$$(`.nav-item[data-section]`).forEach((button) => {
  button.addEventListener("click", () => activateSection(button.dataset.section));
});

$("#extensionTargetSegment").addEventListener("click", (event) => {
  const button = event.target.closest("[data-extension-target]");
  if (button) {
    state.extensionTarget = button.dataset.extensionTarget;
    invalidateExtensionTransferPreview();
    state.extensionSelection.clear();
    state.extensionMarket = [];
    state.extensionHistory = [];
    loadExtensionInventory();
    if (state.extensionTab === "market") loadExtensionMarket();
    if (state.extensionTab === "history") loadExtensionHistory();
  }
});
$$(`[data-extension-scope]`).forEach((button) => {
  button.addEventListener("click", () => {
    state.extensionScope = button.dataset.extensionScope;
    invalidateExtensionTransferPreview();
    state.extensionSelection.clear();
    state.extensionMarket = [];
    state.extensionHistory = [];
    loadExtensionInventory();
    if (state.extensionTab === "market") loadExtensionMarket();
    if (state.extensionTab === "history") loadExtensionHistory();
  });
});
const extensionTabButtons = $$(`[data-extension-tab]`);
extensionTabButtons.forEach((button, index) => {
  button.addEventListener("click", () => {
    state.extensionTab = button.dataset.extensionTab;
    updateExtensionControls();
    if (state.extensionTab === "market") loadExtensionMarket();
    if (state.extensionTab === "history") loadExtensionHistory();
  });
  button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? extensionTabButtons.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + extensionTabButtons.length) % extensionTabButtons.length;
    extensionTabButtons[nextIndex].focus();
    extensionTabButtons[nextIndex].click();
  });
});
$$(`[data-open-extension-location]`).forEach((button) => {
  button.addEventListener("click", () => openExtensionLocation(button.dataset.openExtensionLocation));
});
$("#refreshExtensionsButton").addEventListener("click", loadExtensionInventory);
$("#chooseExtensionWorkspaceButton").addEventListener("click", chooseExtensionWorkspace);
$("#addMcpButton").addEventListener("click", () => openMcpEditor());
$("#checkAllMcpButton").addEventListener("click", checkAllMcp);
$("#addSkillButton").addEventListener("click", () => openSkillEditor());
$("#addPromptButton").addEventListener("click", () => openPromptEditor());
$("#refreshMarketButton").addEventListener("click", loadExtensionMarket);
$("#refreshExtensionHistoryButton").addEventListener("click", loadExtensionHistory);
$("#previewExtensionCopyButton").addEventListener("click", previewExtensionCopy);
$("#exportRedactedBundleButton").addEventListener("click", () => exportExtensionBundle(false));
$("#exportPrivateBundleButton").addEventListener("click", () => exportExtensionBundle(true));
$("#chooseExtensionImportButton").addEventListener("click", chooseAndPreviewExtensionImport);
$("#previewSelectedImportButton").addEventListener("click", previewSelectedExtensionImport);
$("#extensionImportPassword").addEventListener("input", () => {
  if (state.extensionTransferMode === "import") invalidateExtensionTransferPreview();
});
$("#applyExtensionTransferButton").addEventListener("click", applyExtensionTransfer);
$("#extensionSearchInput").addEventListener("input", (event) => {
  state.extensionSearch = event.target.value;
  if (state.extensionInventory) renderExtensionInventory(state.extensionInventory);
});
$("#extensionStatusFilter").addEventListener("change", (event) => {
  state.extensionStatusFilter = event.target.value;
  if (state.extensionInventory) renderExtensionInventory(state.extensionInventory);
});
$("#clearExtensionSelectionButton").addEventListener("click", clearExtensionSelection);
$("#batchEnableExtensionsButton").addEventListener("click", () => batchToggleExtensions(true));
$("#batchDisableExtensionsButton").addEventListener("click", () => batchToggleExtensions(false));
$("#extensions").addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-extension-select-kind]");
  if (!checkbox) return;
  const key = extensionSelectionKey(checkbox.dataset.extensionSelectKind, checkbox.dataset.extensionSelectName);
  if (checkbox.checked) state.extensionSelection.add(key);
  else state.extensionSelection.delete(key);
  updateExtensionSelectionControls();
});
$("#openExtensionsOverviewButton").addEventListener("click", () => {
  document.querySelector('.nav-item[data-section="extensions"]')?.click();
});
try {
  $("#extensionQuickStartGuide").classList.toggle("hidden", localStorage.getItem(EXTENSION_GUIDE_KEY) === "dismissed");
} catch {}
$("#dismissExtensionGuideButton").addEventListener("click", () => {
  $("#extensionQuickStartGuide").classList.add("hidden");
  try { localStorage.setItem(EXTENSION_GUIDE_KEY, "dismissed"); } catch {}
});
$("#extensionMcpList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-extension-action]");
  if (!button) return;
  if (handleCommonExtensionAction(button)) return;
  const name = button.dataset.extensionName;
  if (button.dataset.extensionAction === "check-mcp") checkMcp(name, button);
  if (button.dataset.extensionAction === "edit-mcp") openMcpEditor(name);
  if (button.dataset.extensionAction === "toggle-mcp") toggleMcp(name);
  if (button.dataset.extensionAction === "delete-mcp") deleteMcp(name);
});
$("#extensionSkillList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-extension-action]");
  if (!button) return;
  if (handleCommonExtensionAction(button)) return;
  const name = button.dataset.extensionName;
  const enabled = button.dataset.extensionEnabled === "true";
  if (button.dataset.extensionAction === "edit-skill") openSkillEditor(name, enabled);
  if (button.dataset.extensionAction === "toggle-skill") toggleSkill(name, enabled);
  if (button.dataset.extensionAction === "delete-skill") deleteSkill(name, enabled);
});
$("#extensionPromptList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-extension-action]");
  if (!button) return;
  if (handleCommonExtensionAction(button)) return;
  const name = button.dataset.extensionName;
  const enabled = button.dataset.extensionEnabled === "true";
  if (button.dataset.extensionAction === "edit-prompt") openPromptEditor(name, enabled);
  if (button.dataset.extensionAction === "toggle-prompt") togglePrompt(name, enabled);
  if (button.dataset.extensionAction === "delete-prompt") deletePrompt(name, enabled);
});
$("#extensionMarketList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-extension-action]");
  if (button) handleCommonExtensionAction(button);
});
$("#extensionHistoryList").addEventListener("click", (event) => {
  const button = event.target.closest('[data-extension-action="restore-history"]');
  if (button) restoreExtensionHistory(button.dataset.historyId, button);
});
$("#mcpTransportSelect").addEventListener("change", updateMcpEditorTransport);
$("#mcpEditorCloseButton").addEventListener("click", closeMcpEditor);
$("#mcpEditorCancelButton").addEventListener("click", closeMcpEditor);
$("#mcpEditorSaveButton").addEventListener("click", saveMcpEditor);
$("#skillEditorCloseButton").addEventListener("click", closeSkillEditor);
$("#skillEditorCancelButton").addEventListener("click", closeSkillEditor);
$("#skillEditorSaveButton").addEventListener("click", saveSkillEditor);
$("#promptEditorCloseButton").addEventListener("click", closePromptEditor);
$("#promptEditorCancelButton").addEventListener("click", closePromptEditor);
$("#promptEditorSaveButton").addEventListener("click", savePromptEditor);
$("#mcpEditorBackdrop").addEventListener("click", (event) => {
  if (event.target.id === "mcpEditorBackdrop") closeMcpEditor();
});
$("#skillEditorBackdrop").addEventListener("click", (event) => {
  if (event.target.id === "skillEditorBackdrop") closeSkillEditor();
});
$("#promptEditorBackdrop").addEventListener("click", (event) => {
  if (event.target.id === "promptEditorBackdrop") closePromptEditor();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!$("#promptEditorBackdrop").classList.contains("hidden")) return closePromptEditor();
  if (!$("#skillEditorBackdrop").classList.contains("hidden")) return closeSkillEditor();
  if (!$("#mcpEditorBackdrop").classList.contains("hidden")) return closeMcpEditor();
  if (!$("#modalBackdrop").classList.contains("hidden")) return closeModal();
  if (!$("#firstRunBackdrop").classList.contains("hidden")) closeFirstRunDialog();
});

$$(`[data-open-app]`).forEach((button) => button.addEventListener("click", () => openModal(button.dataset.openApp)));
$$(".backup-action[data-backup-app]").forEach((button) => button.addEventListener("click", () => runBackup(button.dataset.backupApp)));
$("#scanButton").addEventListener("click", refreshEnvironmentAndApps);
$("#nodeRuntimeRefreshButton").addEventListener("click", refreshEnvironmentAndApps);
$("#refreshUsageButton").addEventListener("click", loadUsage);
$("#checkUpdateButton").addEventListener("click", () => loadUpdateStatus({ notify: true }));
$("#downloadUpdateButton").addEventListener("click", downloadLatestUpdate);
$("#refreshProjectsButton").addEventListener("click", () => loadGitHubProjects({ force: true }));
$("#githubProjectsGrid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-project-url]");
  if (!button) return;
  openGitHubProject(button.dataset.projectUrl, button.dataset.projectAction);
});
$("#reviewConsentButton").addEventListener("click", () => showFirstRunDialog(false));
$$(`[data-project-page]`).forEach((button) => {
  button.addEventListener("click", () => openProjectPage(button.dataset.projectPage));
});
$("#modalCloseButton").addEventListener("click", closeModal);
$("#previewButton").addEventListener("click", () => runAction("preview"));
$("#installButton").addEventListener("click", () => {
  if (state.modalCompletedAction === "install") closeModal();
  else runAction("install");
});
$("#restoreButton").addEventListener("click", () => {
  if (state.modalCompletedAction === "restore") closeModal();
  else runAction("restore");
});
$("#consentCheckbox").addEventListener("change", updateActionButtons);
$("#backupConsentCheckbox").addEventListener("change", updateBackupActionButtons);
$("#restoreConsentCheckbox").addEventListener("change", updateBackupHistoryButtons);
$("#goBackupButton").addEventListener("click", () => {
  closeModal();
  activateSection("backups");
});
$("#restartAdminButton").addEventListener("click", async () => {
  try {
    await invoke("restart_as_admin");
  } catch (error) {
    addLog("WARN", `管理员重启失败: ${normalizeError(error)}`);
    showToast("管理员重启失败.", "warning");
  }
});
$("#clearLogButton").addEventListener("click", () => {
  $("#logArea").replaceChildren();
  addLog("INFO", "日志已清空.");
});
$("#modalBackdrop").addEventListener("click", (event) => {
  if (event.target.id === "modalBackdrop") closeModal();
});
$("#githubAvatar").addEventListener("load", () => {
  $("#githubAvatarFallback").hidden = true;
});
$("#githubAvatar").addEventListener("error", () => {
  $("#githubAvatar").hidden = true;
  $("#githubAvatarFallback").hidden = false;
});
$("#firstRunConsentCheckbox").addEventListener("change", (event) => {
  $("#firstRunAcceptButton").disabled = !event.target.checked;
});
$("#firstRunAcceptButton").addEventListener("click", acceptFirstRunConsent);
$("#firstRunCloseButton").addEventListener("click", closeFirstRunDialog);
$("#firstRunExitButton").addEventListener("click", () => appWindow?.close());
$("#minimizeButton").addEventListener("click", () => appWindow?.minimize());
$("#maximizeButton").addEventListener("click", () => appWindow?.toggleMaximize());
$("#closeButton").addEventListener("click", () => appWindow?.close());

window.addEventListener("DOMContentLoaded", async () => {
  await registerProgressListener();
  if (!browserPreviewSection) await waitForFirstRunConsent();
  await refreshEnvironmentAndApps();
  await Promise.all([loadUsage(), loadUpdateStatus({ notify: true })]);
  if (browserPreviewSection) {
    if (browserPreviewSection === "extensions" && ["mcp", "skill", "prompt", "market", "history", "transfer"].includes(requestedBrowserTab)) {
      state.extensionTab = requestedBrowserTab;
      updateExtensionControls();
    }
    activateSection(browserPreviewSection);
    const previewProgress = Number(requestedBrowserUpdateProgress);
    if (browserPreviewSection === "about" && requestedBrowserUpdateProgress !== null && Number.isFinite(previewProgress)) {
      setUpdateDownloadProgress(previewProgress, "浏览器预览样例: 正在流式下载更新包");
    }
    if (browserPreviewSection === "extensions" && requestedBrowserEditor === "mcp") {
      window.setTimeout(() => openMcpEditor("github"), 200);
    }
    if (browserPreviewSection === "extensions" && requestedBrowserEditor === "skill") {
      window.setTimeout(() => openSkillEditor("code-review", true), 200);
    }
  }
});
