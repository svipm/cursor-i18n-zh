'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { sha256b64, ensureDir } = require('../src/util');
const {
  ensureBackup,
  validateBackupSources,
  validateBackupFiles,
  validateCompleteBackup,
  formatBackupSourceIssues,
  formatBackupFileIssues,
} = require('../src/backup');

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
  const backup = 'const title = "Settings";';
  fs.writeFileSync(path.join(bdir, 'files', rel), backup);
  fs.writeFileSync(path.join(bdir, 'meta.json'), JSON.stringify({
    version: '1.0.0',
    commit: null,
    files: { [rel]: { sha256: sha256b64(Buffer.from(backup)), size: Buffer.byteLength(backup) } },
  }));
  const product = { version: '1.0.0', commit: null, checksums: {} };

  const issues = validateBackupSources(app, [rel], bdir, product, { translations: ['设置'] });
  assert.deepEqual(issues, []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('detects localized content inside existing backup files', () => {
  const root = tmp();
  const bdir = path.join(root, 'backup', '1.0.0');
  const rel = 'out/main.js';
  ensureDir(path.dirname(path.join(bdir, 'files', rel)));
  const backup = 'const title = "设置";';
  fs.writeFileSync(path.join(bdir, 'files', rel), backup);
  fs.writeFileSync(path.join(bdir, 'meta.json'), JSON.stringify({
    version: '1.0.0',
    commit: 'abc123',
    files: { [rel]: { sha256: sha256b64(Buffer.from(backup)), size: Buffer.byteLength(backup) } },
  }));

  const issues = validateBackupFiles(bdir, [rel], { translations: ['设置'] });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].reason, 'localized-backup');
  assert.match(formatBackupFileIssues(issues, '1.0.0'), /备份文件已包含汉化内容/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('rejects an existing backup from another commit of the same version', () => {
  const root = tmp();
  const app = path.join(root, 'app');
  const bdir = path.join(root, 'backup', '1.0.0');
  const rel = 'out/main.js';
  ensureDir(path.dirname(path.join(app, rel)));
  fs.writeFileSync(path.join(app, rel), 'original');
  ensureBackup(app, [rel], bdir, { version: '1.0.0', commit: 'commit-a', checksums: {} });

  const product = { version: '1.0.0', commit: 'commit-b', checksums: {} };
  const issues = validateBackupSources(app, [rel], bdir, product);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].reason, 'metadata-commit');
  assert.throws(() => ensureBackup(app, [rel], bdir, product), /备份 commit 不匹配/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('rejects a backup whose metadata version does not match the current Cursor', () => {
  const root = tmp();
  const app = path.join(root, 'app');
  const bdir = path.join(root, 'backup', '1.0.0');
  const rel = 'out/main.js';
  ensureDir(path.dirname(path.join(app, rel)));
  fs.writeFileSync(path.join(app, rel), 'original');
  ensureBackup(app, [rel], bdir, { version: '1.0.0', commit: 'abc123', checksums: {} });

  const issues = validateBackupFiles(bdir, [rel], {
    product: { version: '2.0.0', commit: 'abc123' },
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].reason, 'metadata-version');
  fs.rmSync(root, { recursive: true, force: true });
});

test('detects backup size and sha256 corruption from metadata', () => {
  const root = tmp();
  const app = path.join(root, 'app');
  const bdir = path.join(root, 'backup', '1.0.0');
  const rel = 'out/main.js';
  ensureDir(path.dirname(path.join(app, rel)));
  fs.writeFileSync(path.join(app, rel), 'original');
  ensureBackup(app, [rel], bdir, { version: '1.0.0', commit: 'abc123', checksums: {} });
  fs.writeFileSync(path.join(bdir, 'files', rel), 'damaged-content');

  const issues = validateBackupFiles(bdir, [rel], {
    product: { version: '1.0.0', commit: 'abc123' },
  });
  assert.deepEqual(new Set(issues.map((issue) => issue.reason)), new Set(['backup-size', 'backup-checksum']));
  assert.match(formatBackupFileIssues(issues, '1.0.0'), /身份或完整性校验失败/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('requires every current target to exist in a verified backup', () => {
  const root = tmp();
  const app = path.join(root, 'app');
  const bdir = path.join(root, 'backup', '1.0.0');
  const first = 'out/main.js';
  const second = 'product.json';
  ensureDir(path.dirname(path.join(app, first)));
  fs.writeFileSync(path.join(app, first), 'original');
  fs.writeFileSync(path.join(app, second), '{}');
  const product = { version: '1.0.0', commit: 'abc123', checksums: {} };
  ensureBackup(app, [first], bdir, product);

  const issues = validateCompleteBackup(app, [first, second], bdir, product);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rel, second);
  assert.equal(issues[0].reason, 'required-backup-missing');
  assert.match(formatBackupFileIssues(issues, '1.0.0'), /完整备份中缺失/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('rolls back newly copied files when atomic metadata replacement fails', () => {
  const root = tmp();
  const app = path.join(root, 'app');
  const bdir = path.join(root, 'backup', '1.0.0');
  const rel = 'out/main.js';
  ensureDir(path.dirname(path.join(app, rel)));
  fs.writeFileSync(path.join(app, rel), 'original');

  const fileOps = {
    writeFileSync: fs.writeFileSync.bind(fs),
    renameSync(src, dst) {
      if (dst === path.join(bdir, 'meta.json')) throw new Error('simulated metadata rename failure');
      fs.renameSync(src, dst);
    },
    rmSync: fs.rmSync.bind(fs),
    rmdirSync: fs.rmdirSync.bind(fs),
  };

  assert.throws(
    () => ensureBackup(app, [rel], bdir, { version: '1.0.0', commit: 'abc123', checksums: {} }, { fileOps }),
    /simulated metadata rename failure/,
  );
  assert.equal(fs.existsSync(path.join(bdir, 'files', rel)), false);
  assert.equal(fs.existsSync(path.join(bdir, 'meta.json')), false);
  const leftovers = fs.existsSync(bdir)
    ? fs.readdirSync(bdir, { recursive: true }).filter((name) => String(name).includes('.tmp-'))
    : [];
  assert.deepEqual(leftovers, []);
  fs.rmSync(root, { recursive: true, force: true });
});

