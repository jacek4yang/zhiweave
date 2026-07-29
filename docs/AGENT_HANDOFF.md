# Agent 交接

最近更新：2026-07-30 02:42 CST

## 不可改变的用户约束

- 程序只在当前 Windows 电脑开发、运行和测试。
- Linux 上传中转机只在发布阶段用于上传 GitHub；不要恢复远程 Vite、tmux 开发或 SSH 浏览器隧道。
- 下载优先尝试用户指定的 SOCKS5 代理；当前 TCP 不可达，必须记录回退，不得伪造代理成功或把代理地址写入仓库。
- 不得丢失原系统的学习节点、学习流程、复习、日记、知识库和实验入口。
- 用户未跟踪的根目录 `AGENTS.md` 不属于本分支，禁止修改或暂存。

## 仓库状态

- 工作目录：`%USERPROFILE%\Desktop\Projects\zhiweave`
- 分支：`agent/professional-workbench`
- 当前提交：`6693e1a`（基线 `847a2c3`）；Markdown 文件纵切在工作区中尚未提交
- Draft PR：[jacek4yang/zhiweave#1](https://github.com/jacek4yang/zhiweave/pull/1)
- GitHub CI：Frontend 与 Rust 均通过。
- Windows 原生开发应用和 Vite 已启动；日志在 `%TEMP%\zhiweave-windows-tauri-3.*.log`。

## 已实现切片

见 [`PROGRESS.md`](./PROGRESS.md)。重点是专业工作台、无系统标题栏、多标签、实时分栏、语义配色、详细状态栏、知识节点 H1 命名、增量分支版本图、日记入口、上下文菜单分流，以及安全的 Markdown UUID 交互实验。

当前未提交纵切增加：

- application `WorkspacePort` 和结构化失败 DTO；
- `zhiweave-storage` 固定根文件适配器；
- portable path、UTF-8/BOM/换行检测、资源上限、SHA-256 revision、原子 create/save；
- Windows Tauri 工作区快照/创建/保存命令和 6 篇种子 Markdown；
- 原生自动保存、冲突不覆盖、`recovery/` 保护、Mixed 显式规范化；
- 浏览器预览不冒充桌面文件。

## 最近验证

- pnpm 类型检查、22 项前端测试和生产构建通过。
- Rust workspace 21 项测试、fmt、Clippy `-D warnings` 通过。
- Windows Tauri 进程重编译启动，固定工作区实际生成 6 个 Markdown。
- Windows Tauri 客户区顶部非客户区仅 1 px，证明系统标题栏已移除。
- 真实浏览器验证 UUID v4 版本/变体、非法 UUID、AI 提示词、输入框粘贴、编辑器撤销和五类上下文菜单。
- 交互实验已按需拆为独立 6.22 KB chunk。

## 下一步顺序

1. 完成当前 Markdown 文件纵切的最终本地门禁、截图、提交、Linux 中转推送、PR/CI。
2. 实现 SQLite 可重建 manifest/FTS、迁移和重命名稳定身份。
3. 实现文件 watcher、外部删除/重命名和冲突中心；补占位强杀、只读、磁盘满夹具。
4. 收敛统一 command registry 与命令面板，再替换共享 Markdown AST。
5. 持续排除根 `AGENTS.md`、真实工作区文件、地址、密钥和数据库。

## 关键风险

Markdown 文件事实源和冲突安全原子保存已进入 alpha，但还不能称为可承载长期真实资料的完整数据层：无 SQLite 稳定身份/索引、迁移、watcher、完整恢复和版本持久化；create 强杀可能留下空占位，最终 revision check 与 rename 仍有极窄竞态。通用 Markdown 阅读器仍需统一 AST，主 bundle 超预算，同步后端仍只是协议/健康状态骨架。
