# 开发进度

最后更新：2026-07-30 02:00 CST

## 执行拓扑

- 开发、构建、Rust/TypeScript 测试、Tauri 运行和浏览器验收全部在当前 Windows 电脑完成。
- Linux 上传中转机只承担最终的 GitHub 提交/推送，不运行开发服务或质量门。
- 当前本地分支：`agent/professional-workbench`，基线 `847a2c3`。
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

## 当前质量证据

- `pnpm typecheck`：通过。
- `pnpm test`：3 files / 15 tests，通过。
- `pnpm build`：通过，约 402 ms。
- 交互实验独立 chunk：6.22 KB（gzip 2.57 KB）。
- 主 CSS：28.18 KB（gzip 5.86 KB）。
- 主 JavaScript：867.83 KB（gzip 290.74 KB），仍超过 200 KB 首屏预算并触发 Vite 警告。
- Windows 原生进程：`知织 · ZhiWeave` 正常运行；Vite 绑定 `127.0.0.1:1420`。

## 当前任务

1. 完成交互实验与上下文命令的最终浏览器矩阵、控制台和截图复核。
2. 把当前直接事件处理器收敛到真正的 command registry，并补键盘菜单语义。
3. 继续阶段 2：Markdown 原子文件事实来源、SQLite 可重建索引、迁移与崩溃恢复，移除正文 `localStorage`。
4. 替换手写 Markdown 阅读器为共享 AST 管线。
5. 更新全部文档并运行 pnpm/cargo/git 全质量门。
6. 仅在以上通过后同步到 Linux 上传中转机，明确暂存范围、提交、推送并建立 Draft PR/CI 记录。

## 未解决风险

- 正文、布局和版本仍全量保存在 `localStorage`，不可承载真实个人数据。
- `MarkdownPreview` 仍是临时逐行解析器；仅交互 fence 已有严格边界，通用 Markdown 语义尚未统一。
- 首屏 JS gzip 超预算 90.74 KB；CodeMirror/图标/工作台需进一步分包和测量。
- 尚无真实文件打开、原子保存、SQLite/FTS、文件监控、备份/恢复或同步加密。
- Command registry、命令面板、完整树/属性/反向链接、FSRS 与深度学习 schema 尚未完成。
- 当前改动尚未提交、推送或建立 Draft PR；`AGENTS.md` 是用户未跟踪文件，严禁暂存。

## 当前截图

- [Windows 工作台 1280×720](./baseline/workbench-windows-1280x720.png)
- [窄屏工作台 390×844](./baseline/workbench-narrow-390x844.png)
