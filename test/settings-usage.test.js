'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');

const { embedAccountUsage, INJECTION_MARKER } = require('../src/settings-usage');

function fixture() {
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

test('embeds Cursor native plan and usage component below account information', () => {
  const source = fixture();
  const result = embedAccountUsage(source);

  assert.equal(result.injected, true);
  assert.match(result.text, new RegExp(INJECTION_MARKER.replace(/[!]/g, '\\!')));
  assert.match(result.text, /get when\(\)\{return S\(\)\}.*h\(planUsage,/);
  assert.ok(result.text.indexOf(INJECTION_MARKER) < result.text.indexOf('title:"Preferences"'));
  assert.doesNotThrow(() => new vm.Script(result.text));
});

test('account usage embedding is idempotent and ignores unsupported bundles', () => {
  const first = embedAccountUsage(fixture());
  const second = embedAccountUsage(first.text);
  const unsupported = embedAccountUsage('const untouched = true;');

  assert.equal(second.injected, false);
  assert.equal(second.reason, 'already-present');
  assert.equal(second.text, first.text);
  assert.equal(unsupported.injected, false);
  assert.equal(unsupported.reason, 'anchors-missing');
  assert.equal(unsupported.text, 'const untouched = true;');
});
