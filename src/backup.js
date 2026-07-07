'use strict';

const fs = require('fs');
const path = require('path');
const { sha256b64, ensureDir } = require('./util');

// 备份布局: <项目>/backup/<版本>/files/<相对路径> + meta.json
function backupDir(projectRoot, version) {
  return path.join(projectRoot, 'backup', version);
}

// 首次接触的文件复制进备份; 已有备份的文件跳过 (保持原始状态).
// 返回警告列表 (例如原始文件与官方 checksum 不符).
function ensureBackup(appDir, relPaths, bdir, product) {
  const warnings = [];
  const metaPath = path.join(bdir, 'meta.json');
  const meta = fs.existsSync(metaPath)
    ? JSON.parse(fs.readFileSync(metaPath, 'utf8'))
    : { version: product.version, commit: product.commit, createdAt: new Date().toISOString(), files: {} };

  for (const rel of relPaths) {
    const dst = path.join(bdir, 'files', rel);
    if (fs.existsSync(dst)) continue;
    const src = path.join(appDir, rel);
    const buf = fs.readFileSync(src);
    const sha = sha256b64(buf);
    const expected = product.checksums && product.checksums[rel.replace(/^out\//, '')];
    if (expected && expected !== sha) {
      warnings.push(`${rel} 与官方 checksum 不符, 备份的可能不是原版文件 (此前被其他工具修改过?)`);
    }
    ensureDir(path.dirname(dst));
    fs.writeFileSync(dst, buf);
    meta.files[rel] = { sha256: sha, size: buf.length };
  }

  ensureDir(bdir);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  return warnings;
}

function backupFilePath(bdir, rel) {
  return path.join(bdir, 'files', rel);
}

// 遍历备份树, 返回所有已备份文件的相对路径.
function listBackupFiles(bdir) {
  const root = path.join(bdir, 'files');
  if (!fs.existsSync(root)) return [];
  const out = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else out.push(path.relative(root, full).replace(/\\/g, '/'));
    }
  })(root);
  return out;
}

module.exports = { backupDir, ensureBackup, backupFilePath, listBackupFiles };
