#!/usr/bin/env node
'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'src', 'cli.js');

function pause() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('\n按 Enter 返回菜单...', () => {
      rl.close();
      resolve();
    });
  });
}

function confirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} 输入 y 确认: `, (answer) => {
      rl.close();
      resolve(String(answer).trim().toLowerCase() === 'y');
    });
  });
}

function runNode(args) {
  const r = cp.spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: false,
  });
  if (r.status !== 0) throw new Error(`命令失败: node src/cli.js ${args.join(' ')}`);
}

function stopCursor() {
  if (process.platform !== 'win32') return;
  cp.spawnSync('taskkill.exe', ['/IM', 'Cursor.exe', '/F', '/T'], {
    stdio: 'ignore',
    windowsHide: true,
  });
}

async function install() {
  if (!(await confirm('即将关闭 Cursor 并应用汉化补丁.'))) return;
  stopCursor();
  runNode(['check']);
  runNode(['lang']);
  runNode(['apply']);
  console.log('\n完成. 重新打开 Cursor 后生效.');
}

async function restore() {
  if (!(await confirm('即将关闭 Cursor 并恢复为备份原文件.'))) return;
  stopCursor();
  runNode(['restore']);
  console.log('\n完成. 重新打开 Cursor 后生效.');
}

async function dispatch(action) {
  switch (action) {
    case 'status':
      runNode(['status']);
      break;
    case 'check':
      runNode(['check']);
      break;
    case 'install':
      await install();
      break;
    case 'restore':
      await restore();
      break;
    case 'scan':
      runNode(['scan']);
      break;
    default:
      throw new Error(`未知操作: ${action}`);
  }
}

function printMenu() {
  console.clear();
  console.log('Cursor 汉化助手');
  console.log('='.repeat(32));
  console.log(`项目目录: ${ROOT}`);
  console.log(`Node: ${process.version}`);
  console.log('');
  console.log('1. 查看状态');
  console.log('2. 安全检查');
  console.log('3. 一键安装或更新汉化');
  console.log('4. 一键恢复原版');
  console.log('5. 扫描残留英文候选');
  console.log('q. 退出');
  console.log('');
}

async function menu() {
  if (!fs.existsSync(CLI)) throw new Error(`找不到 CLI: ${CLI}`);
  while (true) {
    printMenu();
    const choice = await new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('请选择: ', (answer) => {
        rl.close();
        resolve(String(answer).trim().toLowerCase());
      });
    });
    if (choice === 'q' || choice === 'quit' || choice === 'exit') return;

    try {
      const map = { 1: 'status', 2: 'check', 3: 'install', 4: 'restore', 5: 'scan' };
      if (!map[choice]) throw new Error('请选择菜单中的编号.');
      await dispatch(map[choice]);
    } catch (e) {
      console.error(`\n[错误] ${e.message}`);
    }
    await pause();
  }
}

async function main() {
  const arg = process.argv[2] && process.argv[2].replace(/^--/, '').toLowerCase();
  if (arg) return dispatch(arg);
  return menu();
}

main().catch((e) => {
  console.error(`[错误] ${e.message}`);
  process.exit(1);
});
