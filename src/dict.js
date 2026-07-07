'use strict';

const fs = require('fs');
const path = require('path');

// 译文中禁止出现的字符: 保证替换后不破坏 JS 字符串/模板 HTML 结构.
const FORBIDDEN_ZH = /[<>"'`\\]|\$\{/;
// 原文中禁止的字符: 这些形态在压缩代码里以转义出现, 精确匹配不可靠, 直接拒绝.
const FORBIDDEN_EN = /["`\\]|\$\{/;
const VALID_CTX = new Set(['lit', 'prop', 'html-text', 'html-attr']);

// 加载 dict/ 目录:
//   nls.json          -> { "模块路径#key": "译文" }, 走 nls.messages.json 索引替换
//   其余 *.json (按文件名排序) -> { "原文": "译文" | { "zh": "...", "ctx": [...] } }
// 以 "//" 开头的键视为注释, 忽略.
function loadDicts(dictDir) {
  const code = new Map();
  const warnings = [];
  let nls = {};

  const files = fs.existsSync(dictDir)
    ? fs.readdirSync(dictDir).filter((f) => f.endsWith('.json')).sort()
    : [];

  for (const f of files) {
    const full = path.join(dictDir, f);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (e) {
      throw new Error(`词典 ${f} 不是合法 JSON: ${e.message}`);
    }

    if (f === 'nls.json') {
      for (const [key, zh] of Object.entries(data)) {
        if (key.startsWith('//')) continue;
        if (typeof zh !== 'string' || !zh) { warnings.push(`nls.json: ${key} 译文无效, 跳过`); continue; }
        nls[key] = zh;
      }
      continue;
    }

    for (const [en, val] of Object.entries(data)) {
      if (en.startsWith('//')) continue;
      const item = typeof val === 'string' ? { zh: val } : val;
      if (!item || typeof item.zh !== 'string' || !item.zh) {
        warnings.push(`${f}: "${en}" 译文无效, 跳过`); continue;
      }
      if (FORBIDDEN_EN.test(en)) {
        warnings.push(`${f}: "${en}" 原文含不支持字符 (" \` \\ 或 \${), 跳过`); continue;
      }
      if (FORBIDDEN_ZH.test(item.zh)) {
        warnings.push(`${f}: "${en}" 译文含禁止字符 (<> " ' \` \\ 或 \${), 跳过`); continue;
      }
      if (item.ctx) {
        const bad = item.ctx.filter((c) => !VALID_CTX.has(c));
        if (bad.length) { warnings.push(`${f}: "${en}" ctx 非法: ${bad.join(',')}, 跳过`); continue; }
      }
      if (code.has(en)) warnings.push(`"${en}" 在多个词典中重复, 以 ${f} 为准`);
      code.set(en, { zh: item.zh, ctx: item.ctx || null, from: f });
    }
  }

  return { code, nls, warnings, files };
}

module.exports = { loadDicts, FORBIDDEN_ZH };
