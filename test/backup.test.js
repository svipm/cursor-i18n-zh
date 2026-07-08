'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { sha256b64, ensureDir } = require('../src/util');
const { validateBackupSources, validateBackupFiles, formatBackupSourceIssues, formatBackupFileIssues } = require('../src/backup');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-i18n-backup-'));
}

test('blocks creating backup from localized source file', () => {
  const root = tmp();
  const app = path.join(root, 'app');
  const bdir = path.join(root, 'backup', '1.0.0');
  const rel = 'out/main.js';
  ensureDir(path.dirname(path.join(app, rel)));
  const content = 'const title = "设置";';
  fs.writeFileSync(path.join(app, rel), content);
  const product = { version: '1.0.0', checksums: { 'main.js': sha256b64(Buffer.from(content)) } };

  const issues = validateBackupSources(app, [rel], bdir, product, { translations: ['设置'] });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].reason, 'localized');
  assert.match(formatBackupSourceIssues(issues, '1.0.0'), /避免把已汉化文件备份为原版/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('blocks creating backup from checksum-mismatched source file', () => {
  const root = tmp();
  const app = path.join(root, 'app');
  const bdir = path.join(root, 'backup', '1.0.0');
  const rel = 'out/main.js';
  ensureDir(path.dirname(path.join(app, rel)));
  fs.writeFileSync(path.join(app, rel), 'modified');
  const product = { version: '1.0.0', checksums: { 'main.js': sha256b64(Buffer.from('original')) } };

  const issues = validateBackupSources(app, [rel], bdir, product, { translations: [] });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].reason, 'checksum');
  fs.rmSync(root, { recursive: true, force: true });
});

test('does not revalidate files that already have backups', () => {
  const root = tmp();
  const app = path.join(root, 'app');
  const bdir = path.join(root, 'backup', '1.0.0');
  const rel = 'out/main.js';
  ensureDir(path.dirname(path.join(app, rel)));
  ensureDir(path.dirname(path.join(bdir, 'files', rel)));
  fs.writeFileSync(path.join(app, rel), 'const title = "设置";');
  fs.writeFileSync(path.join(bdir, 'files', rel), 'const title = "Settings";');
  const product = { version: '1.0.0', checksums: {} };

  const issues = validateBackupSources(app, [rel], bdir, product, { translations: ['设置'] });
  assert.deepEqual(issues, []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('detects localized content inside existing backup files', () => {
  const root = tmp();
  const bdir = path.join(root, 'backup', '1.0.0');
  const rel = 'out/main.js';
  ensureDir(path.dirname(path.join(bdir, 'files', rel)));
  fs.writeFileSync(path.join(bdir, 'files', rel), 'const title = "设置";');

  const issues = validateBackupFiles(bdir, [rel], { translations: ['设置'] });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].reason, 'localized-backup');
  assert.match(formatBackupFileIssues(issues, '1.0.0'), /备份文件已包含汉化内容/);
  fs.rmSync(root, { recursive: true, force: true });
});

