'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function tempPath(target, kind) {
  const token = crypto.randomBytes(8).toString('hex');
  return path.join(path.dirname(target), `.${path.basename(target)}.cursor-i18n-${kind}-${process.pid}-${token}`);
}

function removeQuietly(file) {
  try { fs.rmSync(file, { force: true }); } catch (_) { }
}

function stageFile(target, data) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const staged = tempPath(target, 'stage');
  const mode = fs.existsSync(target) ? fs.statSync(target).mode : undefined;
  fs.writeFileSync(staged, data, mode === undefined ? undefined : { mode });
  const fd = fs.openSync(staged, 'r+');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return staged;
}

function rollbackItem(item, options = {}) {
  if (options.beforeRollback) options.beforeRollback(item.target, item.rollback);
  if (item.existed) {
    if (!item.rollback || !fs.existsSync(item.rollback)) {
      throw new Error(`缺少原文件回滚副本: ${item.target}`);
    }
    if (fs.existsSync(item.target)) fs.rmSync(item.target, { force: true });
    fs.renameSync(item.rollback, item.target);
    return;
  }
  if (fs.existsSync(item.target)) fs.rmSync(item.target, { force: true });
}

// 多文件提交无法由文件系统原生保证原子性, 因此先完整暂存, 再用同目录重命名提交.
// 任一替换失败时, 使用回滚副本恢复所有已提交目标.
function commitFiles(entries, options = {}) {
  if (!Array.isArray(entries) || !entries.length) return [];

  const seen = new Set();
  const normalized = entries.map((entry) => {
    if (!entry || !entry.target) throw new Error('事务条目缺少 target');
    const target = path.resolve(entry.target);
    const key = process.platform === 'win32' ? target.toLowerCase() : target;
    if (seen.has(key)) throw new Error(`事务包含重复目标: ${target}`);
    seen.add(key);
    return {
      target,
      remove: entry.remove === true,
      data: entry.data,
    };
  });

  const staged = [];
  try {
    for (let index = 0; index < normalized.length; index++) {
      const item = normalized[index];
      if (options.beforeStage) options.beforeStage(item.target, index);
      staged.push({
        target: item.target,
        remove: item.remove,
        staged: item.remove ? null : stageFile(item.target, item.data),
        rollback: null,
        existed: false,
      });
    }
  } catch (error) {
    for (const item of staged) if (item.staged) removeQuietly(item.staged);
    throw error;
  }

  const committed = [];
  try {
    for (let index = 0; index < staged.length; index++) {
      const item = staged[index];
      if (options.beforeReplace) options.beforeReplace(item.target, index);

      item.existed = fs.existsSync(item.target);
      if (item.existed) {
        item.rollback = tempPath(item.target, 'rollback');
        fs.renameSync(item.target, item.rollback);
      }

      committed.push(item);
      if (options.beforeStageCommit) options.beforeStageCommit(item.target, index);
      if (!item.remove) fs.renameSync(item.staged, item.target);
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const item of committed.reverse()) {
      try {
        rollbackItem(item, options);
      } catch (rollbackError) {
        rollbackErrors.push({ item, error: rollbackError });
      }
    }
    for (const item of staged) {
      if (item.staged) removeQuietly(item.staged);
    }
    if (rollbackErrors.length) {
      const details = rollbackErrors.map(({ item, error: rollbackError }) => {
        const recovery = item.rollback && fs.existsSync(item.rollback)
          ? `, 原文件保留在 ${item.rollback}`
          : '';
        return `${item.target}: ${rollbackError.message}${recovery}`;
      }).join('; ');
      throw new Error(`${error.message}; 事务回滚失败: ${details}`);
    }
    throw error;
  }

  for (const item of committed) {
    if (item.rollback) removeQuietly(item.rollback);
  }
  return committed.map((item) => item.target);
}

function atomicWriteFile(target, data) {
  commitFiles([{ target, data }]);
}

module.exports = { atomicWriteFile, commitFiles };
