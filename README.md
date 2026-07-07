# cursor-i18n-zh

[![build](https://github.com/svipm/cursor-i18n-zh/actions/workflows/build.yml/badge.svg)](https://github.com/svipm/cursor-i18n-zh/actions/workflows/build.yml)
[![release](https://img.shields.io/github/v/release/svipm/cursor-i18n-zh?display_name=tag)](https://github.com/svipm/cursor-i18n-zh/releases)
[![license](https://img.shields.io/github/license/svipm/cursor-i18n-zh)](LICENSE)

Cursor Windows 桌面端中文汉化补丁工具. 支持简体中文和繁體中文, 支持自动定位 Cursor 安装目录, 一键安装, 一键恢复, 安全预检和 GitHub Actions 自动打包发布.

本项目不是 Cursor 官方项目. 它会修改本机 Cursor 安装目录中的前端资源文件, 首次安装会按 Cursor 版本自动备份原文件, 可通过工具恢复默认.

## 使用声明

运行图形界面或终端菜单前, 工具会先展示声明和风险条款. 用户必须完整输入下面这句话, 才能继续使用:

```text
我已仔细阅读上述规则并同意继续使用
```

声明要点:

- 本软件仅供学习, 研究和个人本地化测试使用.
- 本软件不是 Cursor 官方项目, 与 Cursor 官方无从属或授权关系.
- 使用前请确认你有权在自己的电脑上修改本机软件文件.
- 安装汉化会修改本机 Cursor 安装目录中的前端资源文件.
- 安装和恢复会尝试关闭 `Cursor.exe`, 请提前保存未完成工作.
- Cursor 升级后可能需要重新安装汉化, 也可能出现部分英文残留.
- 本软件不收集个人数据, 不上传文件, 不下载或执行远程脚本.
- 因使用本软件造成的兼容性问题, 文件损坏或其他风险, 由使用者自行承担.

## 快速开始

推荐下载发行版压缩包:

```text
https://github.com/svipm/cursor-i18n-zh/releases/latest
```

使用步骤:

1. 下载 `cursor-i18n-zh-windows.zip`.
2. 解压到任意目录.
3. 双击根目录的 `Cursor汉化助手.cmd` 打开终端菜单.
4. 阅读声明, 完整输入同意文字.
5. 选择 `简体中文` 或 `繁體中文`.
6. 点击或选择 `一键安装`.
7. 重新打开 Cursor.

恢复原版:

1. 双击根目录的 `还原默认.cmd`, 或打开 `Cursor汉化助手.cmd` 后选择 `2. 还原成默认`.
2. 阅读声明, 完整输入同意文字.
3. 确认恢复.
4. 重新打开 Cursor.

## 根目录入口

发行版 zip 解压后, 根目录会直接提供这些可双击文件:

- `Cursor汉化助手.cmd`: 推荐入口. 打开终端菜单, 先展示声明, 再显示 `1. 安装汉化`, `2. 还原成默认`.
- `Cursor汉化助手-图形界面.cmd`: 打开图形界面, 支持语言选择, 一键安装, 一键恢复.
- `一键安装汉化.cmd`: 直接进入安装流程, 仍会先展示声明并要求输入同意文字.
- `还原默认.cmd`: 直接进入恢复流程, 仍会先展示声明并要求输入同意文字.

`scripts` 目录保留为开发和备用入口:

- `scripts\gui.cmd`: 图形界面, 支持语言选择, 一键安装, 一键恢复.
- `scripts\cursor-i18n-helper.cmd`: 终端菜单, 先展示声明, 再显示 `1. 安装汉化`, `2. 还原成默认`.
- `scripts\install.cmd`: 终端安装入口, 会进入声明和语言选择流程.
- `scripts\restore.cmd`: 终端恢复入口, 会进入声明流程.
- `scripts\status.cmd`: 查看当前 Cursor 路径, 备份, 文件修改状态和语言包状态.

## 为什么不是单个 exe

当前发行版是一个 zip, 解压后用根目录 `.cmd` 作为入口. 项目没有封装成不可审计的单个 exe, 原因是:

- 词典, 源码和脚本保留在包内, 用户可以直接检查会修改哪些内容.
- `README.md`, `dict`, `src`, `scripts` 都随包发布, 安全边界更透明.
- 备份和恢复逻辑依赖这些可审计脚本, 出问题时更容易定位和修复.

如果只想给普通用户一个最简单入口, 让对方双击根目录的 `Cursor汉化助手.cmd` 即可.

## 命令行

需要 Node.js 18 或更高版本.

```powershell
npm run locate
npm run status
npm run check
npm run lang
npm run apply
npm run restore
npm test
```

指定语言:

```powershell
npm run check -- --locale zh-cn
npm run lang -- --locale zh-cn
npm run apply -- --locale zh-cn

npm run check -- --locale zh-tw
npm run lang -- --locale zh-tw
npm run apply -- --locale zh-tw
```

可用语言:

- `zh-cn`: 简体中文, 使用官方 `ms-ceintl.vscode-language-pack-zh-hans` 语言包.
- `zh-tw`: 繁體中文, 优先使用官方 `ms-ceintl.vscode-language-pack-zh-hant` 语言包; 如果本机未安装, 会尝试使用简体语言包内容并转换为繁体.

## 自动定位 Cursor

工具会自动寻找 Cursor 的 `resources/app` 目录, 支持这些来源:

- `%LOCALAPPDATA%\Programs\cursor\resources\app`
- `%ProgramFiles%\Cursor\resources\app`
- `%ProgramFiles(x86)%\Cursor\resources\app`
- `PATH` 中的 `cursor.cmd`, `cursor`, `Cursor.exe`
- 正在运行的 `Cursor.exe` 进程路径
- Windows 卸载注册表中的 Cursor 安装信息
- `CURSOR_APP_DIR` 或 `CURSOR_EXE` 环境变量

特殊安装目录可以手动指定:

```powershell
$env:CURSOR_APP_DIR = 'D:\Your\Cursor\resources\app'
npm run locate
```

查看全部探测来源:

```powershell
npm run locate -- --verbose
```

## 安全检查

`npm run check` 不修改 Cursor. 一键安装会先执行这项检查.

检查内容:

- 校验 `dict/*.json` 是否为合法 JSON.
- 校验译文是否包含高风险字符, 例如 `<`, `>`, 引号, 反斜杠和模板占位符.
- 自动定位 Cursor 安装目录.
- 检查当前版本可补丁目标是否存在.
- 预生成补丁结果, 并用 `node --check` 做 JavaScript 语法预检.

安装会修改的位置:

- Cursor 安装目录下的 `out/vs/workbench/*.js`, `out/main.js`, `out/nls.messages.json`, `product.json`.
- 当前用户的 `%USERPROFILE%\.cursor\argv.json`, 用于设置 `locale`.
- 当前用户的 `%APPDATA%\Cursor\clp`, 用于清理语言包缓存并让 Cursor 重建.

工具会保留 Cursor 默认 `argv.json` 中的 `//` 注释, 并按 JSONC 规则校验和写入 `locale`.

备份策略:

- 首次安装会把当前 Cursor 版本的原始文件保存到 `backup/<Cursor版本>/files`.
- 已存在的备份不会被覆盖, 避免把补丁后的文件误当作原版.
- `restore` 只从对应 Cursor 版本的备份目录复制原文件回去.

项目安全边界:

- 不下载或执行远程脚本.
- 不收集, 读取或上传个人数据.
- 不修改无关目录.
- 不绕过 Cursor 登录, 订阅, 授权或网络服务.
- 所有替换词条来自 `dict/*.json`, 替换逻辑在 `src/engine.js` 和 `src/nls.js` 中, 可直接审计.

## 工作原理

安装流程:

1. 自动定位 Cursor 安装目录.
2. 读取 Cursor 版本和 `product.json`.
3. 备份当前版本原始文件.
4. 设置 Cursor `argv.json` 中的 `locale`.
5. 尝试安装对应官方中文语言包.
6. 将官方语言包内容合并进 Cursor 内置 `nls.messages.json`, 覆盖顶部菜单, 命令面板, VS Code 设置等基础界面.
7. 用 `dict/nls.json` 覆盖 Cursor 专有 nls 文案.
8. 用代码层词典替换 Cursor 专有前端文案.
9. 更新 `product.json` 中已有 checksum.
10. 清理语言包缓存, 让 Cursor 重启后重新生成.

繁體中文模式会以简体词典为源, 在加载词典和导入语言包时执行简转繁转换. 这样维护时只需要维护一份中文词典.

## 维护词典

扫描当前 Cursor 版本候选文案:

```powershell
npm run scan
```

编辑规则:

- `dict/nls.json`: 使用 `模块路径#key` 作为键, 替换 `out/nls.messages.json`.
- 其他 JSON: 使用英文原文作为键, 译文可以是字符串, 也可以是 `{ "zh": "译文", "ctx": ["prop"] }`.
- `ctx` 只允许 `lit`, `prop`, `html-text`, `html-attr`.
- 译文不要包含 `<`, `>`, `"`, `'`, `` ` ``, `\`, `${...}`.

修改后运行:

```powershell
npm test
npm run check -- --locale zh-cn
npm run check -- --locale zh-tw
```

## 打包和发布

本仓库包含 GitHub Actions 工作流 `.github/workflows/build.yml`.

每次 push 或 pull request 会自动执行:

- `npm test`
- `npm run check`
- `scripts/package.ps1`
- 上传 `cursor-i18n-zh-windows.zip` artifact

推送 `v*` 标签时会自动创建 GitHub Release, 并把 zip 上传到发行版:

```powershell
git tag -a v0.2.2 -m "v0.2.2"
git push origin v0.2.2
```

只 push 到 `main` 不会生成发行版页面. 需要推送版本标签, Release 才会出现.

## 已知边界

- Cursor 每个版本的前端产物可能变化, 新版本可能出现英文残留.
- 顶部菜单和 VS Code 设置主要依赖官方语言包与内置 NLS 合并.
- Cursor 专有新功能需要持续补充 `dict/*.json`.
- 如果 Cursor 正在运行导致文件占用, 请完全退出后重试.
