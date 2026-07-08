'use strict';

const fs = require('fs');
const path = require('path');
const { sha256b64, ensureDir } = require('./util');


function backupExists(bdir, rel) {
  return fs.existsSync(backupFilePath(bdir, rel));
}

function findLocalizedMatches(text, translations, limit = 5) {
  const matches = [];
  for (const item of translations || []) {
    if (!item || item.length < 2) continue;
    if (text.includes(item)) {
      matches.push(item);
      if (matches.length >= limit) break;
    }
  }
  return matches;
}

// 创建新备份前必须确认来源仍像原版. 否则会把已汉化文件写成“原始备份”, 导致恢复英文失败.
function validateBackupSources(appDir, relPaths, bdir, product, options = {}) {
  const issues = [];
  const translations = options.translations || [];

  for (const rel of relPaths) {
    if (backupExists(bdir, rel)) continue;
    const src = path.join(appDir, rel);
    if (!fs.existsSync(src)) continue;

    const buf = fs.readFileSync(src);
    const sha = sha256b64(buf);
    const expected = product.checksums && product.checksums[rel.replace(/^out\//, '')];
    if (expected && expected !== sha) {
      issues.push({ rel, reason: 'checksum', expected, actual: sha });
      continue;
    }

    if (/\.(js|json)$/i.test(rel)) {
      const matches = findLocalizedMatches(buf.toString('utf8'), translations);
      if (matches.length) issues.push({ rel, reason: 'localized', matches });
    }
  }

  return issues;
}

function validateBackupFiles(bdir, relPaths, options = {}) {
  const issues = [];
  const translations = options.translations || [];

  for (const rel of relPaths) {
    const src = backupFilePath(bdir, rel);
    if (!fs.existsSync(src) || !/\.(js|json)$/i.test(rel)) continue;
    const matches = findLocalizedMatches(fs.readFileSync(src, 'utf8'), translations);
    if (matches.length) issues.push({ rel, reason: 'localized-backup', matches });
  }

  return issues;
}

function formatBackupFileIssues(issues, version) {
  const lines = [
    `检测到 Cursor ${version} 的备份文件已包含汉化内容; 已停止操作, 避免继续使用错误备份导致无法恢复英文.`,
  ];
  for (const issue of issues.slice(0, 8)) {
    lines.push(`- ${issue.rel}: 检测到已汉化内容 (${issue.matches.join(', ')}).`);
  }
  if (issues.length > 8) lines.push(`- 另有 ${issues.length - 8} 个备份文件存在同类问题.`);
  lines.push('处理方式: 删除错误 backup 后, 先重装/更新 Cursor 让文件回到原版, 再重新安装汉化并生成新的原始备份.');
  return lines.join('\n');
}

function formatBackupSourceIssues(issues, version) {
  const lines = [
    `检测到 Cursor ${version} 的原始备份缺失, 且当前文件不像原版; 已停止安装, 避免把已汉化文件备份为原版.`,
  ];
  for (const issue of issues.slice(0, 8)) {
    if (issue.reason === 'checksum') {
      lines.push(`- ${issue.rel}: 当前 checksum 与 product.json 不一致.`);
    } else if (issue.reason === 'localized') {
      lines.push(`- ${issue.rel}: 检测到已汉化内容 (${issue.matches.join(', ')}).`);
    }
  }
  if (issues.length > 8) lines.push(`- 另有 ${issues.length - 8} 个文件存在同类问题.`);
  lines.push('处理方式: 先使用仍保留原始 backup 的旧工具目录执行还原, 或重装/更新 Cursor 让文件回到原版, 再重新安装汉化.');
  return lines.join('\n');
}

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

module.exports = {
  backupDir,
  ensureBackup,
  backupFilePath,
  listBackupFiles,
  validateBackupSources,
  validateBackupFiles,
  formatBackupSourceIssues,
  formatBackupFileIssues,
  findLocalizedMatches,
};
