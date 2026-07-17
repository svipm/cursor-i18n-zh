# 更新日志

本文件记录正式发布版本. `v0.3.2` 至 `v0.3.5` 是 `v0.3.6` 发布前的内部迭代, 未单独创建 GitHub Release.

## [未发布]

### 修复

- 修复 Cursor 自动兼容工作流使用 `Start-Process -Wait` 后被安装器派生进程长期阻塞的问题.
- 官方 Inno Setup 安装器改用正确的 `/VERYSILENT` 参数并安装到隔离临时目录, 轮询版本与 commit, 单步限制 15 分钟, 成功后清理安装器进程树; 失败时输出安装日志, 超时或取消也会创建兼容性问题.
- Cursor 下载 API commit 与已签名安装包 `product.json` commit 不一致时分别记录, 使用实际安装身份执行兼容验证, 同时使用 API commit 判断后续稳定版是否变化.
- 安装器进程树清理改为独立读取退出码, 避免安装器恰好自行退出时将无害的 `taskkill` 非零码误报为兼容构建失败.
- 同版本自动兼容构建恢复成功后, 工作流会补充成功运行链接并自动关闭对应失败 Issue.

### 改进

- 根据 Cursor 3.12.10 实际扫描结果补充 Markdown 计划编辑器、外部智能体操作、Cursor Undo、文件引用菜单、反馈入口、Local Trace、Cursor Blame 和新增设置文案.
- 补齐 Cursor 3.12.10 调整大小写后的智能体、侧边聊天、工作树、LSP、窗口恢复、Claude Code 导入、插件和隐私提示文案, 保持精确匹配并避免误翻代码值.

## [0.4.2] - 2026-07-17

### 新增

- 关于页新增更新下载进度条, 实时展示发行版读取、SHA256 清单、累计下载 MB、校验和原子提交阶段.
- 后端通过独立 `update-download-progress` 事件发送进度, 不把下载任务或文件内容交给前端处理.
- 有 Content-Length 时按实际字节比例显示 20% 至 90% 下载进度; 缺少长度时继续显示累计下载量.
- 修复连续下载时旧计时器可能提前隐藏新进度的问题.
- 更新包已经校验但打开所在目录失败时, 保留下载成功状态并显示独立警告, 不再误报为下载失败.

### 验证

- Node.js 自动化测试 99 项全部通过.
- Rust 自动化测试 57 项通过, 5 项实网测试在默认套件中忽略并已单独全部通过.
- Windows Release 构建、便携包和 SHA256 冒烟验证通过.

## [0.4.1] - 2026-07-16

### 改进

- 更新包改为 64 KB 缓冲区流式写盘和增量 SHA256, 不再将最大 250 MB 的发行资源整体读入内存.
- 如果本地更新包 SHA256 与当前 Release 清单一致, 直接复用已校验缓存并打开所在目录.
- 损坏或过期缓存会重新下载, 新文件通过临时文件和旧文件备份执行可回滚原子替换.
- 下载、写盘或大小校验失败时自动删除不完整临时文件.
- 更新日志和提示明确区分“流式下载完成”和“本地缓存已校验”.

### 验证

- Node.js 自动化测试 99 项全部通过.
- Rust 自动化测试 57 项通过, 5 项实网测试在默认套件中忽略并已单独全部通过.
- 新增本地 HTTP 流式下载、大小限制、增量哈希和覆盖旧缓存测试.
- Windows Release 构建、便携包内容与 SHA256 冒烟验证通过.

## [0.4.0] - 2026-07-16

### 新增

- 私密扩展配置包新增 `.iwbundle` 格式, 使用 Argon2id 从用户密码派生 256 位密钥, 并使用 AES-256-GCM 执行认证加密.
- 导出界面新增密码与确认密码输入, 导入界面新增密码输入和已选文件重新预检.
- 新增扩展目标适配器描述清单, 后端统一提供适配器版本、说明和用户级或项目级能力.
- 扩展工具栏动态显示当前适配器版本及 MCP, Skills, 提示词, 健康检测和迁移能力.
- GitHub 项目、市场、版本检查和更新下载新增瞬时错误重试, 自动处理 HTTP 500/502/503/504、超时和短暂连接失败.

### 安全

- 后端强制拒绝将包含 MCP 环境变量或请求头的私密配置包导出为明文 JSON.
- 加密配置包使用独立随机盐和随机 nonce, 并绑定固定 AAD; 错误密码、密文篡改或参数异常均会停止导入.
- KDF 参数设置安全上下限, 防止恶意配置包使用极端 Argon2 参数造成资源耗尽.
- 密钥派生缓冲区与加解密明文缓冲区在使用后主动清零, 减少敏感数据在进程内存中的残留时间.
- 配置包导入拒绝符号链接和非普通文件, 明文包限制 64 MB, 加密外层限制 96 MB.
- 保留旧版明文私密包导入兼容, 界面明确警告导入后删除源文件, 新版本不再生成此类文件.

### 验证

- Node.js 自动化测试 99 项全部通过.
- Rust 自动化测试 55 项通过, 5 项实网测试在默认套件中忽略并已单独全部通过.
- 通过正确密码往返、错误密码、密文篡改、明文私密导出拒绝和适配器描述清单回归测试.
- 1180x760, 1180x1000 和 980x640 静态界面验收通过.

## [0.3.9] - 2026-07-16

### 新增

- 新增 MCP 实际健康检测. stdio 服务会启动进程并执行 `initialize` 握手, HTTP 和 SSE 会请求真实端点, 界面显示状态, 延迟和协议版本.
- 新增结构化扩展历史. MCP, 完整 Skill 目录, 提示词和来源注册表在修改前统一快照, 支持差异展示和一键恢复.
- 新增 Skill 安全审计, 检查 frontmatter, 本地引用, 脚本, 网络访问, Shell, 外部进程, 完整目录 SHA256 和固定提交来源.
- 新增 Cursor 与 Claude Code 跨应用复制, 自动转换 MCP 与提示词格式, 支持脱敏和私密配置包导入导出及冲突预检.
- 新增扩展搜索, 状态与风险筛选, 批量启停, 首页健康概览, 导航异常提示和首次使用引导.
- 新增市场可信级别, 许可证, 固定提交和内容哈希展示.
- 新增官方 Release 更新包手动下载与 SHA256 校验, 下载完成后只打开所在目录, 不静默安装.
- 新增发布敏感信息扫描和 Windows 可选 Authenticode SHA256 签名流程.

### 安全

- MCP 健康检测不会向前端返回环境变量, 请求头或 URL 凭据.
- 市场更新检测本地修改并默认拒绝覆盖, 内容写入与来源登记合并为同一个可回滚事务.
- 扩展历史, Skill 审计与配置迁移拒绝跟随符号链接, 限制文件数量, 单文件大小和配置包总大小.
- 脱敏配置包中的密钥占位符禁止直接导入. 私密包在 macOS 和 Linux 使用 `0600` 权限.
- 更新下载在读取响应体时执行硬性大小限制, 并只接受当前项目官方 Release URL.

### 改进

- 引入 Cursor 和 Claude Code 扩展目标适配器, 统一路径, 能力和格式转换接口, 为后续增加更多软件保留明确扩展点.
- 优化 980x640 最小窗口响应式布局, 修复侧栏和刷新按钮换行, 将扩展页签保持在首屏.
- 扩展市场显示本地修改, 风险等级, 可信来源和许可证, 批量操作使用单条可恢复历史记录.
- macOS Tauri CLI 构建版本固定并加入缓存, 缩短重复构建时间.

### 验证

- Node.js 自动化测试 99 项全部通过.
- Rust 自动化测试 51 项通过, 5 项实网测试在默认套件中忽略并已单独全部通过.
- Rust 格式, 敏感信息扫描, Git 差异检查和 980x640/1180x760 静态界面验收通过.

## [0.3.8] - 2026-07-16

### 新增

- 新增 Cursor 与 Claude Code 扩展管理页, 支持用户级和项目级 MCP 与 Agent Skills.
- MCP 支持 stdio、HTTP 和 SSE, 可以添加、编辑、启用、停用和删除.
- Skill 支持创建、编辑、启停和安全删除, Cursor 内置与 Claude 兼容 Skill 只读展示.
- 新增工作区目录选择器, 项目级配置只作用于用户明确选择的工作区.
- 新增 Cursor 项目规则与 Claude Code 项目/个人提示词管理, 分别维护 `.cursor/rules/*.mdc` 和 `.claude/rules/*.md`.
- Cursor 全局 User Rules 没有公开文件格式, 用户级界面会引导到 `Customize > Rules`, 不写入 Cursor 私有数据库.
- 新增精选 MCP, Skill 与提示词市场, 支持 GitHub 来源展示, 最新提交检查和市场项目一键更新.
- 已安装项目可以直接打开对应 GitHub 仓库. 非市场项目缺少安装提交记录时显示“版本未知”.
- 新增 macOS Cursor 与 Claude Desktop 定位, 进程退出, 管理员启动, 用户目录保留和应用 ad-hoc 重签名.
- 新增 `macos-14` 原生构建任务, 生成 `.app.zip`, DMG 和独立 SHA256 清单.
- macOS 改为 Universal Binary, 同时覆盖 Apple Silicon 和 Intel; DMG 包含应用与 Applications 快捷入口.
- macOS 工作流新增手动触发, Universal 双架构, Info.plist, ZIP, 签名和 DMG 挂载结构强制校验.
- macOS `.app` 补齐 Cursor 引擎依赖, 第三方许可证和 Claude 翻译资源来源声明, 并在打包时强制校验.
- 支持可选 Developer ID 签名和 Apple notarization Secrets, 未配置证书时保留 ad-hoc 测试构建.
- Skill 市场改为按固定 GitHub 提交下载完整目录, 不再只安装单个 `SKILL.md`.
- 扩展页新增统一操作状态条和按钮忙碌反馈, 长时间检查、安装和更新过程不再缺少可见反馈.
- 提升小字号文本可读性, 增加键盘焦点样式, Esc 关闭弹窗, Tab 方向键切换和完整减少动态效果支持.

### 安全

- MCP 环境变量、HTTP 请求头和 URL 凭据仅在 Rust 后端处理, 前端只显示脱敏占位符.
- MCP 修改前自动备份原 JSON, Skill 删除改为移动到工作台回收目录.
- 根据 Cursor 和 Claude Code 官方格式分别生成 MCP 配置, 保留已有未知字段和 OAuth 配置.
- 市场只允许经过格式校验的 GitHub 仓库首页和 GitHub Raw Skill 下载地址.
- Skill 下载限制为 128 个文件, 单文件 2 MB, 总大小 8 MB, 拒绝符号链接和越界路径.
- MCP 市场更新保留已有环境变量, 请求头, 启停状态和脱敏密钥, 不因模板更新清空用户配置.
- Skill 与提示词市场更新保留用户原有启停状态, 不会在更新时擅自重新启用.
- MCP 来源元数据迁移到工作台独立 sidecar 注册表, 不向官方 MCP 配置注入未知字段.
- macOS 管理员模式保留原用户 HOME, UID 和 GID, 写入用户配置后恢复原用户所有权.

### 修复

- 修复 Claude Desktop 嵌套资源路径使用正斜杠时, `takeown.exe` 无法找到文件的问题.
- 权限命令失败时返回退出码和 Windows 原始错误, 不再只显示笼统失败提示.
- 修复 Cursor Node.js 引擎只定位 Windows 安装目录和只会结束 `Cursor.exe` 的平台限制.
- 修复 macOS GUI 环境无法发现 Homebrew, NVM, Volta, asdf, mise 和 fnm Node.js, 以及执行时仍固定调用 `node` 的问题.
- 修复 macOS 修改 Electron 应用后只执行单次 deep 签名, 可能导致嵌套 Framework entitlement 或 Claude 虚拟化权限丢失的问题.
- 修复非市场已安装项目在 GitHub 检查失败时误显示“已是最新”的问题.
- 修复 Cursor 用量数据库和工作台数据目录只识别 Windows 环境变量的问题.

### 验证

- Windows Node.js 测试 97 项通过, Rust 测试 37 项通过, 5 项实网测试在默认套件中按约定忽略.
- 5 项实网测试已单独全部通过, 覆盖当前用户扩展配置扫描, GitHub 项目与版本检查, 市场提交检查和完整 Skill 目录下载.
- Windows 无法链接 Apple Objective-C 运行时, macOS 最终编译, 签名和 DMG 验证交由 `macos-14` 原生工作流执行.

## [0.3.7] - 2026-07-16

### 修复

- 统一 Cursor CLI 与 Rust 备份列表的 Base64 SHA256 格式. CLI 生成的无填充哈希不再被备份历史误报为校验失败.
- 新增 Node.js 备份元数据格式的 Rust 回归测试, 保证当前版本备份可以正确显示并恢复.

### 文档

- 重写项目 README, 删除重复的旧版本流水账, 以当前双应用汉化工作台为主线介绍功能, 安全边界和自动兼容机制.
- 新增软件中心, 备份历史, Cursor 用量监控和 Cursor 中文设置真实截图, 并遮挡账号与本机路径信息.

### 验证

- Node.js 自动化测试 85 项全部通过.
- Rust 自动化测试 17 项全部通过, GitHub 实网检查 1 项按测试约定忽略.
- 简体中文和繁体中文词典校验, Windows Release 构建, 便携包冒烟测试和 SHA256 产物校验全部通过.

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

[0.4.2]: https://github.com/svipm/cursor-i18n-zh/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/svipm/cursor-i18n-zh/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/svipm/cursor-i18n-zh/compare/v0.3.9...v0.4.0
[0.3.9]: https://github.com/svipm/cursor-i18n-zh/compare/v0.3.8...v0.3.9
[0.3.8]: https://github.com/svipm/cursor-i18n-zh/compare/v0.3.7...v0.3.8
[0.3.7]: https://github.com/svipm/cursor-i18n-zh/compare/v0.3.6...v0.3.7
[0.3.6]: https://github.com/svipm/cursor-i18n-zh/compare/v0.3.1...v0.3.6
[0.3.1]: https://github.com/svipm/cursor-i18n-zh/releases/tag/v0.3.1
