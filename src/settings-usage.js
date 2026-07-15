'use strict';

const ACCOUNT_ANCHOR = 'label:"Cursor Account",description:"Manage your account and billing"';
const PLAN_USAGE_ANCHOR = '[SettingsPlanUsageTab] Failed to fetch hard limit';
const INJECTION_MARKER = 'i18nAccountUsage:!0';

function functionBefore(text, index) {
  const re = /function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\{/g;
  let found = null;
  let match;
  while ((match = re.exec(text)) && match.index < index) {
    found = { name: match[1], index: match.index };
  }
  return found;
}

function lastMatch(re, text) {
  let found = null;
  let match;
  while ((match = re.exec(text))) found = match;
  return found;
}

function embedAccountUsage(text) {
  if (text.includes(INJECTION_MARKER)) {
    return { text, injected: false, reason: 'already-present' };
  }

  const accountIndex = text.indexOf(ACCOUNT_ANCHOR);
  const planUsageIndex = text.indexOf(PLAN_USAGE_ANCHOR);
  if (accountIndex < 0 || planUsageIndex < 0) {
    return { text, injected: false, reason: 'anchors-missing' };
  }

  const generalFunction = functionBefore(text, accountIndex);
  const planUsageFunction = functionBefore(text, planUsageIndex);
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

module.exports = { embedAccountUsage, INJECTION_MARKER };
