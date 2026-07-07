'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { loadDicts } = require('../src/dict');

test('loads code and nls dictionaries and reports invalid entries', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-i18n-dict-'));
  fs.writeFileSync(path.join(dir, '00.json'), JSON.stringify({
    '//': 'comment',
    'New Agent': '新建智能体',
    'Bad Quote': '坏"译文',
    'Bad Ctx': { zh: '坏上下文', ctx: ['bad'] },
  }));
  fs.writeFileSync(path.join(dir, 'nls.json'), JSON.stringify({
    'module#key': '译文',
  }));

  const dicts = loadDicts(dir);
  assert.equal(dicts.code.size, 1);
  assert.equal(dicts.code.get('New Agent').zh, '新建智能体');
  assert.deepEqual(dicts.nls, { 'module#key': '译文' });
  assert.equal(dicts.warnings.length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});
