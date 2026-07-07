#!/usr/bin/env node
'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'src', 'cli.js');
const AGREEMENT_TEXT = '我已仔细阅读上述规则并同意继续使用';

function pause() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('\n按 Enter 返回菜单...', () => {
      rl.close();
      resolve();
    });
  });
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer).trim());
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
    case 'locate':
      runNode(['locate']);
      break;
    default:
      throw new Error(`未知操作: ${action}`);
  }
}

function printNotice() {
  console.clear();
  console.log('Cursor 汉化助手');
  console.log('='.repeat(56));
  console.log('使用声明和风险提示');
  console.log('');
  console.log('1. 本软件仅供学习, 研究和个人本地化测试使用.');
  console.log('2. 本软件不是 Cursor 官方项目, 与 Cursor 官方无从属或授权关系.');
  console.log('3. 使用本软件前, 请确认你有权在自己的电脑上修改本机软件文件.');
  console.log('4. 安装汉化会修改本机 Cursor 安装目录中的前端资源文件.');
  console.log('5. 首次安装会按 Cursor 版本自动备份原文件, 可通过菜单恢复默认.');
  console.log('6. 安装和恢复会先尝试关闭 Cursor.exe, 请提前保存未完成工作.');
  console.log('7. Cursor 升级后可能需要重新安装汉化, 也可能出现部分英文残留.');
  console.log('8. 本软件不收集个人数据, 不上传文件, 不下载或执行远程脚本.');
  console.log('9. 因使用本软件造成的兼容性问题, 文件损坏或其他风险, 由使用者自行承担.');
  console.log('');
  console.log('继续使用前, 必须完整输入以下文字:');
  console.log(AGREEMENT_TEXT);
  console.log('');
}

async function requireAgreement() {
  while (true) {
    printNotice();
    const answer = await ask('请输入: ');
    const lower = answer.toLowerCase();
    if (answer === AGREEMENT_TEXT) return true;
    if (lower === 'q' || lower === 'quit' || lower === 'exit') return false;
    console.log('\n输入不正确, 请完整输入指定文字.');
    await pause();
  }
}

function printMenu() {
  console.clear();
  console.log('Cursor 汉化助手');
  console.log('='.repeat(32));
  console.log(`项目目录: ${ROOT}`);
  console.log(`Node: ${process.version}`);
  console.log('');
  console.log('1. 安装汉化');
  console.log('2. 还原成默认');
  console.log('q. 退出');
  console.log('');
}

async function menu() {
  if (!fs.existsSync(CLI)) throw new Error(`找不到 CLI: ${CLI}`);
  if (!(await requireAgreement())) return;
  while (true) {
    printMenu();
    const choice = (await ask('请选择: ')).toLowerCase();
    if (choice === 'q' || choice === 'quit' || choice === 'exit') return;

    try {
      const map = { 1: 'install', 2: 'restore' };
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
  if (arg) {
    if ((arg === 'install' || arg === 'restore') && !(await requireAgreement())) return;
    return dispatch(arg);
  }
  return menu();
}

main().catch((e) => {
  console.error(`[错误] ${e.message}`);
  process.exit(1);
});
