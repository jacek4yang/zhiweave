# Agent 交接

最近更新：2026-07-30 02:13 CST

## 不可改变的用户约束

- 程序只在当前 Windows 电脑开发、运行和测试。
- Linux 上传中转机只在发布阶段用于上传 GitHub；不要恢复远程 Vite、tmux 开发或 SSH 浏览器隧道。
- 下载优先尝试用户指定的 SOCKS5 代理；当前 TCP 不可达，必须记录回退，不得伪造代理成功或把代理地址写入仓库。
- 不得丢失原系统的学习节点、学习流程、复习、日记、知识库和实验入口。
- 用户未跟踪的根目录 `AGENTS.md` 不属于本分支，禁止修改或暂存。

## 仓库状态

- 工作目录：`C:\Users\20220\Desktop\Projects\zhiweave`
- 分支：`agent/professional-workbench`
- 当前提交：`0ee8ae4`（基线 `847a2c3`）
- Draft PR：[jacek4yang/zhiweave#1](https://github.com/jacek4yang/zhiweave/pull/1)
- GitHub CI：Frontend 与 Rust 均通过。
- Windows 原生开发应用和 Vite 已启动；日志在 `%TEMP%\zhiweave-windows-tauri-3.*.log`。

## 已实现切片

见 [`PROGRESS.md`](./PROGRESS.md)。重点是专业工作台、无系统标题栏、多标签、实时分栏、语义配色、详细状态栏、知识节点 H1 命名、增量分支版本图、日记入口、上下文菜单分流，以及安全的 Markdown UUID 交互实验。

## 最近验证

- pnpm 类型检查、15 项前端测试和生产构建通过。
- Windows Tauri 客户区顶部非客户区仅 1 px，证明系统标题栏已移除。
- 真实浏览器验证 UUID v4 版本/变体、非法 UUID、AI 提示词、输入框粘贴、编辑器撤销和五类上下文菜单。
- 交互实验已按需拆为独立 6.22 KB chunk。

## 下一步顺序

1. 继续真实本地文件/SQLite 垂直切片；不要把当前 localStorage 尖峰描述成生产可用。
2. 收敛统一 command registry 与命令面板，补完整菜单键盘模型。
3. 替换手写 Markdown 阅读器为共享 AST，并把交互 fence 接入同一语义管线。
4. 每个切片在 Windows 重跑本地门禁、浏览器证据与截图，再经 Linux 中转机推送到 Draft PR。
5. 持续排除根 `AGENTS.md` 和任何真实地址、笔记、密钥或数据库。

## 关键风险

当前 UI 切片可演示但数据层仍不可用于真实资料：无 Markdown 文件事实来源、原子保存、SQLite、迁移、文件监控或恢复。通用 Markdown 阅读器仍需统一 AST。主 bundle 仍超过性能预算。同步后端仍只是协议/健康状态骨架。
