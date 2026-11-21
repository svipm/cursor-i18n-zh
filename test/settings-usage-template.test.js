'use strict';

// Cursor 3.31 回归: 用量组件函数体内出现模板字符串插值 (`${...}`).
// acorn 会把 `${` 作为独立 token 抛出, 函数体扫描必须把它计入括号配对;
// 否则插值闭合的 `}` 会与前面的 `(` 错配, 导致定位不到用量组件,
// 自动兼容门禁因 "账号用量入口仅嵌入 0 个包" 失败.

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');

const { embedAccountUsage, INJECTION_MARKER } = require('../src/settings-usage');

function fixture331({ entryFactory = 'Yw', groupFactory = 'Y2e', namespace = 'Xs', planName = 'Qlw' } = {}) {
  const template = '`${o.getWebsiteUrl()}${rt}`';
  return [
    'function registry(){return[jc("general","cursor-account",{label:"Cursor Account",condition:"signed-in",description:"Manage your account and billing"})]}',
    `function accountPage({membershipType:n}){const t=Wtn(26);let y;y=${entryFactory}(${namespace}.Entry,{description:"Manage your account and billing",label:"Cursor Account",children:${groupFactory}(ds,{children:"Open"})});let T;return ${entryFactory}(y_,{children:${groupFactory}(${namespace}.Root,{accessibleLabel:"Account",children:[y,T]})})}`,
    `function ${planName}({settingsWorkspace:e}){const t=Zig(3);const u=()=>{e.error("[PlanUsageConfig] Failed to fetch hard limit")};s.open(${template},{allowContributedOpeners:!0});return uHS(Cae,{legacyScrollGutter:n,title:"Plan & Usage",children:[]})}`,
  ].join('');
}

test('finds the plan usage component past template literal interpolation', () => {
  const result = embedAccountUsage(fixture331());

  assert.equal(result.injected, true);
  assert.equal(result.reason, null);
  assert.match(result.text, /children:\[y,T,Yw\(Qlw,\{i18nAccountUsage:!0\}\)\]/);
  assert.doesNotThrow(() => new vm.Script(result.text));
});

test('injection marker stays idempotent with template interpolation present', () => {
  const first = embedAccountUsage(fixture331());
  const second = embedAccountUsage(first.text);

  assert.equal(first.injected, true);
  assert.equal(second.injected, false);
  assert.equal(second.reason, 'already-present');
  assert.equal(second.text, first.text);
  assert.ok(first.text.includes(INJECTION_MARKER));
});
