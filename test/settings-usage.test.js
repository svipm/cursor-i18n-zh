'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');

const { embedAccountUsage, INJECTION_MARKER } = require('../src/settings-usage');

const MARKER_RE = new RegExp(INJECTION_MARKER.replace(/[!]/g, '\\!'));

// Cursor <= 3.15: SolidJS 工作台, 用量页是页面级组件.
function legacyFixture() {
  return [
    'function general(){',
    'const {signedIn:S,membershipType:M}=auth();',
    'return h(Page,{get children(){return[',
    'h(Show,{get when(){return S()},get children(){return h(List,{get children(){return[',
    'h(Row,{label:"Cursor Account",description:"Manage your account and billing"})',
    ']}})}}),',
    'h(Show,{when:!glass,get children(){return h(Section,{title:"Preferences"})}})',
    ']}})}',
    'function planUsage(){',
    'console.error("[SettingsPlanUsageTab] Failed to fetch hard limit");',
    'return h(Page,{title:"Plan & Usage"})',
    '}',
  ].join('');
}

// Cursor >= 3.16: React 工作台, 账号页是 entries 列表, 用量是独立组件.
// 元素工厂函数名与命名空间随压缩产物变化, 因此夹具可替换.
function reactFixture({ entryFactory = 'Rk', groupFactory = 'bLe', namespace = 'ks', planName = 'planUsage' } = {}) {
  return [
    // 设置项注册表: 含同名描述, 但不是账号页渲染代码, 必须被排除.
    'function registry(){return[jc("general","cursor-account",{label:"Cursor Account",condition:"signed-in",description:"Manage your account and billing"})]}',
    `function accountPage({membershipType:e}){const t=Fr(ow);return ${entryFactory}(Sv,{children:${groupFactory}(${namespace}.Root,{accessibleLabel:"Account",children:[`,
    `${entryFactory}(${namespace}.Entry,{description:"Manage your account and billing",label:"Cursor Account",searchAliases:["account","billing"],children:${entryFactory}(Yr,{children:"Open"})}),`,
    `e===fr.FREE?${entryFactory}(${namespace}.Entry,{label:"Upgrade to Pro",children:"Upgrade"}):null`,
    ']})})}',
    `function ${planName}(e){const t=pxp(119);let b;t[0]=(b=()=>{a.error("[PlanUsageConfig] Failed to fetch hard limit",f.error)});return f7y(mse,{title:"Plan & Usage",children:[]})}`,
  ].join('');
}

// Cursor >= 3.24: React Compiler 把账号条目先赋值给 memo 变量, 列表改为引用变量,
// 因此 accessibleLabel:"Account",children:[...] 出现在账号条目描述之后.
function reactFixture324({ entryFactory = 'Yw', groupFactory = 'Y2e', namespace = 'Xs', planName = 'vHS' } = {}) {
  return [
    // 设置项注册表: 含同名描述, 但没有账号列表锚点, 必须被排除.
    'function registry(){return[jc("general","cursor-account",{label:"Cursor Account",condition:"signed-in",description:"Manage your account and billing"})]}',
    `function accountPage({membershipType:n}){const t=Wtn(26);let y;t[11]!==u?(y=${entryFactory}(${namespace}.Entry,{description:"Manage your account and billing",label:"Cursor Account",searchAliases:["account","billing","subscription"],children:${groupFactory}(ds,{onClick:u,size:"md",variant:"outline",children:"Open"})}),t[11]=u,t[12]=y):y=t[12];let T;T=n===fr.FREE?${entryFactory}(Upgrade,{children:"Upgrade"}):null;let E;E=${entryFactory}(Invite,{children:"Invite"});let A;return t[22]!==y||t[23]!==T||t[24]!==E?(A=${entryFactory}(y_,{children:${groupFactory}(${namespace}.Root,{accessibleLabel:"Account",children:[y,T,E]})}),t[22]=y,t[23]=T,t[24]=E,t[25]=A):A=t[25],A}`,
    `function ${planName}(e){const t=iSa(146);t[0]!==b.error||t[1]!==c?(T=()=>{b.error!==null&&c.error("[PlanUsageConfig] Failed to fetch hard limit",b.error)}):T=t[2];return uHS(Cae,{legacyScrollGutter:n,title:"Plan & Usage",children:[]})}`,
  ].join('');
}

test('embeds Cursor native plan and usage component below account information', () => {
  const source = legacyFixture();
  const result = embedAccountUsage(source);

  assert.equal(result.injected, true);
  assert.match(result.text, MARKER_RE);
  assert.match(result.text, /get when\(\)\{return S\(\)\}.*h\(planUsage,/);
  assert.ok(result.text.indexOf(INJECTION_MARKER) < result.text.indexOf('title:"Preferences"'));
  assert.doesNotThrow(() => new vm.Script(result.text));
});

test('account usage embedding is idempotent and leaves unsupported bundles untouched', () => {
  const first = embedAccountUsage(legacyFixture());
  const second = embedAccountUsage(first.text);
  const unsupported = embedAccountUsage('const untouched = true;');

  assert.equal(second.injected, false);
  assert.equal(second.reason, 'already-present');
  assert.equal(second.text, first.text);
  assert.equal(unsupported.injected, false);
  assert.equal(unsupported.reason, 'react-account-anchor-missing');
  assert.equal(unsupported.text, 'const untouched = true;');
});

test('embeds native plan usage into the React account list, not the settings registry', () => {
  const source = reactFixture();
  const result = embedAccountUsage(source);

  assert.equal(result.injected, true);
  assert.equal(result.reason, null);
  assert.match(result.text, MARKER_RE);
  assert.doesNotThrow(() => new vm.Script(result.text));

  // 追加在账号设置页条目列表末尾, 且位于 entries 列表关闭括号之前.
  assert.match(result.text, /\):null,Rk\(planUsage,\{i18nAccountUsage:!0\}\)\]\}\)\}\)\}/);
  // 注入点必须在 accountPage 内, 不能在设置项注册表里.
  const marker = result.text.indexOf(INJECTION_MARKER);
  assert.ok(marker > result.text.indexOf('function accountPage('));
  assert.ok(marker < result.text.indexOf('function planUsage('));
});

test('derives the element factory and plan usage component from the bundle', () => {
  const source = reactFixture({ entryFactory: 'sT', groupFactory: 'Jze', namespace: 'Hs', planName: 'BCk' });
  const result = embedAccountUsage(source);

  assert.equal(result.injected, true);
  assert.match(result.text, /\):null,sT\(BCk,\{i18nAccountUsage:!0\}\)\]\}\)\}\)\}/);
  assert.doesNotThrow(() => new vm.Script(result.text));
});

test('stops safely when the native plan usage component is absent', () => {
  const source = reactFixture().replace('[PlanUsageConfig] Failed to fetch hard limit', 'unrelated log line');
  const result = embedAccountUsage(source);

  assert.equal(result.injected, false);
  assert.equal(result.reason, 'react-plan-usage-anchor-missing');
  assert.equal(result.text, source);
});

test('reports a structural reason instead of guessing when the React account list is missing', () => {
  const source = 'function accountPage(){return Rk(Sv,{children:bLe(ks.Root,{accessibleLabel:"Account"})})}';
  const result = embedAccountUsage(source);

  assert.equal(result.injected, false);
  assert.equal(result.reason, 'react-account-anchor-missing');
  assert.equal(result.text, source);
});

test('binds the real plan usage component when an earlier function logs the same text', () => {
  const decoy = 'function decoyLogger(e){a.error("Failed to fetch hard limit",e);return null}';
  const source = decoy + reactFixture();
  const result = embedAccountUsage(source);

  assert.equal(result.injected, true);
  // 注入必须引用真正的用量组件, 而不是更早出现同一段日志文案的诱饵函数.
  assert.match(result.text, /,Rk\(planUsage,\{i18nAccountUsage:!0\}\)\]/);
  assert.ok(!result.text.includes('decoyLogger,{i18nAccountUsage'));
  assert.doesNotThrow(() => new vm.Script(result.text));
});

test('stops safely when the anchor lands in a function that is not the plan usage page', () => {
  const source = reactFixture()
    .replace('[PlanUsageConfig] Failed to fetch hard limit', 'Failed to fetch hard limit')
    .replace('title:"Plan & Usage"', 'title:"Somewhere Else"');
  const result = embedAccountUsage(source);

  assert.equal(result.injected, false);
  assert.equal(result.reason, 'react-plan-usage-function-missing');
  assert.equal(result.text, source);
});

test('binds correctly past anonymous function expressions and hundreds of earlier declarations', () => {
  const dummies = Array.from({ length: 400 }, (_, i) => `function dummy${i}(e){const t=pxp(${i});return t}`).join('\n');
  const source = dummies + '\n' + reactFixture()
    .replace('const t=Fr(ow);', 'const anon=function(x){return x},gen=function*(y){yield y},t=Fr(ow);');
  const result = embedAccountUsage(source);

  assert.equal(result.injected, true);
  assert.match(result.text, /,Rk\(planUsage,\{i18nAccountUsage:!0\}\)\]/);
  assert.doesNotThrow(() => new vm.Script(result.text));
});

// Cursor 3.24 起账号条目改为先赋值给 memo 变量, 列表引用变量, 描述在列表之前.
test('embeds into the 3.24 account list whose children reference memo variables', () => {
  const source = reactFixture324();
  const result = embedAccountUsage(source);

  assert.equal(result.injected, true);
  assert.equal(result.reason, null);
  assert.match(result.text, /children:\[y,T,E,Yw\(vHS,\{i18nAccountUsage:!0\}\)\]/);
  // 注入点必须在账号页内, 且不能落在设置项注册表里.
  const marker = result.text.indexOf(INJECTION_MARKER);
  assert.ok(marker > result.text.indexOf('function accountPage('));
  assert.ok(marker < result.text.indexOf('function vHS('));
  assert.doesNotThrow(() => new vm.Script(result.text));
});

test('derives the entry factory for the 3.24 layout from the bundle', () => {
  const source = reactFixture324({ entryFactory: 'sT', groupFactory: 'Jze', namespace: 'Hs', planName: 'BCk' });
  const result = embedAccountUsage(source);

  assert.equal(result.injected, true);
  assert.match(result.text, /children:\[y,T,E,sT\(BCk,\{i18nAccountUsage:!0\}\)\]/);
  assert.doesNotThrow(() => new vm.Script(result.text));
});
