# 更新日志

本文件记录正式发布版本. `v0.3.2` 至 `v0.3.5` 是 `v0.3.6` 发布前的内部迭代, 未单独创建 GitHub Release.

## [0.3.6] - 2026-07-15

### 新增

- 新增 Tauri 2 桌面汉化工作台, 首期统一支持 Cursor 和 Claude Desktop.
- 新增独立备份页. 安装汉化前必须创建不可覆盖的当前版本原始备份, 并完成版本, 文件大小和 SHA256 校验.
- 新增备份历史, 创建时间, 软件版本, 文件数量, 完整性状态和兼容版本一键恢复.
- 新增 Claude Desktop 适配器. 只修改 `app/resources` 下 3 个 `en-US.json`, 不修改 `Claude.exe`, `app.asar`, 客户端配置或账号数据.
- 新增 Cursor 用量监控, 展示套餐, 计费周期, 请求数, Token 和模型明细. 登录令牌只在 Rust 内存中使用.
- 新增 Node.js 18+ 状态检测, 路径展示和 Cursor 适配器运行门禁.
- 新增独立关于页, GitHub 头像, 项目入口和非强制更新检查.
- 新增首次启动软件声明与隐私说明. 用户同意前禁止本机扫描, 用量读取, GitHub 更新检查和头像加载.
- 新增桌面 EXE, 完整便携包和 SHA256 校验文件的自动构建与 GitHub Release 发布流程.
- 新增基于资源结构的新版本自动兼容检测. Cursor 自动发现未来 `workbench.*.js` 入口包, Claude Desktop 自动选择最新安装并校验 3 个 JSON; 结构变化时安全拒绝写入.

### 改进

- 扩充 Cursor 设置页, 导航, 账号和用量相关词典, 并修复多词文案在 UI 属性上下文中未替换的问题.
- 将 Cursor 原生套餐和用量入口嵌入账号信息区域, 继续使用 Cursor 自身账号会话和服务.
- Cursor 安装, 备份和恢复会自动结束完整进程树, 等待退出并在残留时重试.
- 安装汉化和恢复原版成功后, 对应按钮统一显示“完成”.
- GitHub 和 Cursor 网络请求改用 Windows 系统受信任证书链与系统代理, 保持完整 TLS 证书校验.

### 修复

- 修复 Claude Desktop 备份已经成功并通过校验后, 前端引用未定义 `action` 导致误报失败的问题.
- 修复 Cursor CLI 已完成语言包逻辑卸载, 但扩展目录延迟清理导致恢复原版误报失败的问题.
- 修复 Cursor 设置页部分内容未完整汉化的问题.
- 修复目标应用仍在运行时只能手动退出的问题.

### 资源与许可证

- Claude Desktop 翻译记忆库来自 [GMYXDS/claude-desktop-zh-simple](https://github.com/GMYXDS/claude-desktop-zh-simple), 固定内嵌版本 `20260711180535`, 共 19276 条映射, 遵守 Apache-2.0.
- `javaht/claude-desktop-zh-cn`, `bjrzs/Cursor_chinese`, `Stack-Cairn/LiveAgent` 和 `desktop-cc-gui` 仅作为实现调研参考, 未复制其代码, 图标, 翻译文件或发行资源.
- 完整说明见 `README.md`, `THIRD_PARTY_LICENSES` 和 `desktop-sample/resources/claude`.

### 验证

- Node.js 自动化测试 85 项全部通过.
- Rust 自动化测试 16 项全部通过, GitHub 系统证书链实网检查 1 项通过.
- 简体中文和繁体中文词典校验, Cursor 安全预检, Release 构建和 EXE 启动冒烟测试全部通过.

## [0.3.1] - 2026-07-12

- 新增事务化补丁提交和失败回滚.
- 强化备份元数据, 来源版本, commit, 文件大小和 SHA256 校验.
- 新增安装状态记录和语言包恢复.
- 改进 NLS 合并, 繁体转换和 JavaScript tokenizer 替换引擎.
- 增加 CI 词典检查, ZIP 冒烟测试和 GitHub Release 自动发布.

[0.3.6]: https://github.com/svipm/cursor-i18n-zh/compare/v0.3.1...v0.3.6
[0.3.1]: https://github.com/svipm/cursor-i18n-zh/releases/tag/v0.3.1
