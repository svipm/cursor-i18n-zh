'use strict';

function normalizeArgv(raw) {
  const text = raw && raw.trim() ? raw : '{\n}';
  return /^\s*\{/.test(text) ? text : '{\n}';
}

function setLocaleInArgv(raw, locale) {
  const src = normalizeArgv(raw);
  const value = JSON.stringify(locale);
  if (/"locale"\s*:/.test(src)) {
    return src.replace(/("locale"\s*:\s*)"[^"]*"/, `$1${value}`);
  }

  const open = src.indexOf('{');
  const close = src.lastIndexOf('}');
  if (open === -1 || close === -1 || close < open) return `{\n\t"locale": ${value}\n}`;

  const before = src.slice(0, open + 1);
  const body = src.slice(open + 1, close);
  const after = src.slice(close);
  const hasBody = body.trim().length > 0;
  const prefix = `\n\t"locale": ${value}`;
  return hasBody
    ? `${before}${prefix},${body}${after}`
    : `${before}${prefix}\n${after}`;
}

module.exports = { setLocaleInArgv };
