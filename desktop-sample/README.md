# 汉化工作台 v0.3.7

执行以下约束:

- 使用 Tauri 2 + 原生 HTML/CSS/JavaScript + Rust.
- 首期只支持 Cursor 和 Claude Desktop.
- 复用根目录现有 Cursor CLI, 禁止复制补丁引擎.
- 只修改 Claude Desktop 的 3 个英文资源 JSON.
- 在独立备份选项卡创建不可覆盖的版本备份并校验 SHA256.
- Cursor 和 Claude Desktop 安装汉化前必须已有完整且校验通过的当前版本备份.
- 同时在前端按钮和 Rust 后端执行备份门禁, 禁止绕过界面直接安装.
- 在备份历史中显示创建时间, 应用版本, 文件数量和完整性状态, 仅允许兼容的当前版本备份一键恢复.
- 只读显示 Cursor 套餐, 计费周期, 请求数, Token 数和模型明细, 禁止向前端暴露登录令牌.
- 写入失败时恢复本轮已处理文件.
- 验证时只运行安全预检, 禁止执行真实安装或恢复.

## 新版本自动兼容

- 禁止维护 Cursor 或 Claude Desktop 版本号白名单.
- Cursor 自动扫描当前版本的已知入口和新增 `workbench.*.js` 大型入口包, 发现未来版本改名入口后纳入补丁计划.
- Claude Desktop 自动读取系统注册的最新安装版本, 校验 3 个 JSON 的路径, JSON 根结构和字符串内容.
- 每次目标应用升级后强制创建新的版本备份, 禁止跨版本恢复.
- 安装前继续执行完整语法或 JSON 预检. 结构变化时将应用标记为“结构待适配”并拒绝写入.
- 自动兼容只覆盖资源结构保持可识别的新版本, 不对上游彻底重写作不安全承诺.

## Claude Desktop 修改范围

只允许处理以下相对 `app/resources` 的文件:

```text
en-US.json
ion-dist/i18n/en-US.json
ion-dist/i18n/dynamic/en-US.json
```

禁止修改:

- `app.asar`.
- `Claude.exe`.
- 客户端配置和语言白名单.
- API, 网关, 模型路由或账号数据.

实际内嵌的翻译记忆库来自:

```text
https://github.com/GMYXDS/claude-desktop-zh-simple
```

内嵌版本为 `20260711180535`, 共 19276 条, 遵守 Apache-2.0. 查看 `resources/claude/SOURCE.md` 和 `resources/claude/APACHE-2.0.txt`.

以下项目仅用于实现调研和设计参考, 未复制代码, 图标, 翻译文件或发行资源:

- `https://github.com/javaht/claude-desktop-zh-cn`: Claude Desktop 资源定位, 备份和恢复流程参考.
- `https://github.com/bjrzs/Cursor_chinese`: Cursor 本机登录状态和用量查询思路参考.
- `https://github.com/Stack-Cairn/LiveAgent`: 桌面 GUI 信息架构参考, MIT.
- `https://github.com/zhukunpenglinyutong/desktop-cc-gui`: 桌面 GUI 交互形式参考, MIT.

Microsoft 官方 Cursor 中文语言包仅通过 Cursor CLI 按需安装或读取, 不内嵌, 不重新分发. 完整第三方依赖说明见根目录 `THIRD_PARTY_LICENSES`.

## Cursor 运行条件

- 安装 Node.js 18 或更高版本.
- 将 EXE 保留在当前项目的 `dist` 目录, 或设置 `CURSOR_I18N_ROOT` 指向 `cursor-i18n-zh` 根目录.
- GUI 调用根目录的 `src/cli.js`, 继续使用原有预检, 备份, 事务写入和恢复能力.

## Claude Desktop 运行条件

- 安装 Windows 版 Claude Desktop.
- 安全预检不需要管理员权限.
- 安装和恢复 WindowsApps 中的资源时, 使用界面的“管理员重启”按钮.
- 设置 `CLAUDE_RESOURCES_DIR` 可指定自定义 `app/resources` 目录.
- 备份和状态保存到 `%LOCALAPPDATA%\I18nWorkbench`.

## 备份规则

- 必须先在“备份”选项卡创建并校验当前应用版本的完整原始备份, 才能安装汉化.
- Cursor 备份保存到 `<项目根目录>\backup\<Cursor版本>`.
- Claude Desktop 备份保存到 `%LOCALAPPDATA%\I18nWorkbench\backups\claude\<版本>\original`.
- Cursor 校验版本, commit, 文件数量, 文件大小和 SHA256; Claude Desktop 校验版本, 3 个目标文件, 文件大小, SHA256 和 JSON 结构.
- 已存在但损坏或身份不匹配的备份不会被覆盖, 必须先由用户人工确认并处理异常备份.
- 安装入口同时执行前端和 Rust 后端门禁, 禁止绕过界面使用无效备份安装汉化.
- 备份历史保留不同软件版本的记录, 但历史版本和校验失败记录只允许查看, 禁止恢复到不匹配的当前安装版本.
- Claude Desktop 的恢复操作必须使用管理员权限, Cursor 恢复使用当前用户权限.

## Cursor 用量监控

- 只读 `%APPDATA%\Cursor\User\globalStorage\state.vscdb`.
- 只读取 Cursor 登录令牌和缓存邮箱, 凭据仅保留在 Rust 内存中.
- 仅向 Cursor 自有的套餐和模型用量接口发送凭据, 不写日志, 不返回前端, 不保存到工作台数据目录.
- 前端只接收套餐名称, 用量数字, 计费周期, 账户邮箱和模型汇总.
- Cursor 未登录, 登录过期或网络不可用时, 在用量卡片中显示明确错误, 不影响汉化和备份功能.

## 首次启动和隐私

- 首次启动必须阅读软件声明和隐私说明, 勾选同意后才能进入工作台.
- 同意前禁止应用扫描、Cursor 用量读取、GitHub 版本检查和 GitHub 头像加载.
- 同意结果只保存在当前 WebView 的本地存储中, 不上传到任何服务.
- 关于页提供完整声明的重新查看入口, GitHub 头像仅在打开关于页时按需加载.
- 工作台不包含遥测或行为分析, 本地备份内容和操作日志不会上传.

## v0.3.7 更新说明

- 修复 Cursor 备份历史将 Node.js 无填充 Base64 SHA256 误判为不匹配的问题.
- 更新项目说明与真实界面截图.

## v0.3.6 更新说明

- 修复 Claude Desktop 备份成功后因 `action` 未定义而误报失败的问题.
- `ureq` 改用 Windows 系统受信任证书链和系统代理, 修复 GitHub 更新检查的 `UnknownIssuer` 错误, 且不关闭证书校验.
- 关于页改为独立页面并按需渲染 GitHub 头像.
- 新增首次启动软件声明, 隐私说明和强制确认门禁.

## v0.3.5 更新说明

- Cursor 操作会自动结束 `Cursor.exe` 及其全部子进程树, 轮询确认并在残留时自动重试.
- 安装汉化或恢复原版成功后, 对应操作按钮都会切换为“完成”.
- 新增独立“关于”选项卡, 展示项目 GitHub 地址、项目图标和使用声明.
- 启动时后台检查 GitHub 最新正式发行版, 只提示并提供查看入口, 不自动下载、不强制更新.

## v0.3.4 更新说明

- 新增 Node.js 运行环境检测卡, 显示安装状态、版本、最低要求和 `node.exe` 路径.
- 区分未安装、版本低于 18 和已就绪状态, 仅禁用依赖 Node.js 的 Cursor 适配器.
- “重新扫描”和“重新检测”都会同步刷新 Node.js 状态与 Cursor 可用状态.

## v0.3.3 更新说明

- 修复 Cursor 设置页多词文案未在 `label`, `title`, `description`, `children` 等属性中替换的问题.
- 将 Cursor 原生“套餐和用量”组件嵌入账号信息区域, 继续使用 Cursor 自身账号会话和用量服务.
- 汉化安装成功后, 主操作按钮显示“完成”, 点击后关闭操作窗口.
- 已汉化应用的软件卡片显示“汉化已完成”.

## v0.3.2 更新说明

- 接入 Cursor 用量监控完整界面.
- 接入备份历史, 版本和时间展示及一键恢复.
- 修复 Cursor 语言包逻辑卸载后恢复原版误报失败.
- 强化备份 SHA256 校验和恢复版本门禁.

## 开发验证

执行:

```powershell
$env:RUSTUP_HOME='D:\github\.tools\rustup'
$env:CARGO_HOME='D:\github\.tools\cargo'
$env:PATH="$env:CARGO_HOME\bin;$env:PATH"

cd src-tauri
cargo fmt -- --check
cargo check
cargo test
cargo build --release
node --check ..\ui\app.js

cd ..\..
npm run package
npm run package-desktop
```

构建结果:

```text
src-tauri\target\release\cursor-i18n-desktop-sample.exe
..\dist\localization-workbench-v0.3.7.exe
..\dist\localization-workbench-v0.3.7-windows.zip
..\dist\SHA256SUMS.txt
```
