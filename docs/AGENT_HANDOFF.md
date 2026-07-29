# Agent 交接

最近更新：2026-07-30 06:46 CST

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
- 本切片开始时的推送基线 `5251e39` 对应 GitHub CI run `30495257993`：Frontend 与 Rust 均通过。
- Windows 原生验证进程已安全关闭；临时日志只在 `%TEMP%`。

## 已实现切片

见 [`PROGRESS.md`](./PROGRESS.md)。重点是专业工作台、无系统标题栏、多标签、实时分栏、语义配色、详细状态栏、知识节点 H1 命名、增量分支版本图、日记入口、上下文菜单分流，以及安全的 Markdown UUID 交互实验。

功能提交 `193ce03` 增加：

- application `WorkspacePort` 和结构化失败 DTO；
- `zhiweave-storage` 固定根文件适配器；
- portable path、UTF-8/BOM/换行检测、资源上限、SHA-256 revision、原子 create/save；
- Windows Tauri 工作区快照/创建/保存命令和 6 篇种子 Markdown；
- 原生自动保存、冲突不覆盖、`recovery/` 保护、Mixed 显式规范化；
- 浏览器预览不冒充桌面文件。

SQLite/稳定身份稳定切片增加：

- `.zhiweave/identity.json` v1 稳定 ID 清单，原子写入、重复 ID/路径和非法 revision 失败关闭；
- bundled SQLite schema v1、application ID、WAL/FULL、FTS5 trigram 和有界短查询；
- 增量单篇索引、全快照清理、删除数据库自动派生重建；
- 损坏数据库不静默替换，显式重建先验证新库并保留旧库到 recovery；
- 外部无内容改名身份识别，以及非覆盖式应用内移动/重命名；
- Tauri 搜索、重建和重命名命令，原生状态栏索引状态及 SQLite 搜索；
- 身份损坏、未来 schema、数据库损坏/恢复、中文搜索和重命名回归测试。

当前 watcher/外部更改中心切片增加：

- `notify 8.2.0` Windows 原生递归 watcher，300 ms 合并事件风暴并排除 `.zhiweave` 自身写入；
- watcher 只发无路径唤醒信号；application 完整快照核对才区分 created/modified/deleted/moved；
- 稳定 ID 识别移动，revision 识别正文变化；重复/过大的客户端基线被拒绝；
- 状态栏外部更改计数与可滚动冲突中心，显示前后路径、移动伴随正文变化和本地脏缓冲；
- 安全应用无冲突变化，脏缓冲不自动覆盖；明确接受磁盘版本前逐篇写 recovery，并检测恢复期间继续输入；
- Windows 原生人工验证新建、移动、修改、删除四类；测试临时文件已删除，工作区恢复 6 篇/6 ID/索引 6 篇。

当前持久版本切片增加：

- `.zhiweave/history.sqlite3` 正式历史库，与可重建的 `index.sqlite3` 分离，损坏/外来/未来 schema 失败关闭；
- FastCDC 内容定义分块、SHA-256 内容寻址和 zstd 压缩，相同块跨版本复用，版本可独立恢复；
- expected head 并发保护、相同内容 no-op、旧节点 checkout 后自然分支；
- 目标版本完整性校验、恢复前持久保护当前编辑、文件 revision 防冲突写回；
- 精确删除、子节点事务重接、head 调整和无引用块垃圾回收；
- Tauri 命令与真实版本图、实际压缩占用/块数、复制/恢复/删除右键操作贯通。

当前检查点、保留和完整备份切片增加：

- history schema v2 命名检查点与 v1→v2 原位迁移；
- 固定保护 head、根、分支末端、检查点、最新数量与最近天数的保留策略；
- 绑定完整图和固定时间边界的预览 token，陈旧预览失败关闭；
- 单事务批量重接/删除/GC，候选损坏时预览不执行；
- `.zhiweave/backups/<UUID>.zhiweave-backup` 完整目录包与逐文件长度/SHA-256 清单；
- `VACUUM INTO` 一致历史快照、全部版本重建校验、payload 集合与总量校验；
- 恢复前 current safety backup、完整 stage、工作区同级 restore plan 和启动前双 rename；
- 进程在 preserve/activate 之间中断后继续恢复，旧 workspace 始终保留为 previous。

当前统一命令系统切片增加：

- 类型化 command registry 统一稳定 id、分类、关键词/别名、快捷键、平台能力、上下文顺序与启用条件；
- 50 余项工作台操作从按钮、快捷键、命令面板和右键菜单进入同一执行器；
- 中文/模糊检索命令面板，支持方向键、Home/End、Enter、Esc、Tab 焦点陷阱与触发点恢复；
- 标题栏、工作区、节点、标签、编辑器、输入框、预览、实验、状态栏、版本和备份的对象菜单矩阵；
- 菜单、Activity Bar、笔记列表和标签的键盘方向模型，以及新建/外部更改对话框的焦点管理；
- 浏览器预览隐藏原生文件能力，Windows 原生按实际状态展示重命名、索引和完整备份操作。

当前共享 Markdown AST 切片增加：

- 标准 mdast + GFM/YAML frontmatter/脚注/数学解析，整篇原始 source 与标准节点 position 保留；
- Wiki Link、嵌入和 Obsidian 风格 Callout 的显式 ZhiWeave 扩展节点；
- 语义阅读 DOM，覆盖标题、跨行段落、嵌套任务/列表、表格、脚注、代码 metadata、公式与
  安全资源占位，未知语法按 source 降级；
- 原始 HTML 永不执行、远程图片不自动请求、危险 URL 不生成链接、KaTeX `trust=false`；
- Markdown 原文/结构化阅读文本统一复制命令，代码和块公式源码复制；
- H1/Setext H1 命名扫描排除 frontmatter 和 fenced code，并保留链接/Wiki 显示名；
- 阅读器、AST 和 KaTeX 全部按需分包，不进入纯编辑首屏。

## 最近验证

- pnpm lint/typecheck、35 项前端测试和生产构建通过。
- Rust workspace 49 项、fmt 与 Clippy `-D warnings` 全部通过；storage 30 项覆盖历史、保留、
  完整备份、篡改拒绝和恢复中断。
- Windows Tauri 原生验收覆盖保存、分支、重启、删除/空间回收和恢复；测试正文与版本均已清理，固定工作区保持 6 个 Markdown。
- GitHub CI run `30482533535`：Frontend 21 s、Rust 3 min 1 s，全部通过；Node 20 actions deprecation annotation 尚待 workflow 维护。
- Windows Tauri 客户区顶部非客户区仅 1 px，证明系统标题栏已移除。
- 真实浏览器验证 UUID v4 版本/变体、非法 UUID、AI 提示词、输入框粘贴、编辑器撤销和五类上下文菜单。
- 交互实验已按需拆为独立 5.97 KB chunk。
- Windows 原生保留验收：6 节点中预览 2 候选/540 B，检查点保留；清理后 4 节点，最终验收
  历史归零且 Markdown 不变。右键菜单按检查点状态变化。
- Windows 原生完整备份“版本与备份功能上线基线”覆盖 8 文件/46.1 KB/0 版本，二次逐文件
  校验通过；恢复确认取消后无 pending plan。1280×800 和 390×844 无页面级水平溢出。
- 真实浏览器命令面板中文检索、键盘执行/Esc/焦点恢复、节点菜单分流、对话框焦点陷阱，以及
  390×844/1280×800 布局通过；Windows 原生能力矩阵、`Ctrl+P`/`Ctrl+Shift+P`、节点菜单
  键盘与焦点恢复通过。只读验收未修改工作区数据。
- 复杂 Markdown 浏览器验收覆盖 YAML、GFM、Wiki/嵌入、Callout、代码、KaTeX、脚注、附件占位、
  原始 HTML 安全降级和四类源码/文本复制；1280×720、390×844 无页面级溢出，console 干净。
- Windows 原生 welcome Markdown 使用新阅读器正常显示；预览右键与命令面板都有两类复制命令，
  验收只读且调试进程/端口已关闭。

## 下一步顺序

1. 建立 Lezer/mdast 适配并实现 Live Preview Decoration；扩展 Corpus/2 MiB/恶意输入基准。
2. 把共享 AST 接入大纲、Wiki/反向链接、附件、导出和版本语义 diff。
3. 增加快捷键编辑器、预览标签和移动端命令入口。
4. 补 watcher 高频压力、休眠恢复、占位强杀、只读目录和卷级磁盘满夹具。
5. 增加外部备份导入/跨设备恢复演练，再进入客户端加密和同步；持续排除根 `AGENTS.md`、
   真实工作区文件、地址、密钥和数据库。

## 关键风险

Markdown 文件事实源、稳定 ID、可重建 SQLite/FTS、本机 watcher、持久版本 DAG 和本机完整备份/
重启恢复已进入 alpha，但还不能称为完整长期数据保证：启动与每次外部事件仍全量扫描正文，
备份包尚未加密且缺少外部导入/跨设备演练；底层平台漏报只能依赖 `Rescan`/后续事件或重启发现。
create 强杀可能留下空占位，安全移动强杀可能留下重复副本，删源前仍有极窄竞态。共享 mdast
阅读器已落地，但 Live Preview、搜索/反向链接/附件/版本 diff 尚未接入；快捷键编辑器尚未完成，
主 bundle gzip 305.34 KB 超预算，KaTeX 字体资产待收敛，同步后端仍只是协议/健康状态骨架。
