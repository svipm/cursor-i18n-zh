const state = {
  apps: [],
  backups: [],
  usage: null,
  usageLoading: false,
  updateStatus: null,
  updateLoading: false,
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

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const tauri = window.__TAURI__;
const invoke = tauri?.core?.invoke;
const listen = tauri?.event?.listen;
const appWindow = tauri?.window?.getCurrentWindow?.();

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
      version: "preview", state: "适配器可用", stateTone: "success", adapterVersion: "0.3.7",
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
    currentVersion: "0.3.7",
    latestVersion: "0.3.7",
    updateAvailable: false,
    currentAhead: false,
    releaseUrl: "https://github.com/svipm/cursor-i18n-zh/releases",
    publishedAt: new Date().toISOString(),
    message: "浏览器预览样例: 当前 v0.3.7 已是最新版本",
  };
}

function updateEnvironmentView() {
  const elevated = state.environment.isAdmin;
  $("#permissionCard").classList.toggle("elevated", elevated);
  $("#permissionTitle").textContent = elevated ? "管理员模式" : "标准权限";
  $("#permissionText").textContent = elevated ? "可修改 WindowsApps" : "预检可用, Claude 安装需提权";
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
  if (record.appId === "claude" && !state.environment.isAdmin) return "Claude Desktop 恢复需要管理员权限";
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
  const needsAdmin = app.id === "claude" && !state.environment.isAdmin;
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
    ? "<strong>自动兼容资源模式</strong><br>自动定位最新版本并校验 3 个 en-US.json, 不修改 app.asar, Claude.exe 或客户端配置."
    : "<strong>自动兼容引擎模式</strong><br>按资源结构发现新入口包, 安装前执行严格语法预检, 版本备份和事务化恢复.";
  updateModalBackupGate(app);
  renderLocales(app);
  const claudeNeedsAdmin = appId === "claude" && !state.environment.isAdmin;
  $("#adminNote").classList.toggle("hidden", !claudeNeedsAdmin);
  $("#adminNoteTitle").textContent = "Claude Desktop 安装需要管理员权限";
  $("#adminNoteText").textContent = "WindowsApps 默认受保护. 预检不需要提权, 安装和恢复需要重新启动工作台.";
  $("#consentCheckbox").checked = false;
  $("#progressWrap").classList.add("hidden");
  $("#progressBar").style.width = "0%";
  $("#progressValue").textContent = "0%";
  $("#operationMessage").textContent = app.reason || "";
  $("#modalBackdrop").classList.remove("hidden");
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
}

function activateSection(section) {
  $$(`.nav-item[data-section]`).forEach((item) => {
    item.classList.toggle("active", item.dataset.section === section);
  });
  const content = $(".content");
  const aboutMode = section === "about";
  content.classList.toggle("about-mode", aboutMode);
  if (aboutMode) {
    content.scrollTop = 0;
    loadGitHubAvatar();
    return;
  }
  document.getElementById(section)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

$$(`.nav-item[data-section]`).forEach((button) => {
  button.addEventListener("click", () => activateSection(button.dataset.section));
});

$$(`[data-open-app]`).forEach((button) => button.addEventListener("click", () => openModal(button.dataset.openApp)));
$$(".backup-action[data-backup-app]").forEach((button) => button.addEventListener("click", () => runBackup(button.dataset.backupApp)));
$("#scanButton").addEventListener("click", refreshEnvironmentAndApps);
$("#nodeRuntimeRefreshButton").addEventListener("click", refreshEnvironmentAndApps);
$("#refreshUsageButton").addEventListener("click", loadUsage);
$("#checkUpdateButton").addEventListener("click", () => loadUpdateStatus({ notify: true }));
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
  await waitForFirstRunConsent();
  await refreshEnvironmentAndApps();
  await Promise.all([loadUsage(), loadUpdateStatus({ notify: true })]);
});
