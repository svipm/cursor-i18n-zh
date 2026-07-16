'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const listed = cp.spawnSync('git', ['ls-files', '-co', '--exclude-standard'], {
  cwd: root,
  encoding: 'utf8',
});
if (listed.status !== 0) {
  console.error('无法读取 Git 文件列表.');
  process.exit(1);
}

const patterns = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/g],
  ['openai-key', /\bsk-[A-Za-z0-9_-]{32,}\b/g],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{16,}\b/g],
  ['cursor-session', /WorkosCursorSessionToken\s*[:=]\s*["'][^"'•\s]{20,}/gi],
  ['bearer-token', /Authorization\s*[:=]\s*["']Bearer\s+[A-Za-z0-9._-]{24,}/gi],
];

const findings = [];
for (const relative of listed.stdout.split(/\r?\n/).filter(Boolean)) {
  if (relative.replaceAll('\\', '/') === 'scripts/security-check.js') continue;
  const file = path.join(root, relative);
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    continue;
  }
  if (!stat.isFile() || stat.size > 8 * 1024 * 1024) continue;
  const buffer = fs.readFileSync(file);
  const text = buffer.toString(buffer.includes(0) ? 'latin1' : 'utf8');
  for (const [label, pattern] of patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) findings.push(`${relative}: ${label}`);
  }
  if (/^assets[\\/]screenshots[\\/]/i.test(relative)) {
    const emails = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    for (const email of emails) {
      if (!email.endsWith('@example.com')) findings.push(`${relative}: screenshot-email`);
    }
    if (/C:\\Users\\(?:admin|administrator)\\/i.test(text)) {
      findings.push(`${relative}: screenshot-user-path`);
    }
  }
}

if (findings.length) {
  console.error('敏感信息扫描失败:');
  findings.forEach((finding) => console.error(`- ${finding}`));
  process.exit(1);
}
console.log('敏感信息扫描通过.');
