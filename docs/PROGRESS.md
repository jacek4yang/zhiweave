# 开发进度

最后更新：2026-07-30 03:55 CST

## 执行拓扑

- 开发、构建、Rust/TypeScript 测试、Tauri 运行和浏览器验收全部在当前 Windows 电脑完成。
- Linux 上传中转机只承担最终的 GitHub 提交/推送，不运行开发服务或质量门。
- 当前本地分支：`agent/professional-workbench`；Markdown 文件纵切与首轮 CI 证据已通过 Linux 中转推送到 Draft PR #1。
- 用户指定的 SOCKS5 下载代理已按要求尝试，包括本次 `notify` 下载；本机无法建立 TCP 连接后才单次直连回退。代理地址本身不写入仓库。

## 已完成

- 阶段 0 产品、UX、设计、编辑器、Markdown、性能、安全、测试与架构审计文档。
- Windows Node 26.1.0、pnpm 11.9.0、Rust/Cargo 1.95.0 基线。
- TypeScript 类型检查、前端测试、生产构建及 Rust fmt/Clippy/workspace tests 基线通过。
- TokyoNight Moon 角色化语义配色：从服务器 `~/.config/nvim` 只读研究后适配，不复制插件实现。
- 专业深色工作台：48 px Activity Bar、可折叠笔记栏、编辑器优先布局、无营销卡片、无网络字体。
- Windows 原生无系统标题栏：客户区顶部差为 1 px，仅保留可缩放边框；自定义最小化/最大化/关闭按钮。
- 多标签、关闭/重开/切换、VS Code 风格快捷键、详细状态栏、实时分栏和阅读预览。
- H1 驱动知识节点显示名，恢复同一笔记版本时编辑器正确同步。
- 增量父节点版本 DAG、分支、图形历史、恢复保护、旧节点安全删除/子节点重接与存储摘要。
- 幂等今日日记入口；学习、知识库、复习、收集箱、实验与旧学习节点入口均保留。
- 上下文右键菜单按标题栏、Activity Bar、笔记栏、节点、标签、编辑器选区、输入框、预览、实验块、状态栏与版本节点分流。
- Markdown `zhiweave-lab` 声明式交互实验 v1：严格校验、16 KB 上限、失败原文降级、动态按需加载。
- UUID 实验室：v4 本地生成、v7 时间解释、版本/变体/128 位可视化、复制 UUID、复制安全 AI 生成提示词。
- 真实浏览器已验证标签/实验/选区/输入框/版本节点右键菜单，粘贴、撤销、UUID 生成与非法输入。
- 九种桌面/窄屏视口已做第一轮无页面溢出检查；交互实验增加容器级响应式布局。
- 新增 `zhiweave-storage` 文件适配器与 application `WorkspacePort`；Windows Tauri 使用固定应用数据工作区。
- 原生端以 UTF-8 Markdown 为正文事实源，保留 BOM/单一换行风格，使用 SHA-256 expected revision、同目录原子替换和回读验证。
- 跨平台 portable path 统一验证盘符、UNC、设备名、穿越、非法字符、符号链接和 root 边界；反序列化不能绕过。
- 浏览器预览与原生持久化明确隔离；Tauri 加载失败不会拿演示正文冒充真实文件。
- 自动保存具备 dirty/saving/saved/conflict/error/mixed 状态；冲突时不覆盖，先另存 `recovery/` 再重新载入。
- 原生新建知识节点、今日日记和 UUID 实验写入 Markdown；Ctrl+S 保存文件，Ctrl+Alt+S 才创建会话版本节点。
- 状态栏显示实际 UTF-8 BOM、换行风格和保存状态；状态栏右键只展示保存恢复与工作区操作。
- `.zhiweave/identity.json` 使用版本化开放 JSON 保存不可见稳定节点 ID；正文和 YAML 属性不暴露技术 ID。
- 外部单一文件改名且内容未变时通过唯一 revision 匹配保留 ID；原生“移动或重命名 Markdown”使用 F2/节点右键，目标存在时绝不覆盖。
- SQLite schema v1 使用 `rusqlite 0.40.1` bundled SQLite、WAL、FULL synchronous、foreign keys、5 秒 busy timeout、显式 checkpoint 和 application ID。
- FTS5 trigram 覆盖中英文子串；1–2 字查询使用有界短查询；查询最多 256 字、返回最多 100 项，UI 默认 50 项。
- 工作区快照只增量更新 revision/path/title/kind/mtime 发生变化的 FTS 行并清理失效行；保存后同步更新单篇索引。
- 删除 `index.sqlite3` 后从 Markdown + 隐藏身份自动生成派生库；现存损坏库不会静默替换，工作区仍显示正文并标记“索引需重建”。
- 用户明确重建时先构建并校验新库，再把旧数据库保留到 `.zhiweave/recovery/`；身份清单损坏时创建、保存和重建均在修改正文前失败关闭。
- 原生状态栏显示索引覆盖篇数/需重建/不可用；原生搜索走 Tauri/Rust/SQLite，不在失败时回退浏览器内存搜索。
- Windows 原生递归文件监听使用 `notify 8.2.0`；300 ms trailing debounce 和容量 1 的唤醒队列合并事件风暴，`.zhiweave` 自身写入不会产生界面噪声。
- 原始 watcher 路径、事件类型和重命名配对都不进入业务事实；每次只唤醒 application 完整快照核对，平台报错、空路径和 `Rescan` 标记同样触发核对。
- application 用稳定 ID + path + revision 结构化区分外部新建、修改、删除和移动；基线最多 10,000 篇，重复 ID/路径失败关闭。
- 状态栏新增外部更改计数；外部更改中心展示分类、前后路径和“移动时正文也变化”，可安全应用无冲突变化。
- 未保存编辑绝不自动刷新；冲突笔记继续保留编辑缓冲。用户明确接受磁盘版本时，先把所有脏缓冲分别创建到 `recovery/`，全部成功且恢复期间未继续输入后才重载。

## 当前质量证据

- `pnpm typecheck`：通过。
- `pnpm test`：5 files / 23 tests，通过。
- `pnpm build`：通过，约 779 ms。
- 交互实验独立 chunk：6.22 KB（gzip 2.57 KB）。
- 主 CSS：32.57 KB（gzip 6.56 KB）。
- 主 JavaScript：887.88 KB（gzip 296.91 KB），仍超过 200 KB 首屏预算并触发 Vite 警告。
- Rust workspace 33 项测试通过，其中 application 4 项、Tauri 3 项、storage 15 项、portable path 5 项；fmt 和全 workspace Clippy `-D warnings` 通过。
- `pnpm audit --prod --audit-level high`：无已知漏洞；`cargo audit --no-fetch --stale` 扫描 466 个 lockfile 依赖，无已知 vulnerability，17 项既有 allowed warning。
- Windows 原生进程：`知织 · ZhiWeave` 正常运行；固定工作区有 6 个真实 Markdown、identity v1 的 6 个唯一 ID/路径和有效 SQLite 3 数据库。
- Draft PR #1 已更新到 SQLite/稳定身份稳定切片；watcher 切片完成最终门禁后继续推送。
- GitHub CI run `30484917004`：Frontend 与 Rust 全部通过。
- CI 有一项非阻断 annotation：部分 actions 仍声明 Node 20，GitHub runner 已强制 Node 24；列为 workflow 维护项。
- [Draft PR #1](https://github.com/jacek4yang/zhiweave/pull/1) 已创建。
- GitHub CI：Frontend 通过（18 s），Rust 通过（3 min 7 s）。

## 当前任务

1. 完成 watcher/外部更改中心切片的最终门禁、构建、审计、提交、Linux 中转推送与 Draft PR/CI。
2. 把当前直接事件处理器收敛到真正的 command registry，并补键盘菜单语义。
3. 替换手写 Markdown 阅读器为共享 AST 管线。
4. 将浏览器会话版本 DAG 迁入 Rust 增量对象存储，加入保留策略与旧版本清理。
5. 补 watcher 高频压力、文件锁、磁盘满、只读目录和强杀恢复夹具。

## 未解决风险

- 原生正文已移出 `localStorage`，但浏览器预览、布局和会话版本仍使用它；本地版本 DAG 尚未迁入 Rust 持久化。
- 隐藏 ID 和 SQLite/FTS 已落地，但启动快照仍扫描并读取全部 Markdown，尚未达到 10,000/100,000 篇性能预算。
- 显式移动采用安全的“新建目标 → 写入/同步/校验 → 再删源”以避免跨平台覆盖；强杀最坏可能留下两份文件，且删源前仍有极窄外部竞态。
- 外部“改名同时改正文”无法仅凭 revision 自动识别为同一节点；应用内显式重命名可以稳定保持身份。
- watcher 只保证“事件后完整核对”，不保证底层平台一定投递事件；网络文件系统不在当前固定本机工作区支持范围，高频事件压力和进程休眠恢复仍需基准。
- create 的空占位后若进程强杀可能留下空 Markdown，自动恢复日志未完成。
- `MarkdownPreview` 仍是临时逐行解析器；仅交互 fence 已有严格边界，通用 Markdown 语义尚未统一。
- 首屏 JS gzip 超预算 96.91 KB；CodeMirror/图标/工作台需进一步分包和测量。
- 已有本机文件监控和单笔记 recovery，但尚无完整备份包/恢复演练或同步加密；本地 SQLite 目前未加密，不得宣称客户端密码保护已完成。
- Command registry、命令面板、完整树/属性/反向链接、FSRS 与深度学习 schema 尚未完成。
- 当前垂直切片已发布到 Draft PR；根目录 `AGENTS.md` 仍是用户未跟踪文件，严禁暂存。

## 当前截图

- [Windows 工作台 1280×720](./baseline/workbench-windows-1280x720.png)
- [窄屏工作台 390×844](./baseline/workbench-narrow-390x844.png)
