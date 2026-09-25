'use strict';

// 在 Cursor 账号设置页内嵌原生"套餐与用量"入口.
//
// Cursor 3.15 及更早的工作台是 SolidJS, 用量页是页面级组件, 直接作为账号页的兄弟节点插入.
// Cursor 3.16 起工作台迁移到 React (React Compiler 产物), 账号页改为 entries 列表容器,
// 用量改为独立组件, 因此改为向该列表的 children 数组追加一个渲染原生用量组件的条目.
// 两种结构同时保留: 旧锚点存在时走旧逻辑, 否则按 React 结构处理.

const { tokenizer } = require('acorn');

const INJECTION_MARKER = 'i18nAccountUsage:!0';
const MATCHING = { '(': ')', '[': ']', '{': '}' };
const TOKEN_OPTS = { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true };

// 旧 SolidJS 结构 (Cursor <= 3.15).
const LEGACY_ACCOUNT_ANCHOR = 'label:"Cursor Account",description:"Manage your account and billing"';
const LEGACY_PLAN_USAGE_ANCHOR = '[SettingsPlanUsageTab] Failed to fetch hard limit';

// React 结构 (Cursor >= 3.16).
// 设置项注册表里也有同样的描述文本, 用账号列表锚点区分渲染代码与元数据.
const REACT_ACCOUNT_DESCRIPTION = 'description:"Manage your account and billing"';
const REACT_ACCOUNT_LIST = 'accessibleLabel:"Account",children:[';
const REACT_PLAN_USAGE_SIGNAL = 'Failed to fetch hard limit';
const REACT_ENTRY_RE = /([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\.Entry,\{description:"Manage your account and billing"/;

// 旧结构使用的严格匹配: 要求参数列表后紧跟函数体, 保持既有行为不变.
function legacyFunctionBefore(text, index) {
  const re = /function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\{/g;
  let found = null;
  let match;
  while ((match = re.exec(text)) && match.index < index) {
    found = { name: match[1], index: match.index };
  }
  return found;
}

// 最近一个位于 index 之前的具名函数声明.
function functionBefore(text, index) {
  const re = /function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let found = null;
  let match;
  while ((match = re.exec(text)) && match.index < index) {
    found = { name: match[1], index: match.index };
  }
  return found;
}

// 用 acorn 分词扫描 fnStart 处的具名函数, 跳过参数列表后只跟踪函数体.
// 返回函数体结束位置, 以及 target(某个开括号) 在函数体内的配对位置.
// 注意: 必须先跳过参数列表, 否则参数括号会先入栈出栈, 导致误判函数已结束.
function scanFunctionBody(text, fnStart, target) {
  const tokens = tokenizer(text.slice(fnStart), TOKEN_OPTS);
  const stack = [];
  let paramDepth = 0;
  let sawParams = false;
  let bodyStarted = false;
  let depth = 0;
  let token;
  while ((token = tokens.getToken()).type.label !== 'eof') {
    const label = token.type.label;
    if (!bodyStarted) {
      if (label === '(') { paramDepth++; sawParams = true; } else if (label === ')') paramDepth--;
      else if (label === '{' && sawParams && paramDepth === 0) {
        bodyStarted = true;
        depth = 1;
        stack.push({ label, pos: fnStart + token.start });
      }
      continue;
    }
    const pos = fnStart + token.start;
    if (label === '(' || label === '[' || label === '{') {
      depth++;
      stack.push({ label, pos });
      continue;
    }
    if (label === ')' || label === ']' || label === '}') {
      const top = stack.pop();
      if (!top || MATCHING[top.label] !== label) return { bodyEnd: -1, close: -1 };
      depth--;
      if (target >= 0 && top.pos === target) return { bodyEnd: -1, close: pos };
      if (depth === 0) return { bodyEnd: fnStart + token.end, close: -1 };
    }
  }
  return { bodyEnd: -1, close: -1 };
}

// 包含 index 的具名函数; 逐个候选校验锚点确实落在其函数体内.
function enclosingFunction(text, index) {
  let candidate = functionBefore(text, index);
  for (let guard = 0; candidate && guard < 8; guard++) {
    if (scanFunctionBody(text, candidate.index, -1).bodyEnd > index) {
      return { name: candidate.name, index: candidate.index };
    }
    candidate = functionBefore(text, candidate.index - 1);
  }
  return null;
}

function lastMatch(re, text) {
  let found = null;
  let match;
  while ((match = re.exec(text))) found = match;
  return found;
}

// Cursor <= 3.15: 把原生用量组件作为账号页的兄弟节点插入.
function embedLegacyAccountUsage(text) {
  const accountIndex = text.indexOf(LEGACY_ACCOUNT_ANCHOR);
  const planUsageIndex = text.indexOf(LEGACY_PLAN_USAGE_ANCHOR);
  if (accountIndex < 0 || planUsageIndex < 0) {
    return { text, injected: false, reason: 'anchors-missing' };
  }

  const generalFunction = legacyFunctionBefore(text, accountIndex);
  const planUsageFunction = legacyFunctionBefore(text, planUsageIndex);
  if (!generalFunction || !planUsageFunction) {
    return { text, injected: false, reason: 'functions-missing' };
  }

  const generalHead = text.slice(generalFunction.index, accountIndex);
  const signedIn = generalHead.match(/\{signedIn:([A-Za-z_$][\w$]*),membershipType:/)?.[1];
  const factory = lastMatch(/return\[([A-Za-z_$][\w$]*)\(/g, generalHead)?.[1];
  if (!signedIn || !factory) {
    return { text, injected: false, reason: 'general-symbols-missing' };
  }

  const accountWindow = text.slice(Math.max(generalFunction.index, accountIndex - 5000), accountIndex + 5000);
  const show = accountWindow.match(new RegExp(
    `${factory}\\(([A-Za-z_$][\\w$]*),\\{get when\\(\\)\\{return ${signedIn}\\(\\)\\}`,
  ))?.[1];
  if (!show) return { text, injected: false, reason: 'conditional-symbol-missing' };

  const preferencesIndex = text.indexOf('title:"Preferences"', accountIndex);
  if (preferencesIndex < 0 || preferencesIndex > planUsageIndex) {
    return { text, injected: false, reason: 'preferences-anchor-missing' };
  }

  const insertionIndex = text.lastIndexOf(`${factory}(${show},{when:`, preferencesIndex);
  if (insertionIndex < generalFunction.index) {
    return { text, injected: false, reason: 'insertion-point-missing' };
  }

  const addition = `${factory}(${show},{get when(){return ${signedIn}()},get children(){return ${factory}(${planUsageFunction.name},{${INJECTION_MARKER}})}}),`;
  return {
    text: text.slice(0, insertionIndex) + addition + text.slice(insertionIndex),
    injected: true,
    reason: null,
  };
}

// Cursor >= 3.16: 向账号页 entries 列表追加一个渲染原生用量组件的条目.
function embedReactAccountUsage(text) {
  let descriptionIndex = -1;
  let cursor = -1;
  while ((cursor = text.indexOf(REACT_ACCOUNT_DESCRIPTION, cursor + 1)) >= 0) {
    if (text.slice(Math.max(0, cursor - 400), cursor).includes('accessibleLabel:"Account"')) {
      descriptionIndex = cursor;
      break;
    }
  }
  if (descriptionIndex < 0) return { text, injected: false, reason: 'react-account-anchor-missing' };

  const accountFunction = enclosingFunction(text, descriptionIndex);
  if (!accountFunction) return { text, injected: false, reason: 'react-account-function-missing' };

  const listIndex = text.lastIndexOf(REACT_ACCOUNT_LIST, descriptionIndex);
  if (listIndex < accountFunction.index) {
    return { text, injected: false, reason: 'react-account-list-missing' };
  }
  const openIndex = listIndex + REACT_ACCOUNT_LIST.length - 1;
  const closeIndex = scanFunctionBody(text, accountFunction.index, openIndex).close;
  if (closeIndex < 0) return { text, injected: false, reason: 'react-account-list-unbalanced' };

  const entryFactory = REACT_ENTRY_RE.exec(text.slice(listIndex, descriptionIndex + 80))?.[1];
  if (!entryFactory) return { text, injected: false, reason: 'react-entry-factory-missing' };

  const planUsageIndex = text.indexOf(REACT_PLAN_USAGE_SIGNAL);
  if (planUsageIndex < 0) return { text, injected: false, reason: 'react-plan-usage-anchor-missing' };
  const planUsageFunction = enclosingFunction(text, planUsageIndex);
  if (!planUsageFunction) return { text, injected: false, reason: 'react-plan-usage-function-missing' };

  const addition = `,${entryFactory}(${planUsageFunction.name},{${INJECTION_MARKER}})`;
  return {
    text: text.slice(0, closeIndex) + addition + text.slice(closeIndex),
    injected: true,
    reason: null,
  };
}

function embedAccountUsage(text) {
  if (text.includes(INJECTION_MARKER)) {
    return { text, injected: false, reason: 'already-present' };
  }
  if (text.includes(LEGACY_ACCOUNT_ANCHOR) && text.includes(LEGACY_PLAN_USAGE_ANCHOR)) {
    return embedLegacyAccountUsage(text);
  }
  return embedReactAccountUsage(text);
}

module.exports = { embedAccountUsage, INJECTION_MARKER };
