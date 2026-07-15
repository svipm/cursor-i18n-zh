'use strict';

const fs = require('fs');
const path = require('path');
const { sha256b64, ensureDir } = require('./util');

let atomicWriteSequence = 0;


function backupExists(bdir, rel) {
  return fs.existsSync(backupFilePath(bdir, rel));
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function normalizeCommit(commit) {
  return commit == null || commit === '' ? null : String(commit);
}

function hasBackupFiles(bdir) {
  return listBackupFiles(bdir).length > 0;
}

function inspectBackupMetadata(bdir, product = null) {
  const metaPath = path.join(bdir, 'meta.json');
  const hasMeta = fs.existsSync(metaPath);
  if (!hasMeta && !hasBackupFiles(bdir)) return { meta: null, issues: [] };
  if (!hasMeta) return { meta: null, issues: [{ reason: 'missing-meta' }] };

  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (error) {
    return { meta: null, issues: [{ reason: 'invalid-meta', message: error.message }] };
  }

  if (!meta || typeof meta !== 'object' || Array.isArray(meta)
    || !meta.files || typeof meta.files !== 'object' || Array.isArray(meta.files)) {
    return { meta: null, issues: [{ reason: 'invalid-meta', message: 'meta.json 缺少有效的 files 对象' }] };
  }

  const issues = [];
  const expectedVersion = product && product.version != null
    ? String(product.version)
    : path.basename(bdir);
  if (String(meta.version || '') !== expectedVersion) {
    issues.push({
      reason: 'metadata-version',
      expected: expectedVersion,
      actual: meta.version == null ? null : String(meta.version),
    });
  }

  if (!hasOwn(meta, 'commit')) {
    issues.push({ reason: 'metadata-commit-missing' });
  } else if (product) {
    const expectedCommit = normalizeCommit(product.commit);
    const actualCommit = normalizeCommit(meta.commit);
    if (actualCommit !== expectedCommit) {
      issues.push({ reason: 'metadata-commit', expected: expectedCommit, actual: actualCommit });
    }
  }

  return { meta, issues };
}

function validateBackupMetadata(bdir, product = null) {
  return inspectBackupMetadata(bdir, product).issues;
}

function findLocalizedMatches(text, translations, limit = 5) {
  // 原始 Cursor 产物不含汉字时, 不必对每条中文译文重复扫描整份大文件.
  if (!/[\u3400-\u9FFF\uF900-\uFAFF]/.test(text)) return [];
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
  const issues = validateBackupFiles(bdir, relPaths, {
    product,
    translations: options.translations || [],
  });
  if (issues.length) return issues;

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
  const { meta, issues } = inspectBackupMetadata(bdir, options.product || null);
  const translations = options.translations || [];
  const rels = new Set(relPaths || []);
  if (meta) {
    for (const rel of Object.keys(meta.files)) rels.add(rel);
  }

  for (const rel of rels) {
    const src = backupFilePath(bdir, rel);
    const exists = fs.existsSync(src);
    const record = meta && meta.files[rel];

    if (meta && exists && (!record || typeof record !== 'object')) {
      issues.push({ rel, reason: 'metadata-file-missing' });
    } else if (meta && !exists && record) {
      issues.push({ rel, reason: 'backup-file-missing' });
    } else if (meta && exists && record) {
      const buf = fs.readFileSync(src);
      const actualSize = buf.length;
      const actualSha = sha256b64(buf);
      if (!Number.isInteger(record.size) || record.size < 0 || record.size !== actualSize) {
        issues.push({ rel, reason: 'backup-size', expected: record.size, actual: actualSize });
      }
      if (typeof record.sha256 !== 'string' || record.sha256 !== actualSha) {
        issues.push({ rel, reason: 'backup-checksum', expected: record.sha256, actual: actualSha });
      }
    }

    if (!exists || !/\.(js|json)$/i.test(rel)) continue;
    const matches = findLocalizedMatches(fs.readFileSync(src, 'utf8'), translations);
    if (matches.length) issues.push({ rel, reason: 'localized-backup', matches });
  }

  return issues;
}

// 安装门禁使用: 当前版本实际存在的每个目标都必须进入备份并通过元数据校验.
function validateCompleteBackup(appDir, relPaths, bdir, product, options = {}) {
  const issues = validateBackupFiles(bdir, relPaths, {
    product,
    translations: options.translations || [],
  });
  const { meta } = inspectBackupMetadata(bdir, product);

  for (const rel of relPaths) {
    if (!fs.existsSync(path.join(appDir, rel))) continue;
    const fileExists = backupExists(bdir, rel);
    const recorded = Boolean(meta && meta.files && meta.files[rel]);
    if (!fileExists && !recorded) issues.push({ rel, reason: 'required-backup-missing' });
  }

  return issues;
}

function formatIssue(issue) {
  const rel = issue.rel ? `${issue.rel}: ` : '';
  switch (issue.reason) {
    case 'missing-meta':
      return '- 缺少 meta.json, 无法确认备份身份与完整性.';
    case 'invalid-meta':
      return `- meta.json 无效: ${issue.message || '格式错误'}.`;
    case 'metadata-version':
      return `- 备份版本不匹配: 期望 ${issue.expected}, 实际 ${issue.actual || '(缺失)'}.`;
    case 'metadata-commit-missing':
      return '- meta.json 缺少 commit, 无法确认备份对应的 Cursor 构建.';
    case 'metadata-commit':
      return `- 备份 commit 不匹配: 期望 ${issue.expected || '(空)'}, 实际 ${issue.actual || '(空)'}.`;
    case 'metadata-file-missing':
      return `- ${rel}文件存在, 但 meta.json 中没有对应记录.`;
    case 'backup-file-missing':
      return `- ${rel}meta.json 有记录, 但备份文件缺失.`;
    case 'required-backup-missing':
      return `- ${rel}当前版本存在该文件, 但完整备份中缺失.`;
    case 'backup-size':
      return `- ${rel}文件大小不符 (期望 ${issue.expected}, 实际 ${issue.actual}).`;
    case 'backup-checksum':
      return `- ${rel}SHA256 不符, 备份文件可能已损坏或被修改.`;
    case 'localized-backup':
      return `- ${rel}检测到已汉化内容 (${issue.matches.join(', ')}).`;
    case 'checksum':
      return `- ${rel}当前 checksum 与 product.json 不一致.`;
    case 'localized':
      return `- ${rel}检测到已汉化内容 (${issue.matches.join(', ')}).`;
    default:
      return `- ${rel}${issue.reason || '未知备份错误'}.`;
  }
}

function formatBackupFileIssues(issues, version) {
  const onlyLocalized = issues.length > 0 && issues.every((issue) => issue.reason === 'localized-backup');
  const lines = [
    onlyLocalized
      ? `检测到 Cursor ${version} 的备份文件已包含汉化内容; 已停止操作, 避免继续使用错误备份导致无法恢复英文.`
      : `Cursor ${version} 的备份身份或完整性校验失败; 已停止操作, 避免使用错误或损坏的备份.`,
  ];
  for (const issue of issues.slice(0, 8)) {
    lines.push(formatIssue(issue));
  }
  if (issues.length > 8) lines.push(`- 另有 ${issues.length - 8} 个备份文件存在同类问题.`);
  lines.push('处理方式: 删除错误 backup 后, 先重装/更新 Cursor 让文件回到原版, 再重新安装汉化并生成新的原始备份.');
  return lines.join('\n');
}

function formatBackupSourceIssues(issues, version) {
  const hasBackupIssue = issues.some((issue) => !['checksum', 'localized'].includes(issue.reason));
  const lines = [
    hasBackupIssue
      ? `Cursor ${version} 的现有备份身份或完整性校验失败; 已停止安装, 避免复用错误或损坏的备份.`
      : `检测到 Cursor ${version} 的原始备份缺失, 且当前文件不像原版; 已停止安装, 避免把已汉化文件备份为原版.`,
  ];
  for (const issue of issues.slice(0, 8)) {
    lines.push(formatIssue(issue));
  }
  if (issues.length > 8) lines.push(`- 另有 ${issues.length - 8} 个文件存在同类问题.`);
  lines.push('处理方式: 先使用仍保留原始 backup 的旧工具目录执行还原, 或重装/更新 Cursor 让文件回到原版, 再重新安装汉化.');
  return lines.join('\n');
}

// 备份布局: <项目>/backup/<版本>/files/<相对路径> + meta.json
function backupDir(projectRoot, version) {
  return path.join(projectRoot, 'backup', version);
}

function atomicWriteFile(dst, data, fileOps = fs) {
  ensureDir(path.dirname(dst));
  const tmp = `${dst}.tmp-${process.pid}-${Date.now()}-${++atomicWriteSequence}`;
  try {
    fileOps.writeFileSync(tmp, data, { flag: 'wx' });
    fileOps.renameSync(tmp, dst);
  } catch (error) {
    try {
      fileOps.rmSync(tmp, { force: true });
    } catch (_) {
      // 保留原始写入错误.
    }
    throw error;
  }
}

function removeEmptyParents(start, stop, fileOps = fs) {
  let current = start;
  const boundary = path.resolve(stop);
  while (path.resolve(current).startsWith(`${boundary}${path.sep}`)) {
    try {
      fileOps.rmdirSync(current);
    } catch (_) {
      break;
    }
    current = path.dirname(current);
  }
}

// 首次接触的文件复制进备份; 已有备份的文件跳过 (保持原始状态).
// 返回警告列表 (例如原始文件与官方 checksum 不符).
function ensureBackup(appDir, relPaths, bdir, product, options = {}) {
  const warnings = [];
  const fileOps = options.fileOps || fs;
  const metaPath = path.join(bdir, 'meta.json');
  const backupIssues = validateBackupFiles(bdir, relPaths, { product });
  if (backupIssues.length) throw new Error(formatBackupFileIssues(backupIssues, product.version));

  const existingMeta = fs.existsSync(metaPath)
    ? JSON.parse(fs.readFileSync(metaPath, 'utf8'))
    : null;
  const meta = existingMeta
    ? { ...existingMeta, files: { ...existingMeta.files } }
    : {
        version: product.version,
        commit: normalizeCommit(product.commit),
        createdAt: new Date().toISOString(),
        files: {},
      };
  const created = [];

  try {
    for (const rel of relPaths) {
      const dst = path.join(bdir, 'files', rel);
      if (fs.existsSync(dst)) continue;
      const src = path.join(appDir, rel);
      if (!fs.existsSync(src)) {
        // 当前 Cursor 版本没有该目标文件 (例如新版本移除了某 nls 文件), 跳过备份, 不报错.
        // 调用方依赖的 restore 也会因备份缺失而自然跳过该文件, 保持前向兼容.
        continue;
      }
      const buf = fs.readFileSync(src);
      const sha = sha256b64(buf);
      const expected = product.checksums && product.checksums[rel.replace(/^out\//, '')];
      if (expected && expected !== sha) {
        warnings.push(`${rel} 与官方 checksum 不符, 备份的可能不是原版文件 (此前被其他工具修改过?)`);
      }
      atomicWriteFile(dst, buf, fileOps);
      created.push(dst);
      meta.files[rel] = { sha256: sha, size: buf.length };
    }

    if (!existingMeta || created.length) {
      atomicWriteFile(metaPath, JSON.stringify(meta, null, 2), fileOps);
    }
  } catch (error) {
    for (const dst of created.reverse()) {
      try {
        fileOps.rmSync(dst, { force: true });
        removeEmptyParents(path.dirname(dst), path.join(bdir, 'files'), fileOps);
      } catch (_) {
        // 保留原始写入错误.
      }
    }
    throw error;
  }

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
  validateCompleteBackup,
  validateBackupMetadata,
  formatBackupSourceIssues,
  formatBackupFileIssues,
  findLocalizedMatches,
};
