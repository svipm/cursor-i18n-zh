'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { setLocaleInArgv } = require('../src/argv');

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
