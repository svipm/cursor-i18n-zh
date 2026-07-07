'use strict';

const fs = require('fs');
const path = require('path');
const { readJson } = require('./util');

function candidates() {
  const list = [];
  if (process.env.CURSOR_APP_DIR) list.push(process.env.CURSOR_APP_DIR);
  if (process.env.LOCALAPPDATA) {
    list.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'cursor', 'resources', 'app'));
  }
  return list;
}

// 返回 resources/app 绝对路径.
function locateApp() {
  for (const dir of candidates()) {
    if (dir && fs.existsSync(path.join(dir, 'product.json'))) return path.resolve(dir);
  }
  throw new Error('未找到 Cursor 安装目录; 可用环境变量 CURSOR_APP_DIR 指定 resources/app 路径');
}

function readProduct(appDir) {
  return readJson(path.join(appDir, 'product.json'));
}

module.exports = { locateApp, readProduct };
