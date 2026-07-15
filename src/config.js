'use strict';

// 打补丁的目标文件, 相对 resources/app. 不存在的目标会被自动跳过 (不同版本产物可能不同).
const CODE_TARGETS = [
  'out/vs/workbench/workbench.glass.main.js',
  'out/vs/workbench/workbench.desktop.main.js',
  'out/vs/workbench/workbench.anysphere-ui-automations.js',
  'out/main.js',
];

// 工作台入口包自动发现: 兼容不同 Cursor 版本新增或改名的工作台入口包.
// 与 CODE_TARGETS 合并去重 (锚点优先, 稳定顺序), 缺失自动跳过, 提供前向兼容.
const WORKBENCH_DIR = 'out/vs/workbench';
const WORKBENCH_BUNDLE_RE = /^workbench\..+\.js$/;
// 入口包体积下限: 真实 UI 包均在 MB 级, 低于此值的非入口文件跳过, 避免误伤.
const WORKBENCH_BUNDLE_MIN_SIZE = 64 * 1024;

const NLS_MESSAGES = 'out/nls.messages.json';
const NLS_KEYS = 'out/nls.keys.json';
const PRODUCT_JSON = 'product.json';

// prop 上下文: 仅当字符串作为这些属性名的值出现时才替换 (最小化误伤语义比较/键名).
const PROPS = [
  'children', 'label', 'title', 'tooltip', 'placeholder', 'description',
  'text', 'message', 'detail', 'header', 'heading', 'subtitle', 'caption',
  'buttonText', 'buttonLabel', 'confirmText', 'cancelText', 'okText',
  'confirmLabel', 'cancelLabel', 'emptyMessage', 'emptyText', 'emptyStateText',
  'ariaLabel', 'aria-label', 'displayName', 'shortTitle', 'category',
  'loadingText', 'errorText', 'successText', 'helperText', 'hintText',
  'secondaryText', 'primaryText', 'badgeText', 'headerTitle', 'sectionTitle',
  'dialogTitle', 'modalTitle', 'footerText',
  // Cursor 设置导航使用 tab id 作为属性名, 对应值仍是可见标题.
  'general', 'profile', 'vscode-settings', 'appearance', 'fun', 'plan-usage',
  'chat', 'browser', 'tab', 'models', 'git-prs', 'rules', 'plugins', 'customize',
  'indexing', 'mcp', 'hooks', 'beta', 'network', 'background-composer',
  'self-driving', 'worktrees', 'developer', 'docs', 'contact',
];

// html-attr 上下文: SolidJS/模板 HTML 里可翻译的属性.
const HTML_ATTRS = [
  'placeholder', 'title', 'aria-label', 'alt', 'data-tooltip',
  'aria-placeholder', 'aria-description', 'data-title',
];

// nls 扫描时视为 Cursor 专有的模块 (VS Code 核心模块交给官方语言包).
const CURSOR_NLS_RE = /aiMarkdown|aiSettings|aiContext|aicontext|aiReview|aiFeatures|aiBlame|aiCodeTracking|composer|cursor[A-Z]|\.cursor\.|\.cursor$|bugbot|Bugbot|memories|backgroundAgent|browserAutomation|anysphere|glass|chimes|contextPicker|shadowWorkspace|cppSettings|cmdk|promptBar/;

module.exports = {
  CODE_TARGETS, WORKBENCH_DIR, WORKBENCH_BUNDLE_RE, WORKBENCH_BUNDLE_MIN_SIZE,
  NLS_MESSAGES, NLS_KEYS, PRODUCT_JSON,
  PROPS, HTML_ATTRS, CURSOR_NLS_RE,
};
