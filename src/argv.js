'use strict';

function normalizeArgv(raw) {
  return raw && raw.trim() ? raw : '{\n}';
}

function stripJsonComments(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      if (i < text.length) out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') out += '\n';
        i++;
      }
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

function stripTrailingCommas(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === '}' || text[j] === ']') continue;
    }
    out += ch;
  }
  return out;
}

function parseArgvJsonc(raw) {
  const text = stripTrailingCommas(stripJsonComments(normalizeArgv(raw)).replace(/^\uFEFF/, ''));
  return JSON.parse(text);
}

function skipWhitespaceAndComments(text, start) {
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i = Math.min(i + 2, text.length);
      continue;
    }
    break;
  }
  return i;
}

function stringEnd(text, start) {
  let escaped = false;
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') return i + 1;
  }
  return -1;
}

function jsonStringValue(text, start, end) {
  try { return JSON.parse(text.slice(start, end)); }
  catch (_) { return null; }
}

function valueEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
      continue;
    }
    if (ch === '{' || ch === '[') { depth++; continue; }
    if (ch === '}' || ch === ']') {
      if (depth === 0) return i;
      depth--;
      continue;
    }
    if (ch === ',' && depth === 0) return i;
  }
  return text.length;
}

function findTopLevelLocaleValue(text) {
  let depth = 0;
  let lastTopLevelComma = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
      continue;
    }
    if (ch === '"') {
      const end = stringEnd(text, i);
      if (end === -1) return null;
      if (depth === 1 && jsonStringValue(text, i, end) === 'locale') {
        const colon = skipWhitespaceAndComments(text, end);
        if (text[colon] === ':') {
          const start = skipWhitespaceAndComments(text, colon + 1);
          return { keyStart: i, commaBefore: lastTopLevelComma, start, end: valueEnd(text, start) };
        }
      }
      i = end - 1;
      continue;
    }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 1) lastTopLevelComma = i;
  }
  return null;
}

function setLocaleInArgv(raw, locale) {
  const src = normalizeArgv(raw);
  parseArgvJsonc(src);
  const value = JSON.stringify(locale);
  const found = findTopLevelLocaleValue(src);
  if (found) return `${src.slice(0, found.start)}${value}${src.slice(found.end)}`;

  const open = src.indexOf('{');
  const close = src.lastIndexOf('}');
  if (open === -1 || close === -1 || close < open) throw new Error('Cursor argv.json 顶层必须是 JSON 对象');

  const before = src.slice(0, open + 1);
  const body = src.slice(open + 1, close);
  const after = src.slice(close);
  const hasBody = body.trim().length > 0;
  const prefix = `
\t"locale": ${value}`;
  return hasBody
    ? `${before}${prefix},${body}${after}`
    : `${before}${prefix}\n${after}`;
}

function getLocaleState(raw) {
  const parsed = parseArgvJsonc(raw);
  const present = Object.prototype.hasOwnProperty.call(parsed, 'locale');
  return { present, value: present ? parsed.locale : undefined };
}

function removeLocaleFromArgv(raw) {
  const src = normalizeArgv(raw);
  parseArgvJsonc(src);
  const found = findTopLevelLocaleValue(src);
  if (!found) return src;

  const after = skipWhitespaceAndComments(src, found.end);
  if (src[after] === ',') {
    return `${src.slice(0, found.keyStart)}${src.slice(after + 1)}`;
  }
  if (found.commaBefore !== -1) {
    return `${src.slice(0, found.commaBefore)}${src.slice(found.end)}`;
  }
  return `${src.slice(0, found.keyStart)}${src.slice(found.end)}`;
}

module.exports = { getLocaleState, removeLocaleFromArgv, setLocaleInArgv, parseArgvJsonc };
