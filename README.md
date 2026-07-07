# cursor-i18n-zh

Cursor Windows 桌面端界面汉化补丁工具. 导入官方中文语言包覆盖 VS Code 基础界面, 再用本项目词典补齐 Cursor 专有界面.

## 要求

- 使用 Windows 版 Cursor.
- 使用 Node.js 18 或更高版本.
- 完全退出 Cursor 后再执行补丁, 包括托盘图标.
- 若 Cursor 不在默认安装目录, 设置 `CURSOR_APP_DIR` 指向 `resources/app`.

## 命令

```powershell
npm run status
npm run check
npm run lang
npm run apply
npm run restore
npm run scan
npm test
```

## 使用

1. 查看当前 Cursor 状态.

```powershell
npm run status
```

2. 校验词典和本机安装目录.

```powershell
npm run check
```

3. 设置简体中文 locale 并安装官方中文语言包.

```powershell
npm run lang
```

4. 完全退出 Cursor, 然后应用补丁.

```powershell
npm run apply
```

5. 启动 Cursor, 检查聊天, 设置, 面板, 托盘菜单等 Cursor 专有界面.

## 还原

使用备份恢复当前版本 Cursor 的原始文件.

```powershell
npm run restore
```

备份目录为 `backup/<Cursor版本>/files`. 首次应用补丁时自动创建, 已存在备份不会覆盖.

## 维护词典

1. 扫描当前 Cursor 版本候选文案.

```powershell
npm run scan
```

2. 编辑 `dict/*.json`.

- `dict/nls.json`: 使用 `模块路径#key` 作为键, 替换 `out/nls.messages.json`.
- 其他 JSON: 使用英文原文作为键, 译文可以是字符串, 也可以是 `{ "zh": "译文", "ctx": ["prop"] }`.
- `ctx` 只允许 `lit`, `prop`, `html-text`, `html-attr`.
- 译文不要包含 `<`, `>`, `"`, `'`, `` ` ``, `\`, `${...}`.

3. 校验并测试.

```powershell
npm run check
npm test
```

## 工作方式

- `apply` 自动定位 Cursor 的 `resources/app`.
- `apply` 先备份目标文件, 再替换代码层字符串和 nls 消息.
- `apply` 会把已安装的官方中文语言包写入 Cursor 内置 `nls.messages.json`, 覆盖顶部菜单, 命令面板, VS Code 设置等基础界面.
- `apply` 会继续用 `dict/nls.json` 覆盖 Cursor 专有 nls 文案.
- `apply` 会更新 `product.json` 里存在的 checksum, 并清理语言包缓存 `Cursor/clp`.
- `restore` 从备份复制原文件回安装目录, 并清理语言包缓存.

## 边界

- Cursor 每次升级后都需要重新检查并应用补丁.
- 官方中文语言包只覆盖 VS Code 基础界面, Cursor 专有界面依赖本项目词典.
- 若某个目标文件没有官方 checksum, 状态命令会显示 `(无官方 checksum)`, 这是 Cursor 当前产物结构决定的.
