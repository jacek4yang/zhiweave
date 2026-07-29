# 开发进度

最后更新：2026-07-30 02:42 CST

## 执行拓扑

- 开发、构建、Rust/TypeScript 测试、Tauri 运行和浏览器验收全部在当前 Windows 电脑完成。
- Linux 上传中转机只承担最终的 GitHub 提交/推送，不运行开发服务或质量门。
- 当前本地分支：`agent/professional-workbench`，远端已同步提交 `6693e1a`；本节文件纵切尚待形成下一提交。
- 用户指定的 SOCKS5 下载代理已按要求尝试，但本机和中转机均无法建立 TCP 连接；已有依赖优先使用本机 pnpm store。代理地址本身不写入仓库。

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

## 当前质量证据

- `pnpm typecheck`：通过。
- `pnpm test`：5 files / 22 tests，通过。
- `pnpm build`：通过，约 402 ms。
- 交互实验独立 chunk：6.22 KB（gzip 2.57 KB）。
- 主 CSS：28.64 KB（gzip 5.97 KB）。
- 主 JavaScript：876.66 KB（gzip 293.57 KB），仍超过 200 KB 首屏预算并触发 Vite 警告。
- Rust workspace tests：21 项通过；fmt 和全 workspace Clippy `-D warnings` 通过。
- Windows 原生进程：`知织 · ZhiWeave` 正常运行；固定工作区已生成 6 个真实 Markdown；Vite 绑定 `127.0.0.1:1420`。
- 提交 `6693e1a` 已推送至 `agent/professional-workbench`；当前文件纵切尚未提交。
- [Draft PR #1](https://github.com/jacek4yang/zhiweave/pull/1) 已创建。
- GitHub CI：Frontend 通过（18 s），Rust 通过（3 min 7 s）。

## 当前任务

1. 完成本文件纵切最终 Windows Tauri 验收、截图、提交、Linux 中转推送与 Draft PR/CI。
2. 接入 SQLite 可重建 manifest/索引，让笔记 ID 在重命名后保持稳定，并加入 schema migration/rebuild。
3. 增加文件 watcher、外部创建/删除/重命名事件和完整冲突中心，消除前端只在保存时发现变更的盲区。
4. 把当前直接事件处理器收敛到真正的 command registry，并补键盘菜单语义。
5. 替换手写 Markdown 阅读器为共享 AST 管线。

## 未解决风险

- 原生正文已移出 `localStorage`，但浏览器预览、布局和会话版本仍使用它；本地版本 DAG 尚未迁入 Rust 持久化。
- 笔记 ID 暂由 path 派生，重命名会改变身份；SQLite manifest 未完成。
- 尚无文件 watcher；最后一次 revision 检查与 rename 之间仍有极窄外部竞态。
- create 的空占位后若进程强杀可能留下空 Markdown，自动恢复日志未完成。
- `MarkdownPreview` 仍是临时逐行解析器；仅交互 fence 已有严格边界，通用 Markdown 语义尚未统一。
- 首屏 JS gzip 超预算 90.74 KB；CodeMirror/图标/工作台需进一步分包和测量。
- 尚无 SQLite/FTS、文件监控、完整备份/恢复或同步加密。
- Command registry、命令面板、完整树/属性/反向链接、FSRS 与深度学习 schema 尚未完成。
- 当前垂直切片已发布到 Draft PR；根目录 `AGENTS.md` 仍是用户未跟踪文件，严禁暂存。

## 当前截图

- [Windows 工作台 1280×720](./baseline/workbench-windows-1280x720.png)
- [窄屏工作台 390×844](./baseline/workbench-narrow-390x844.png)
