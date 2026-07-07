'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { applyToText } = require('../src/engine');

test('replaces whitelisted property string values and keeps valid JavaScript', () => {
  const dict = new Map([
    ['New Agent', { zh: '新建智能体', ctx: ['prop'] }],
    ['Cancel', { zh: '取消', ctx: ['prop'] }],
  ]);
  const src = 'const x={label:"New Agent",value:"New Agent",cancelLabel:"Cancel"};';
  const { text, total } = applyToText(src, dict);

  assert.equal(total, 2);
  assert.match(text, /label:"新建智能体"/);
  assert.match(text, /value:"New Agent"/);
  assert.match(text, /cancelLabel:"取消"/);
  assert.doesNotThrow(() => new vm.Script(text));
});

test('replaces html text and html attributes only in matching contexts', () => {
  const dict = new Map([
    ['Open Browser', { zh: '打开浏览器', ctx: ['html-text', 'html-attr'] }],
  ]);
  const src = '<button title="Open Browser">Open Browser</button><span data-id="Open Browser"></span>';
  const { text, total } = applyToText(src, dict);

  assert.equal(total, 2);
  assert.equal(text, '<button title="打开浏览器">打开浏览器</button><span data-id="Open Browser"></span>');
});
