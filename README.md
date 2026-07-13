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

1. 安装 Node.js 18 或更高版本.
2. 下载 `cursor-i18n-zh-windows.zip`.
3. 解压到任意目录.
4. 双击根目录的 `Cursor汉化助手.cmd` 打开终端菜单.
5. 阅读声明, 完整输入同意文字.
6. 选择 `简体中文` 或 `繁體中文`.
7. 点击或选择 `一键安装`.
8. 重新打开 Cursor.

恢复原版:

1. 双击根目录的 `还原默认.cmd`, 或打开 `Cursor汉化助手.cmd` 后选择 `2. 还原成默认`.
2. 阅读声明, 完整输入同意文字.
3. 确认恢复.
4. 工具会事务化恢复 Cursor 文件和安装前的语言设置; 如果语言包由本工具安装, 也会将其卸载.
5. 重新打开 Cursor.

## 效果图

![Cursor 汉化效果图 1](assets/screenshots/effect-1.png)

![Cursor 汉化效果图 2](assets/screenshots/effect-2.png)

## 根目录入口

发行版 zip 解压后, 根目录会直接提供这些可双击文件:

- `Cursor汉化助手.cmd`: 推荐入口. 打开终端菜单, 先展示声明, 再显示 `1. 安装汉化`, `2. 还原成默认`.
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
npm run dict-check
npm run patch-install -- --locale zh-cn
npm run lang
npm run apply
npm run restore
npm test
```

指定语言:

```powershell
npm run check -- --locale zh-cn
npm run patch-install -- --locale zh-cn

npm run check -- --locale zh-tw
npm run patch-install -- --locale zh-tw
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

`npm run check` 是严格预检, 不修改 Cursor. 定位失败, 目标缺失, 备份异常, 自定义 NLS 词典歧义, 占位符错误或补丁后语法错误都会返回非零状态并停止安装. 官方语言包自身的歧义项和占位符不一致项会跳过并报告. `npm run dict-check` 只校验词典, 供 CI 使用.

检查内容:

- 校验 `dict/*.json` 是否为合法 JSON.
- 校验译文是否包含高风险字符, 例如 `<`, `>`, 引号, 反斜杠和模板占位符.
- 自动定位 Cursor 安装目录.
- 检查当前版本可补丁目标是否存在.
- 校验自定义 `dict/nls.json` 的歧义和占位符错误; 跳过并报告官方语言包中同一 key 对应不同原文的歧义项, 以及占位符不一致项.
- 预生成全部补丁结果, 并使用 Node.js 语法检查器校验 JavaScript.

工作台入口包会自动发现: 除内置锚点目标 (`workbench.glass.main.js`, `workbench.desktop.main.js`, `workbench.anysphere-ui-automations.js`, `out/main.js`) 外, 还会扫描 `out/vs/workbench/` 下其它大体积 `workbench.*.js` 入口包, 兼容未来 Cursor 版本新增或改名的工作台包. 缺失的目标会自动跳过, 不存在的文件不会被备份也不会报错.

安装会修改的位置:

- Cursor 安装目录下的 `out/vs/workbench/*.js`, `out/main.js`, `out/nls.messages.json`, `product.json`.
- 当前用户的 `%USERPROFILE%\.cursor\argv.json`, 用于设置 `locale`.
- 当前用户的 `%APPDATA%\Cursor\clp`, 用于清理语言包缓存并让 Cursor 重建.

工具会保留 Cursor 默认 `argv.json` 中的 `//` 注释, 并按 JSONC 规则校验和写入 `locale`.

备份策略:

- 首次安装会把当前 Cursor 版本的原始文件保存到 `backup/<Cursor版本>/files`.
- `meta.json` 会记录 Cursor version, commit, 文件大小和 SHA256; 安装和恢复前都会重新校验.
- 创建新备份前会先校验来源文件; 如果当前 Cursor 已被汉化或已被其他工具修改, 会停止安装, 避免把汉化后的文件误备份成原版.
- 已存在的备份不会被覆盖, 避免把补丁后的文件误当作原版.
- 备份和正式文件均使用同目录临时文件提交; 中途失败会清理本轮新增内容.
- 当前版本不存在的文件会被跳过 (例如某些 Cursor 版本没有独立 `nls.messages.json`), 不会因文件缺失而中断备份或安装.
- 安装前会保存原始 locale 和语言包存在状态; `restore` 会与资源文件一起恢复.
- `apply` 和 `restore` 会先暂存并验证全部目标, 再统一提交; 任一替换失败会自动回滚已提交文件.
- 恢复前会检查备份内容; 如果备份本身已经包含汉化内容, 会停止恢复并提示先重装或更新 Cursor 后重新生成干净备份.

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
3. 在关闭 Cursor 前完成严格预检, 预生成全部补丁并校验语法.
4. 关闭 Cursor, 校验并备份当前版本原始文件.
5. 保存安装前的 locale 和语言包状态.
6. 安装对应官方中文语言包并设置 `argv.json` 的 locale.
7. 合并官方语言包和 `dict/nls.json`, 再生成代码层词典补丁.
8. 根据补丁结果更新 `product.json` 中已有 checksum.
9. 将全部结果暂存后统一提交; 任一步失败会回滚文件和本次用户状态修改.
10. 清理语言包缓存, 让 Cursor 重启后重新生成.

繁體中文模式下, 项目自定义简体词典始终会使用 `opencc-js` 的台湾繁体词组转换, 再应用项目内的技术术语覆盖. 官方语言包会优先使用原生 `zh-Hant`; 原生繁体内容不会二次转换. 只有本机没有 `zh-Hant` 而 fallback 到 `zh-Hans` 官方语言包时, 才会把官方简体内容转换为繁体.

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
- `npm run dict-check`
- `scripts/package.ps1`
- 解压发行包并运行 CLI 帮助命令做冒烟测试
- 上传 `cursor-i18n-zh-windows.zip` artifact

推送 `v*` 标签时会自动创建 GitHub Release, 并把 zip 上传到发行版:

```powershell
git tag -a v0.3.1 -m "v0.3.1"
git push origin v0.3.1
```

只 push 到 `main` 不会生成发行版页面. 需要推送版本标签, Release 才会出现.

## 鸣谢与友链

- LINUX DO: <https://linux.do>
  感谢 LINUX DO 社区的支持与讨论.

## 已知边界

- Cursor 每个版本的前端产物可能变化, 新版本可能出现英文残留.
- 顶部菜单和 VS Code 设置主要依赖官方语言包与内置 NLS 合并.
- Cursor 专有新功能需要持续补充 `dict/*.json`.
- 同一 NLS key 对应不同英文原文时会跳过该官方语言包词条, 避免错误覆盖.
- 安装官方语言包需要网络; 发行包仍要求本机已有 Node.js 18 或更高版本.
