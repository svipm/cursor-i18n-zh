'use strict';

// 不同 Cursor 版本可能新增, 改名或拆分工作台入口包 (glass / desktop / anysphere 等).
// 这里做前向兼容: 以 CODE_TARGETS 为稳定锚点, 再扫描工作台目录发现其它大体积入口包,
// 合并去重后返回. 不存在的目标由调用方自动跳过 (existingTargets).
//
// 判定入口包的依据 (避免误伤非入口小文件):
//   1. 位于 WORKBENCH_DIR 下;
//   2. 文件名匹配 WORKBENCH_BUNDLE_RE (workbench.*.js);
//   3. 体积 >= WORKBENCH_BUNDLE_MIN_SIZE (真实入口包均在 MB 级).

const fs = require('fs');
const path = require('path');
const {
  CODE_TARGETS, WORKBENCH_DIR, WORKBENCH_BUNDLE_RE, WORKBENCH_BUNDLE_MIN_SIZE,
} = require('./config');

// 锚点目标固定在最前, 保持输出顺序稳定; 后续自动发现的入口包按文件名排序追加.
// 列表元素统一使用 posix 风格相对路径 (out/...).
function discoverTargets(appDir) {
  const seen = new Set(CODE_TARGETS);
  const ordered = [...CODE_TARGETS];
  const dir = path.join(appDir, WORKBENCH_DIR);
  if (fs.existsSync(dir)) {
    const found = fs.readdirSync(dir)
      .filter((name) => WORKBENCH_BUNDLE_RE.test(name))
      .filter((name) => {
        try {
          return fs.statSync(path.join(dir, name)).size >= WORKBENCH_BUNDLE_MIN_SIZE;
        } catch (_) {
          return false;
        }
      })
      .map((name) => `${WORKBENCH_DIR}/${name}`)
      .sort();
    for (const rel of found) {
      if (seen.has(rel)) continue;
      seen.add(rel);
      ordered.push(rel);
    }
  }
  return ordered;
}

module.exports = { discoverTargets };
