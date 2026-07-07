# cursor-i18n-zh

Cursor Windows 桌面端中文汉化工具. 本项目先启用官方 VS Code 简体中文语言包, 再用本项目词典补齐 Cursor 专有界面, 包括聊天, 设置, 面板, 托盘和部分菜单文案.

> 非 Cursor 官方项目. 补丁会修改本机 Cursor 安装目录下的前端资源文件, 首次安装会自动备份, 可一键恢复.

## 快速使用

推荐下载 GitHub Release 里的 `cursor-i18n-zh-windows.zip`.

1. 解压 zip.
2. 双击 `scripts\gui.cmd`.
3. 阅读声明和风险提示.
4. 完整输入 `我已仔细阅读上述规则并同意继续使用`.
5. 选择 `一键安装` 或 `还原默认`.
6. 重新打开 Cursor.

也可以直接双击这些脚本:

- `scripts\gui.cmd`: 打开图形界面.
- `scripts\cursor-i18n-helper.cmd`: 打开终端菜单.
- `scripts\install.cmd`: 命令行一键安装或更新汉化.
- `scripts\restore.cmd`: 命令行一键恢复原版.
- `scripts\status.cmd`: 命令行查看当前状态.

## 环境要求

- Windows 版 Cursor.
- Node.js 18 或更高版本.
- 安装或恢复前完全退出 Cursor, 包括托盘图标. 一键工具会尝试自动关闭 `Cursor.exe`.

## 自动适配安装目录

工具会自动寻找 Cursor 的 `resources/app` 目录, 支持常见位置:

- `%LOCALAPPDATA%\Programs\cursor\resources\app`
- `%ProgramFiles%\Cursor\resources\app`
- `%ProgramFiles(x86)%\Cursor\resources\app`
- `PATH` 中的 `cursor.cmd` 或 `Cursor.exe`
- 正在运行的 `Cursor.exe` 进程路径
- Windows 卸载注册表里的 Cursor 安装信息

如果你的 Cursor 是特殊安装位置, 手动设置环境变量:

```powershell
$env:CURSOR_APP_DIR = 'D:\Your\Cursor\resources\app'
npm run locate
```

## 命令行使用

```powershell
npm run status
npm run locate
npm run check
npm run lang
npm run apply
npm run restore
npm run scan
npm test
```

常用流程:

```powershell
npm run check
npm run lang
npm run apply
```

恢复原版:

```powershell
npm run restore
```

## 安全检查说明

`npm run check` 不会修改 Cursor. 一键安装会先自动运行这项检查. 它会执行这些检查:

- 校验 `dict/*.json` 能正常解析.
- 校验词典译文不包含高风险字符, 例如 `<`, `>`, 引号, 反斜杠和模板占位符.
- 自动定位本机 Cursor 安装目录.
- 检查可补丁目标文件是否存在.
- 在临时目录中预生成补丁结果, 并用 `node --check` 做 JavaScript 语法预检.

`一键安装` 会修改这些位置:

- Cursor 安装目录下的 `out/vs/workbench/*.js`, `out/main.js`, `out/nls.messages.json`, `product.json`.
- 当前用户的 `%USERPROFILE%\.cursor\argv.json`, 用于设置 `locale = zh-cn`.
- 当前用户的 Cursor 语言包缓存 `%APPDATA%\Cursor\clp`, 用于让新语言内容重新生成.

首次安装会把当前 Cursor 版本的原始文件备份到 `backup/<Cursor版本>/files`. `restore` 只从这个备份目录复制原文件回去.

## 是否安全

本项目的安全边界是可审计, 可备份, 可恢复:

- 不下载或执行远程脚本.
- 不收集任何用户数据.
- 不修改项目目录以外的文件, 除 Cursor 安装目录, Cursor locale 配置和语言包缓存.
- 不覆盖已存在备份, 避免把补丁后的文件误当成原版备份.
- 会尽量更新 Cursor `product.json` 中已有的 checksum, 降低资源校验失败风险.
- 所有汉化词条来自 `dict/*.json`, 替换规则在 `src/engine.js` 和 `src/nls.js` 中.

仍需注意:

- Cursor 升级后需要重新运行 `一键安装`.
- 如果 Cursor 正在运行, 文件可能被占用, 请完全退出后重试.
- 如果 Cursor 版本变化较大, 可能出现部分英文残留, 可运行 `npm run scan` 生成候选词条继续维护.

## GitHub 自动构建

仓库包含 GitHub Actions 工作流 `.github/workflows/build.yml`:

- 每次 push 和 pull request 自动运行 `npm test`.
- 自动运行 `npm run check` 校验词典和补丁语法.
- 自动执行 `scripts/package.ps1`, 生成 `dist/cursor-i18n-zh-windows.zip`.
- 每次构建都会上传 artifact.
- 推送 `v*` 标签时会自动创建 GitHub Release, 并把 zip 附加到发行版.

注意: 只有 push 不会生成发行版页面. 必须推送 `v*` 标签, GitHub Release 才会出现.

发布新版本示例:

```powershell
git tag v0.1.0
git push origin v0.1.0
```

## 维护词典

扫描当前 Cursor 版本候选文案:

```powershell
npm run scan
```

编辑 `dict/*.json`:

- `dict/nls.json`: 使用 `模块路径#key` 作为键, 替换 `out/nls.messages.json`.
- 其他 JSON: 使用英文原文作为键, 译文可以是字符串, 也可以是 `{ "zh": "译文", "ctx": ["prop"] }`.
- `ctx` 只允许 `lit`, `prop`, `html-text`, `html-attr`.
- 译文不要包含 `<`, `>`, `"`, `'`, `` ` ``, `\`, `${...}`.

修改后运行:

```powershell
npm test
npm run check
```

## 工作原理

- `lang` 设置 Cursor locale 为 `zh-cn`, 并尝试安装官方简体中文语言包 `ms-ceintl.vscode-language-pack-zh-hans`.
- `apply` 自动备份当前版本原文件, 再对代码层字符串和 nls 消息应用词典.
- `apply` 会把已安装的官方中文语言包内容合并到 Cursor 内置 `nls.messages.json`, 覆盖顶部菜单, 命令面板和 VS Code 设置等基础界面.
- `apply` 会继续用 `dict/nls.json` 覆盖 Cursor 专有 nls 文案.
- `restore` 从 `backup/<Cursor版本>/files` 恢复原始文件, 并清理语言包缓存.
