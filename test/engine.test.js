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

test('replaces only complete JavaScript string literals', () => {
  const dict = new Map([
    ['Open Browser', { zh: '打开浏览器', ctx: ['lit'] }],
  ]);
  const src = [
    'const doubleQuoted = "Open Browser";',
    "const singleQuoted = 'Open Browser';",
    'const nestedDouble = \'He said "Open Browser"\';',
    'const nestedSingle = "He said \'Open Browser\'";',
    'const escaped = "\\\"Open Browser\\\"";',
  ].join('\n');
  const { text, total } = applyToText(src, dict);

  assert.equal(total, 2);
  assert.match(text, /doubleQuoted = "打开浏览器"/);
  assert.match(text, /singleQuoted = '打开浏览器'/);
  assert.match(text, /nestedDouble = 'He said "Open Browser"'/);
  assert.match(text, /nestedSingle = "He said 'Open Browser'"/);
  assert.match(text, /escaped = "\\"Open Browser\\""/);
  assert.doesNotThrow(() => new vm.Script(text));
});

test('does not replace strings written inside regex literals or comments', () => {
  const dict = new Map([
    ['Open Browser', { zh: '打开浏览器', ctx: ['lit'] }],
  ]);
  const src = [
    'const direct = /"Open Browser"/g;',
    'function fromReturn() { return /\'Open Browser\'/; }',
    'if (ready) /"Open Browser"/.test(value);',
    'if (ready) {} /\'Open Browser\'/.test(value);',
    'if (ready) {} else {} /"Open Browser"/.test(value);',
    '// "Open Browser"',
    '/* \'Open Browser\' */',
  ].join('\n');
  const { text, total } = applyToText(src, dict);

  assert.equal(total, 0);
  assert.equal(text, src);
  assert.doesNotThrow(() => new vm.Script(text));
});

test('does not replace property or html patterns inside regex literals or comments', () => {
  const dict = new Map([
    ['Cancel', { zh: '取消', ctx: ['prop'] }],
    ['Open Browser', { zh: '打开浏览器', ctx: ['html-text', 'html-attr'] }],
  ]);
  const src = [
    'const prop = /{label:"Cancel"}/; // {label:"Cancel"}',
    'const html = />Open Browser</; // >Open Browser<',
  ].join('\n');
  const { text, total } = applyToText(src, dict);

  assert.equal(total, 0);
  assert.equal(text, src);
  assert.doesNotThrow(() => new vm.Script(text));
});

test('keeps regex detection correct after for-await and replaces later literals', () => {
  const dict = new Map([
    ['Open Browser', { zh: '打开浏览器', ctx: ['lit'] }],
  ]);
  const src = [
    'async function f(xs) {',
    '  for await (const x of xs) /"Open Browser"/.test(x);',
    '}',
    'const s = "Open Browser";',
  ].join('\n');
  const { text, total } = applyToText(src, dict);

  assert.equal(total, 1);
  assert.match(text, /const s = "打开浏览器"/);
  assert.match(text, /\/"Open Browser"\//);
  assert.doesNotThrow(() => new vm.Script(text));
});

test('keeps division after a class expression and replaces later literals', () => {
  const dict = new Map([
    ['Open Browser', { zh: '打开浏览器', ctx: ['lit'] }],
  ]);
  const src = 'const n = class {} / 2;\nconst s = "Open Browser";';
  const { text, total } = applyToText(src, dict);

  assert.equal(total, 1);
  assert.equal(text, 'const n = class {} / 2;\nconst s = "打开浏览器";');
  assert.doesNotThrow(() => new vm.Script(text));
});

test('handles template literal boundaries and expressions', () => {
  const dict = new Map([
    ['Open Browser', { zh: '打开浏览器', ctx: ['lit'] }],
  ]);
  const src = [
    'const complete = `Open Browser`;',
    'const nestedQuotes = `Click "Open Browser" now`;',
    'const interpolated = `Open Browser ${name}`;',
    'const expression = `${ready ? "Open Browser" : \'Open Browser\'}`;',
  ].join('\n');
  const { text, total } = applyToText(src, dict);

  assert.equal(total, 3);
  assert.match(text, /complete = `打开浏览器`/);
  assert.match(text, /nestedQuotes = `Click "Open Browser" now`/);
  assert.match(text, /interpolated = `Open Browser \$\{name\}`/);
  assert.match(text, /expression = `\$\{ready \? "打开浏览器" : '打开浏览器'\}`/);
  assert.doesNotThrow(() => new vm.Script(text));
});

test('matches an escaped quote only when the complete literal value matches', () => {
  const dict = new Map([
    ["Don't ask again", { zh: '不再询问', ctx: ['lit'] }],
    ['Open Browser', { zh: '打开浏览器', ctx: ['lit'] }],
  ]);
  const src = "const exact='Don\\'t ask again';const embedded='\\'Open Browser\\'';";
  const { text, total } = applyToText(src, dict);

  assert.equal(total, 1);
  assert.equal(text, "const exact='不再询问';const embedded='\\'Open Browser\\'';");
  assert.doesNotThrow(() => new vm.Script(text));
});
