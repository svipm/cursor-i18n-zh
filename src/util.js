'use strict';

const fs = require('fs');
const crypto = require('crypto');

// 与 VS Code product.json checksums 一致: sha256 -> base64 -> 去掉尾部 '='.
function sha256b64(buf) {
  return crypto.createHash('sha256').update(buf).digest('base64').replace(/=+$/, '');
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

module.exports = { sha256b64, readJson, ensureDir };
