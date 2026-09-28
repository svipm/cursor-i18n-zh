'use strict';

const { tokenizer } = require('acorn');
const { PROPS, HTML_ATTRS } = require('./config');

function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function defaultCtx(en) {
  const words = en.trim().split(/\s+/).length;
  return words >= 2
    ? ['lit', 'prop', 'html-text', 'html-attr']
    : ['prop', 'html-text', 'html-attr'];
}

function bucketEntries(entries) {
  const buckets = { lit: new Map(), prop: new Map(), 'html-text': new Map(), 'html-attr': new Map() };
  for (const [en, e] of entries) {
    for (const c of (e.ctx || defaultCtx(en))) buckets[c].set(en, e.zh);
  }
  return buckets;
}

function alternatives(map) {
  return [...map.keys()].sort((a, b) => b.length - a.length).map(escRe).join('|');
}

function buildHtmlMatchers(buckets) {
  const attrs = HTML_ATTRS.map(escRe).join('|');
  const attrAlternatives = alternatives(buckets['html-attr']);
  const textAlternatives = alternatives(buckets['html-text']);
  return {
    attr: attrAlternatives
      ? new RegExp(`((?:${attrs})=")(${attrAlternatives})"`, 'g')
      : null,
    text: textAlternatives
      ? new RegExp(`(?<!=)>(${textAlternatives})(<|$)`, 'g')
      : null,
  };
}

function htmlReplacements(raw, buckets, matchers, counts) {
  let text = raw;
  let total = 0;

  if (matchers.attr && text.includes('="')) {
    text = text.replace(matchers.attr, (match, prefix, en) => {
      const zh = buckets['html-attr'].get(en);
      if (zh === undefined) return match;
      counts.set(en, (counts.get(en) || 0) + 1);
      total++;
      return `${prefix}${zh}"`;
    });
  }

  if (matchers.text && text.includes('>')) {
    text = text.replace(matchers.text, (match, en, suffix) => {
      const zh = buckets['html-text'].get(en);
      if (zh === undefined) return match;
      counts.set(en, (counts.get(en) || 0) + 1);
      total++;
      return `>${zh}${suffix}`;
    });
  }
  return { text, total };
}

function isStandaloneHtml(text) {
  return /^\s*<(?:!doctype\b|[a-z][\w:-]*(?:\s|\/?>))/i.test(text);
}

function encodeLiteral(value, quote) {
  let encoded = value
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  if (quote === '`') return encoded.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  return encoded.replace(new RegExp(escRe(quote), 'g'), `\\${quote}`);
}

function isPropName(token, props) {
  return token && (token.type.label === 'name' || token.type.label === 'string')
    && props.has(String(token.value));
}

function applyToText(text, entries) {
  const buckets = bucketEntries(entries);
  const htmlMatchers = buildHtmlMatchers(buckets);
  const props = new Set(PROPS);
  const counts = new Map();

  if (isStandaloneHtml(text)) {
    const html = htmlReplacements(text, buckets, htmlMatchers, counts);
    return { text: html.text, counts, total: html.total };
  }

  const replacements = [];
  const tokens = tokenizer(text, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    allowHashBang: true,
  });
  let forAwaitState = 0;
  let forAwaitParenDepth = 0;
  // 用滚动变量代替数组队列: 大型 bundle 有上千万 token, push/shift 是纯额外开销.
  // prev1 是紧邻当前 token 的前一个, prev2/prev3 依次更早.
  let prev1 = null;
  let prev2 = null;
  let prev3 = null;

  while (true) {
    const token = tokens.getToken();
    const label = token.type.label;
    if (label === 'eof') break;

    if (forAwaitParenDepth > 0) {
      if (label === '(') forAwaitParenDepth++;
      if (label === ')' && --forAwaitParenDepth === 0) tokens.exprAllowed = true;
    } else if (label === 'for') {
      forAwaitState = 1;
    } else if (forAwaitState === 1 && label === 'name' && token.value === 'await') {
      forAwaitState = 2;
    } else if (forAwaitState === 2 && label === '(') {
      forAwaitState = 0;
      forAwaitParenDepth = 1;
    } else {
      forAwaitState = 0;
    }

    if (label === 'string' || label === 'template') {
      const rawStart = label === 'string' ? token.start + 1 : token.start;
      const rawEnd = label === 'string' ? token.end - 1 : token.end;
      const quote = label === 'string' ? text[token.start] : '`';
      const originalRaw = text.slice(rawStart, rawEnd);
      let replacement = originalRaw;
      let changed = false;

      // prop 上下文: {label:"..."} 的键值, 或 a.label="..." 赋值目标.
      const literalMap = label === 'template'
        ? buckets.lit
        : prev1 && prev2 && prev1.type.label === ':' && isPropName(prev2, props)
          ? buckets.prop
          : prev1 && prev2 && prev3
            && prev1.type.label === '=' && prev2.type.label === 'name'
            && isPropName(prev2, props) && prev3.type.label === '.'
            ? buckets.prop
            : buckets.lit;
      const en = String(token.value);
      const zh = literalMap.get(en);
      if (zh !== undefined) {
        replacement = encodeLiteral(zh, quote);
        changed = true;
        counts.set(en, (counts.get(en) || 0) + 1);
      }

      // 只有字面量里确实出现 HTML 结构时才值得跑 html 词典,
      // 绝大多数字符串字面量既没有 ">" 也没有 ="", 直接跳过.
      if (replacement.includes('>') || replacement.includes('="')) {
        const html = htmlReplacements(replacement, buckets, htmlMatchers, counts);
        if (html.total > 0) {
          replacement = html.text;
          changed = true;
        }
      }

      if (changed) replacements.push({ start: rawStart, end: rawEnd, text: replacement });
    }

    prev3 = prev2;
    prev2 = prev1;
    prev1 = token;
  }

  if (!replacements.length) return { text, counts, total: 0 };
  let output = '';
  let cursor = 0;
  for (const item of replacements) {
    output += text.slice(cursor, item.start);
    output += item.text;
    cursor = item.end;
  }
  output += text.slice(cursor);
  return {
    text: output,
    counts,
    total: [...counts.values()].reduce((sum, count) => sum + count, 0),
  };
}

module.exports = { applyToText, defaultCtx };
