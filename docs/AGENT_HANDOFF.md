# Agent 交接

最近更新：2026-07-30 03:30 CST

## 不可改变的用户约束

- 程序只在当前 Windows 电脑开发、运行和测试。
- Linux 上传中转机只在发布阶段用于上传 GitHub；不要恢复远程 Vite、tmux 开发或 SSH 浏览器隧道。
- 下载优先尝试用户指定的 SOCKS5 代理；当前 TCP 不可达，必须记录回退，不得伪造代理成功或把代理地址写入仓库。
- 不得丢失原系统的学习节点、学习流程、复习、日记、知识库和实验入口。
- 用户未跟踪的根目录 `AGENTS.md` 不属于本分支，禁止修改或暂存。

## 仓库状态

- 工作目录：`%USERPROFILE%\Desktop\Projects\zhiweave`
- 分支：`agent/professional-workbench`
- Draft PR：[jacek4yang/zhiweave#1](https://github.com/jacek4yang/zhiweave/pull/1)
- 前一稳定切片 GitHub CI：Frontend 与 Rust 均通过。
- Windows 原生开发应用已启动；当前日志在 `%TEMP%\zhiweave-tauri.*.log`。

## 已实现切片

见 [`PROGRESS.md`](./PROGRESS.md)。重点是专业工作台、无系统标题栏、多标签、实时分栏、语义配色、详细状态栏、知识节点 H1 命名、增量分支版本图、日记入口、上下文菜单分流，以及安全的 Markdown UUID 交互实验。

功能提交 `193ce03` 增加：

- application `WorkspacePort` 和结构化失败 DTO；
- `zhiweave-storage` 固定根文件适配器；
- portable path、UTF-8/BOM/换行检测、资源上限、SHA-256 revision、原子 create/save；
- Windows Tauri 工作区快照/创建/保存命令和 6 篇种子 Markdown；
- 原生自动保存、冲突不覆盖、`recovery/` 保护、Mixed 显式规范化；
- 浏览器预览不冒充桌面文件。

当前 SQLite/稳定身份切片增加：

- `.zhiweave/identity.json` v1 稳定 ID 清单，原子写入、重复 ID/路径和非法 revision 失败关闭；
- bundled SQLite schema v1、application ID、WAL/FULL、FTS5 trigram 和有界短查询；
- 增量单篇索引、全快照清理、删除数据库自动派生重建；
- 损坏数据库不静默替换，显式重建先验证新库并保留旧库到 recovery；
- 外部无内容改名身份识别，以及非覆盖式应用内移动/重命名；
- Tauri 搜索、重建和重命名命令，原生状态栏索引状态及 SQLite 搜索；
- 身份损坏、未来 schema、数据库损坏/恢复、中文搜索和重命名回归测试。

## 最近验证

- pnpm 类型检查、22 项前端测试和生产构建通过。
- 当前 storage 15 项与 Tauri 1 项测试、相关 fmt/Clippy `-D warnings` 通过；提交前仍须跑全 workspace。
- Windows Tauri 进程重编译启动，固定工作区实际有 6 个 Markdown、6 个唯一稳定 ID 和有效 SQLite 3 数据库。
- GitHub CI run `30482533535`：Frontend 21 s、Rust 3 min 1 s，全部通过；Node 20 actions deprecation annotation 尚待 workflow 维护。
- Windows Tauri 客户区顶部非客户区仅 1 px，证明系统标题栏已移除。
- 真实浏览器验证 UUID v4 版本/变体、非法 UUID、AI 提示词、输入框粘贴、编辑器撤销和五类上下文菜单。
- 交互实验已按需拆为独立 6.22 KB chunk。

## 下一步顺序

1. 完成当前 SQLite/稳定身份切片的全门禁、构建、审计、提交、Linux 中转推送、PR/CI。
2. 实现文件 watcher、外部删除/重命名和冲突中心；补占位强杀、只读目录、磁盘满夹具。
3. 把浏览器会话版本 DAG 迁入 Rust 增量对象存储并实现保留/清理。
4. 收敛统一 command registry 与命令面板，再替换共享 Markdown AST。
5. 持续排除根 `AGENTS.md`、真实工作区文件、地址、密钥和数据库。

## 关键风险

Markdown 文件事实源、稳定 ID 和可重建 SQLite/FTS 已进入 alpha，但还不能称为可承载长期真实资料的完整数据层：启动仍全量扫描正文，无 watcher、完整恢复、版本持久化或客户端加密；create 强杀可能留下空占位，安全移动强杀可能留下重复副本，删源前仍有极窄竞态。通用 Markdown 阅读器仍需统一 AST，主 bundle 超预算，同步后端仍只是协议/健康状态骨架。
