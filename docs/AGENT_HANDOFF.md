# Agent 交接

最近更新：2026-07-30 12:00 CST

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
- 最新已发布提交：`c5a5f00 docs: record attachment CI`。当前本地功能提交：
  `f9ad649 feat(attachments): add controlled native import`；已完成 Windows 全门禁、真实系统
  选择器取消验收与原生安装包构建，等待通过 Linux 中继上传。
- GitHub CI run `30509720758`：Frontend（26 s）与 Rust（3 min 40 s）全部通过。
- 上一 GitHub CI run `30506855740`：Frontend 与 Rust 全部通过。
- GitHub CI run `30504384326`：Frontend 20 s、Rust 3 min 19 s，全部通过；只保留既有
  actions Node 20 弃用 annotation。
- 共享 Markdown AST 功能提交 `27bf009` 对应 GitHub CI run `30497652526`：Frontend 与 Rust
  均通过。
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

当前 missing Wiki / 附件纵切增加：

- missing Wiki 由 Rust 生成可审查的标题、portable path 与可选 heading 提案，界面明确确认后
  再快照、再解析；目标状态变化、路径冲突或歧义时中止，文件以非覆盖方式创建；
- 普通 Markdown 图片相对来源文件解析；Wiki 附件嵌入按来源目录、`attachments/` 和根目录
  生成确定候选，多候选失败为 ambiguous，非附件嵌入回退到既有 Wiki 节点解析；
- Rust 固定根 resolver 拒绝活动/远程 scheme、`.zhiweave`、符号链接、根外逃逸和扩展名/
  签名不一致；只返回最多 8 MiB、16,384 单边、40M 像素的 PNG/JPEG/静态 WebP；
- WebView 只把经后端验证的字节编码为 inert `data:` URL，阅读与 Live Preview 惰性加载并
  使用附件专属右键菜单；浏览器模式保持无磁盘能力占位；
- 实际浏览器发现 CodeMirror 插件装饰跨越换行会触发白屏；块公式改为逐行安全装饰并增加
  “插件装饰不能跨换行”的回归断言。900×650 与默认桌面视口无布局溢出。
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

当前扩展 Live Preview 切片增加：

- Lezer 数学、脚注与保真 `:::` 指令块节点；未知/截断指令块和未闭合数学/fence 不替换；
- 行内/块数学按需复用 KaTeX 渲染器且 `trust=false`，图片仅显示安全占位、不生成活动资源；
- 脚注引用/定义、闭合代码围栏 header/closing marker 和可见行样式；
- widget 点击回到源码，composition 全局停用替换，全部多光标范围共同决定源码揭示；
- 2 MiB 窄视口与 10,000 行 fence 自动性能门，原始 CodeMirror 文档逐字符不变。

当前 Wiki 关系与反向链接切片增加：

- Rust 正文扫描器支持 link/alias/embed，并排除 YAML、fenced/indented/inline code、HTML
  comment、转义、嵌套/截断和超过 500 Unicode scalar 的 target/alias；
- SQLite index schema v2 新增可重建 `wiki_edge` 与 `wiki_revision`；v1 fixture 原位迁移后
  从 Markdown 回填，不改变 identity、FTS 或正文；
- 精确 portable path 优先，其后唯一 H1/filename stem；同名候选 ambiguous、缺失 missing，
  带目录引用不回退标题，`[[#heading]]` 绑定当前稳定节点；
- 来源正文保存只替换当前来源边；创建、标题/路径变化、删除和全快照重新解析候选；
- application/Tauri/TypeScript 贯通 `workspace_backlinks`，原生面板按来源分组显示 link/embed、
  行列和上下文，点击使用受测 UTF-8 byte → UTF-16 offset 转换定位 CodeMirror；
- 面板与大纲互斥且可关闭；空白面板和具体来源 occurrence 的右键菜单按实际对象分流；
- Windows 原生 2560×1368 截图无裁切。未修改本机既有 Markdown 来伪造入链；真实非空关系由
  临时目录 storage/Tauri 集成测试证明。

当前 Wiki 正向导航切片增加：

- application/storage/Tauri/TypeScript 贯通 `ResolveWikiTargetRequest`；输入只有稳定来源 ID 与
  最多 500 Unicode scalar 的单行 authored target，输出为 `resolved/missing/ambiguous`、
  稳定目标 ID/title/path/kind 与可选 heading；
- 正向解析复用反向关系的同一 Rust 候选规则：精确 portable path 优先，路径引用不回退标题，
  唯一 H1/stem 才成功，`[[#heading]]` 绑定来源节点，歧义或缺失绝不按顺序猜测；
- 阅读器在原生能力存在时渲染可聚焦 Wiki 按钮；浏览器预览保持惰性文本。编辑器只有
  `Ctrl/Cmd+单击` 才按 Lezer 节点打开，普通单击仍编辑，heading 由共享 mdast offset 定位；
- Wiki Link 使用独立 `wiki-link` 右键 scope；原生只显示“解析并打开目标”和“复制目标文本”，
  浏览器只允许复制；missing/ambiguous 明确提示并失败关闭；
- storage/Tauri/前端测试覆盖路径、名称、自引用 heading、缺失、歧义、输入边界、SSR、Live
  Preview 语法查找、heading offset 和 command matrix。长行使用安全换行避免内容看似消失；
- Windows 原生只读验证：当前用户工作区 `#下一步` 解析回现有 welcome 节点与 heading，缺失
  target 返回 missing；内存临时 DOM marker 的 Wiki 菜单恰好两项并已删除，未修改用户 Markdown；
- 新增 1942×1214 物理像素视觉基线。WebView2 DOM 核对 1280×800 CSS viewport、24 px 状态栏和
  完整编辑区；当前用户工作区只有一篇既有 welcome 笔记，没有注入跨节点 Wiki 验收内容。

当前附件导入切片增加：

- application/storage 增加来源稳定 ID 绑定的 propose/confirm 端口；原生字节最多 64 MiB，
  文件名清洗为 portable `attachments/` 目标，规避 Windows 设备名并按 `-2` 分配冲突；
- Tauri Rust 系统 picker 不向 WebView 返回外部完整路径，只返回含 opaque token、目标、大小、
  完整 SHA-256、显示策略和引用的提案；token 一次性、10 分钟 TTL，队列最多 8 项/128 MiB；
- Windows 以不跟随重解析点的句柄打开选择结果，并再次核对已打开句柄；选择后路径替换为
  junction/symlink 等间接资源时失败关闭；
- confirm 重新生成并逐字段核对，以 `create_new`、写入、sync 和 bounded re-read 发布，失败
  清理本次未提交文件且不覆盖；来源节点确认前移动会因相对引用变化而失败关闭；静态安全图片
  生成相对 Markdown 图片，其他资源保持 inert embed；
- CodeMirror 在当前光标一次 transaction 插入引用，进入统一 undo 历史；撤销引用不删除原始
  附件。命令只在原生可编辑 editor context 出现，浏览器/预览/附件对象菜单不冒充能力；
- Windows 实际 picker 选择 46.0 KB PNG 后，确认页在 1280×800 与 390×844 无水平溢出并正确
  聚焦 primary；随后取消，6 篇 Markdown 组合摘要不变、提议附件不存在。原生编辑器右键有导入，
  浏览器工具栏/面板/右键无导入。

## 最近验证

- 最终差异通过 typecheck、11 files / 57 tests 和 production build；主 JS 约 955.27 KB
  （gzip 316.48 KB），仍触发体积警告。
- Rust workspace 74 项、fmt 与全 target/all feature Clippy `-D warnings` 全部通过；
  Markdown 7 项、storage 49 项覆盖 Wiki 解析/创建、附件安全边界/导入、迁移、增量替换、歧义、
  重命名/删除/重建与正向解析，同时保留历史、备份和恢复回归。
- `pnpm tauri build` 在当前 Windows 电脑通过，生成 6,119,424 B MSI 与 4,617,633 B NSIS；
  SHA-256 记录在 `TEST_PLAN.md`，产物位于忽略的 `target/`。
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
- 扩展 Live Preview 功能提交 `9f85c43`：Windows 全门禁通过；2 MiB 窄视口约 322 ms，
  10,000 行 fence 可见 24 行用例约 9 ms。
- 最后已推送验证提交 `2949aad` 的 GitHub CI run `30501606610`：Frontend 与 Rust 全部通过。
- Wiki 反向链接功能/验证提交 `cb70abe`/`d9e2fa3` 已经 Linux 中继推送；GitHub CI run
  `30504384326` 的 Frontend（20 s）与 Rust（3 min 19 s）全部通过。
- Wiki 正向导航功能/验证提交 `4ee24cf`/`f677260` 已通过 Linux 临时裸仓库中继推送；GitHub
  CI run `30506855740` 的 Frontend 与 Rust 全部通过。
- Windows Tauri dev profile 7.15 s 编译并启动，原生进程可响应；DWM 1924×1204 截图无窗口
  裁切。随后已关闭进程和 1420 监听。
- 本轮应用内浏览器在本地导航和 DOM 读取阶段连续超时，所以不能把反向链接浏览器点击/E2E
  标记为通过；原生 DWM 截图与临时目录集成测试是区分记录的替代证据。
- pnpm 生产依赖审计先按用户指定 SOCKS5 代理重试，失败后以不下载依赖的直接 audit 回退完成，
  无已知漏洞；`cargo audit --no-fetch --stale` 扫描 475 个依赖，无 vulnerability，保留
  17 项既有维护/unsound warning。

## 下一步顺序

1. 补扩展 Live Preview 的真实 Windows IME/多光标和 Android 验收。
2. 增加 Wiki 关系的 10,000/100,000 节点基准、Unicode 归一化契约与 corpus/fuzz。
3. 增加局部图谱、快捷键编辑器、预览标签和移动端命令入口。
4. 补 watcher 高频压力、休眠恢复、占位强杀、只读目录和卷级磁盘满夹具。
5. 增加外部备份导入/跨设备恢复演练，再进入客户端加密和同步；持续排除根 `AGENTS.md`、
   真实工作区文件、地址、密钥和数据库。

## 关键风险

Markdown 文件事实源、稳定 ID、可重建 SQLite/FTS、本机 watcher、持久版本 DAG 和本机完整备份/
重启恢复已进入 alpha，但还不能称为完整长期数据保证：启动与每次外部事件仍全量扫描正文，
备份包尚未加密且缺少外部导入/跨设备演练；底层平台漏报只能依赖 `Rescan`/后续事件或重启发现。
create 强杀可能留下空占位，安全移动强杀可能留下重复副本，删源前仍有极窄竞态。共享 mdast
阅读器、扩展 Live Preview、可交互大纲、Wiki 双向导航、missing 显式创建与受限静态附件预览
及受控导入已落地，但局部图谱、导出/版本 diff 尚未接入；关系 resolver 每次全局变化仍构造全部候选映射，缺少 10,000/
100,000 节点基准和跨 Rust/JavaScript Unicode 归一化契约。快捷键编辑器尚未完成，主 bundle
gzip 约 316.48 KB 超预算，KaTeX 字体资产待收敛，同步后端仍只是协议/健康状态骨架。

## 运行现场与恢复

- 浏览器端口：`1420`，本轮 Vite 进程已按命令行与 PID 精确核对后停止，无监听。
- SSH 隧道：不使用；用户已明确 Linux 只作 GitHub 上传中转，不在其上运行 Vite/Tauri。
- tmux 会话：不使用；所有开发与验证在当前 Windows 电脑完成。
- Windows Tauri/Vite/调试进程：已关闭。
- 阻塞：无工程阻塞；本轮应用内浏览器能力隔离与响应式检查已经实际通过。
- 下一条精确命令：完成本轮最终全门禁，确认只有用户未跟踪的 `AGENTS.md` 未暂存，再通过
  Linux 临时裸仓库中继推送并等待 Draft PR CI。
- 恢复步骤：进入 `%USERPROFILE%\Desktop\Projects\zhiweave`，核对分支
  `agent/professional-workbench`、最新提交和 `AGENTS.md` 排除；确认新 CI 后从受控附件导入/
  引用写入事务开始下一纵切。
