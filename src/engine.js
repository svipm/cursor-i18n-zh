'use strict';

const { PROPS, HTML_ATTRS } = require('./config');

function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 默认上下文策略:
//   多词短语作为语义键/枚举值的概率极低 -> 允许完整字面量替换 (lit 已覆盖 prop 场景);
//   单词太容易撞上枚举值或标识符 -> 只在白名单属性位和模板文本节点替换.
function defaultCtx(en) {
  const words = en.trim().split(/\s+/).length;
  return words >= 2
    ? ['lit', 'html-text', 'html-attr']
    : ['prop', 'html-text', 'html-attr'];
}

function altsOf(map) {
  return [...map.keys()].sort((a, b) => b.length - a.length).map(escRe).join('|');
}

// 生成替换 pass 序列. 每个 pass 是一次全文正则替换, 命中即计数.
function buildPasses(entries) {
  const buckets = { lit: new Map(), prop: new Map(), 'html-text': new Map(), 'html-attr': new Map() };
  for (const [en, e] of entries) {
    for (const c of (e.ctx || defaultCtx(en))) buckets[c].set(en, e.zh);
  }

  const passes = [];
  const props = PROPS.map(escRe).join('|');
  const attrs = HTML_ATTRS.map(escRe).join('|');

  if (buckets.prop.size) {
    const a = altsOf(buckets.prop);
    // {label:"X"  ,label:"X"  {"aria-label":"X"
    passes.push({
      name: 'prop', map: buckets.prop, enGroup: 4,
      re: new RegExp(`([{,]("|')?(?:${props})\\2:)("|')(${a})\\3`, 'g'),
      build: (m, zh) => `${m[1]}${m[3]}${zh}${m[3]}`,
    });
    // x.title="X"
    passes.push({
      name: 'prop-assign', map: buckets.prop, enGroup: 3,
      re: new RegExp(`(\\.(?:${props})=)("|')(${a})\\2`, 'g'),
      build: (m, zh) => `${m[1]}${m[2]}${zh}${m[2]}`,
    });
  }
  if (buckets['html-attr'].size) {
    const a = altsOf(buckets['html-attr']);
    // 模板 HTML: placeholder="X"
    passes.push({
      name: 'html-attr', map: buckets['html-attr'], enGroup: 2,
      re: new RegExp(`((?:${attrs})=")(${a})"`, 'g'),
      build: (m, zh) => `${m[1]}${zh}"`,
    });
  }
  if (buckets['html-text'].size) {
    const a = altsOf(buckets['html-text']);
    // 模板 HTML 文本节点: >X< ; (?<!=) 排除箭头函数 =>X< 撞名的情况
    passes.push({
      name: 'html-text', map: buckets['html-text'], enGroup: 1,
      re: new RegExp(`(?<!=)>(${a})<`, 'g'),
      build: (m, zh) => `>${zh}<`,
    });
  }
  if (buckets.lit.size) {
    const a = altsOf(buckets.lit);
    // 完整字符串字面量: "X" 'X' `X` (引号必须成对)
    passes.push({
      name: 'lit', map: buckets.lit, enGroup: 2,
      re: new RegExp('("|\'|`)(' + a + ')\\1', 'g'),
      build: (m, zh) => `${m[1]}${zh}${m[1]}`,
    });
  }
  return passes;
}

// 对整份文本按词典替换. 返回 { text, counts: Map<en, n>, total }.
function applyToText(text, entries) {
  const counts = new Map();
  let total = 0;
  for (const pass of buildPasses(entries)) {
    text = text.replace(pass.re, (...args) => {
      const m = args;
      const en = m[pass.enGroup];
      const zh = pass.map.get(en);
      if (zh === undefined) return m[0];
      counts.set(en, (counts.get(en) || 0) + 1);
      total++;
      return pass.build(m, zh);
    });
  }
  return { text, counts, total };
}

module.exports = { applyToText, defaultCtx };
