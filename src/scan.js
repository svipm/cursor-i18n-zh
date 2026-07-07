'use strict';

// 字符串提取器: 从压缩产物里挖出候选 UI 文案, 供词典作者 (人) 筛选翻译.
// 输出 build/scan-code.tsv (count \t ctx \t props \t files \t string)
//     build/scan-nls.tsv  (模块#key \t 英文原文)

const fs = require('fs');
const path = require('path');
const { PROPS, HTML_ATTRS, NLS_KEYS, NLS_MESSAGES, CURSOR_NLS_RE } = require('./config');
const { readJson, ensureDir } = require('./util');

function looksLikeUI(s) {
  if (s.length < 2 || s.length > 120) return false;
  if (/[\\<>{}]/.test(s)) return false;                       // 转义序列/标签碎片
  if (/https?:|:\/\/|www\./.test(s)) return false;            // URL
  if (!/[A-Za-z]{2}/.test(s)) return false;                   // 无有效字母
  if (!/\s/.test(s) && /[._$/:-]/.test(s)) return false;      // 代码风格 token
  if (/^[A-Z0-9_]{3,}$/.test(s)) return false;                // 全大写常量
  if (!/\s/.test(s) && /^[a-z]/.test(s) && /[A-Z]/.test(s)) return false; // camelCase
  return true;
}

function* iter(re, text) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) yield m;
}

function scanFile(file, agg) {
  const text = fs.readFileSync(file, 'utf8');
  const name = path.basename(file);
  const props = PROPS.join('|');
  const attrs = HTML_ATTRS.join('|');
  const patterns = [
    ['prop', new RegExp(`[{,]("?)(${props})\\1:"([^"\\\\]{2,140})"`, 'g'), 3, 2],
    ['html-text', />([A-Z][^<>{}"`\\]{1,90})</g, 1, null],
    ['html-attr', new RegExp(`(${attrs})="([^"\\\\{}<>]{2,120})"`, 'g'), 2, 1],
    ['lit-sent', /"([A-Z][A-Za-z0-9'’,.:;!?()/&%+\- ]{5,140})"/g, 1, null],
  ];
  for (const [ctx, re, gi, propGi] of patterns) {
    for (const m of iter(re, text)) {
      const s = m[gi];
      if (ctx === 'lit-sent' && !/[a-z] [a-z]/i.test(s)) continue; // 只收多词句子
      if (!looksLikeUI(s)) continue;
      let e = agg.get(s);
      if (!e) { e = { count: 0, ctx: new Set(), props: new Set(), files: new Set() }; agg.set(s, e); }
      e.count++;
      e.ctx.add(ctx);
      if (propGi && m[propGi]) e.props.add(m[propGi]);
      e.files.add(name);
    }
  }
}

function scanCode(appDir, targets, outDir) {
  const agg = new Map();
  for (const rel of targets) scanFile(path.join(appDir, rel), agg);
  const rows = [...agg.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
  const tsv = rows.map(([s, e]) =>
    [e.count, [...e.ctx].join(','), [...e.props].join(','), [...e.files].map(f => f.replace(/^workbench\.|\.main\.js$|\.js$/g, '')).join(','), s].join('\t')
  ).join('\n');
  ensureDir(outDir);
  const out = path.join(outDir, 'scan-code.tsv');
  fs.writeFileSync(out, 'count\tctx\tprops\tfiles\tstring\n' + tsv);
  return { out, total: rows.length };
}

function scanNls(appDir, outDir) {
  const keys = readJson(path.join(appDir, NLS_KEYS));
  const msgs = readJson(path.join(appDir, NLS_MESSAGES));
  let i = 0;
  const rows = [];
  for (const [mod, ks] of keys) {
    for (const k of ks) {
      const msg = msgs[i++];
      if (CURSOR_NLS_RE.test(mod)) rows.push(`${mod}#${k}\t${String(msg).replace(/\t|\n/g, ' ')}`);
    }
  }
  if (i !== msgs.length) throw new Error(`nls keys 展开数 ${i} != messages 条数 ${msgs.length}`);
  ensureDir(outDir);
  const out = path.join(outDir, 'scan-nls.tsv');
  fs.writeFileSync(out, 'key\tenglish\n' + rows.join('\n'));
  return { out, total: rows.length };
}

module.exports = { scanCode, scanNls };
