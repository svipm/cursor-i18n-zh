'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { setLocaleInArgv, parseArgvJsonc } = require('../src/argv');

test('creates valid argv json with locale', () => {
  const out = setLocaleInArgv('', 'zh-cn');
  assert.deepEqual(JSON.parse(out), { locale: 'zh-cn' });
});

test('inserts locale into existing argv json without trailing comma', () => {
  const out = setLocaleInArgv('{\n\t"disable-hardware-acceleration": true\n}', 'zh-cn');
  assert.deepEqual(JSON.parse(out), {
    locale: 'zh-cn',
    'disable-hardware-acceleration': true,
  });
});

test('updates existing locale value', () => {
  const out = setLocaleInArgv('{\n\t"locale": "en",\n\t"foo": 1\n}', 'zh-cn');
  assert.deepEqual(JSON.parse(out), { locale: 'zh-cn', foo: 1 });
});

test('keeps Cursor argv jsonc comments while updating locale', () => {
  const raw = `{
\t"locale": "en",

\t// Allows to disable crash reporting.
\t"enable-crash-reporter": true,
}`;
  const out = setLocaleInArgv(raw, 'zh-cn');
  assert.match(out, /\/\/ Allows to disable crash reporting/);
  assert.deepEqual(parseArgvJsonc(out), {
    locale: 'zh-cn',
    'enable-crash-reporter': true,
  });
});

test('inserts locale into Cursor argv jsonc with leading comments', () => {
  const raw = `{
\t// Unique id used for correlating crash reports.
\t"crash-reporter-id": "abc"
}`;
  const out = setLocaleInArgv(raw, 'zh-tw');
  assert.deepEqual(parseArgvJsonc(out), {
    locale: 'zh-tw',
    'crash-reporter-id': 'abc',
  });
});

test('ignores commented locale when inserting active locale', () => {
  const raw = `{
	// "locale": "en",
	"foo": "bar"
}`;
  const out = setLocaleInArgv(raw, 'zh-cn');
  assert.match(out, /\/\/ "locale": "en"/);
  assert.deepEqual(parseArgvJsonc(out), { locale: 'zh-cn', foo: 'bar' });
});

test('updates only top-level locale', () => {
  const raw = `{
	"nested": { "locale": "en" },
	"locale": "ja"
}`;
  const out = setLocaleInArgv(raw, 'zh-tw');
  assert.deepEqual(parseArgvJsonc(out), {
    nested: { locale: 'en' },
    locale: 'zh-tw',
  });
});

test('replaces non-string top-level locale value', () => {
  const raw = `{
	"locale": null,
	"foo": true
}`;
  const out = setLocaleInArgv(raw, 'zh-cn');
  assert.deepEqual(parseArgvJsonc(out), { locale: 'zh-cn', foo: true });
});
