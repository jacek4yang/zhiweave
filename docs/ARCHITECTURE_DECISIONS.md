# 架构决策记录

最近更新：2026-07-30

## ADR-0001：CodeMirror 6 + Lezer 作为 Markdown 主编辑内核

状态：Accepted

原因：源码保真、transaction/undo 一致性、视口渲染、增量语法树、可映射 Decoration 和扩展体系与目标匹配。ProseMirror/Lexical 更偏结构化富文本，Monaco 包体积和 Markdown Live Preview 适配成本更高。

Tree-sitter 只作为缺失代码语言的 Worker 候选，未经基准不进入主链。

## ADR-0002：Markdown 文件为正文事实来源

状态：Accepted

普通笔记正文只写 UTF-8 Markdown。SQLite 是可重建索引和状态库。删除 SQLite 后，正文、附件、集合和 Canvas 仍完整存在。

## ADR-0003：Rust 拥有持久化和安全边界

状态：Accepted

React/TypeScript 负责 UI、输入、编辑器和浏览器测试；Rust 负责路径、原子文件、SQLite、索引、迁移、密钥、同步、版本、附件、FSRS 和恢复。前端不得直接操作数据库或主密钥。

## ADR-0004：浏览器适配器与生产适配器隔离

状态：Accepted

浏览器预览仅用于 UI/E2E，返回明确的 `browser UI preview` 身份。生产 Tauri 命令失败时不得静默回退到浏览器 Mock。端口接口必须可在类型与测试中区分。

## ADR-0005：工作台 command-first

状态：Accepted

鼠标、快捷键、命令面板和右键菜单调用同一 command registry。避免相同功能拥有多个不一致实现。布局状态单独持久化，不在每次按键序列化全文。

## ADR-0006：SQLite 使用 bundled + WAL

状态：Accepted（schema v1/FTS 纵切）；大规模启动优化仍待验证

使用 `rusqlite 0.40.1` + bundled SQLite 降低平台差异，数据库固定为工作区
`.zhiweave/index.sqlite3`，不得接受前端任意路径。启用 application ID、schema `user_version`、
foreign keys、WAL、`synchronous=FULL`、5 秒 busy timeout、1000 页自动 checkpoint 和操作后
显式 passive checkpoint。数据库不得放在网络文件系统。

schema v1 使用严格 `note_index` 元数据表和 FTS5 trigram 虚表。trigram 服务中英文子串，
1–2 字查询走有界 `instr` 扫描；查询输入最多 256 字，Rust 上限 100 项，当前 UI 请求 50 项。
FTS 存储的正文副本只作为本机派生数据，Markdown 始终是唯一正文事实来源。

`.zhiweave/identity.json` 是独立于 SQLite 的版本化隐藏元数据，保存稳定节点 ID、portable
path 和精确字节 revision。它不是正文，也不是可随 SQLite 一起删除的派生索引；删除它不会
丢正文，但会丢失跨路径稳定身份。普通笔记和 frontmatter 不写入技术 ID。

缺失数据库表示可派生缓存被删除，可以从 Markdown + identity 自动创建。已存在但损坏、外来
application ID 或未来 schema 的数据库不得静默覆盖：工作区仍打开 Markdown，搜索标为需重建/
不可用。用户明确重建后，先在同一隐藏目录生成并校验新库，再把旧数据库及 WAL/SHM 保存在
`.zhiweave/recovery/`，最后安装新库。

已验证中文搜索、短查询、单篇增量更新、失效行清理、删除数据库重建、损坏库保留/恢复、未来
schema 拒绝降级和身份损坏失败关闭。尚未验证磁盘满、长读事务和 10,000/100,000 篇性能预算。

## ADR-0007：同步采用加密对象与显式冲突

状态：Proposed，阶段 9 前需威胁模型与密码学审查

服务端只接触不透明加密对象。同步由用户触发，使用版本 DAG 和幂等请求；不得静默 last-write-wins。所有算法选型采用成熟库，不自行设计密码学。

## ADR-0008：内嵌实验采用声明式组件注册表

状态：Accepted

Markdown 使用 `zhiweave-lab` fenced block 携带版本化 JSON。运行时经过大小上限、schema、kind、字段白名单和值域校验后，只能进入知织内置的受信任 React 组件。拒绝通用 JavaScript、动态模块、远程插件和隐式能力。

理由：学习实验需要交互和动画，但 Markdown 必须继续可移植、可审计、可增量版本化。声明式定义能在普通阅读器中自然降级，也让未知版本、恶意输入和 AI 输出统一经过零信任验证。

## ADR-0009：固定工作区、原子替换与内容修订

状态：Accepted（文件层 + 稳定身份/索引）

Windows Tauri 端只打开应用数据目录下的固定 `workspace`，前端命令不能传入任意根目录。所有用户路径先转为跨平台 `PortablePath`：仅允许相对 Markdown 路径，统一 `/`，拒绝盘符、UNC、空组件、`.`、`..`、NUL、控制字符、Windows 设备名和不可移植字符；文件适配器再逐段拒绝符号链接并校验 canonical root。

读取时：

- 原始字节不得超过 16 MiB，工作区快照最多 10,000 篇、12 层目录；
- 只接受严格 UTF-8；
- 记录 UTF-8 BOM 和 LF/CRLF/CR/Mixed；
- 编辑器内统一为 LF，但保存时恢复原来的单一换行风格与 BOM；
- Mixed 必须由用户明确选择规范化，不能静默改写。

保存时：

- 对精确原始字节计算 SHA-256 修订；
- UI 必须提交上次读取的 expected revision；
- 写入同目录临时文件并同步，再次读取源文件校验修订，最后原子替换并回读验证；
- 外部修改返回结构化 `conflict`，绝不自动 last-write-wins；
- UI 保留编辑器缓冲；用户选择恢复时先另存 `recovery/`，再载入外部版本。

浏览器预览仍使用独立 `localStorage` 演示状态，并在界面明确标注，不会作为 Tauri 命令失败时的回退。

文件扫描、创建和保存通过 Tauri blocking worker 执行；不在 WebView/IPC 响应线程同步遍历磁盘。单一 workspace mutex 先保证同一进程内写入串行，后续基准证明需要时再引入更细粒度并发。

稳定 ID 现在由隐藏 identity v1 清单提供。外部只有一个缺失旧路径和一个相同 revision 新路径时
自动视为无内容改名；重复内容歧义时宁可生成新 ID，不错误合并两个节点。应用内移动先以
`create_new` 创建目标、写入/同步/逐字节校验，再复查源 revision 并删除源，所以目标已存在时
绝不覆盖，失败时优先保留两份。它不是跨平台原子 rename：强杀可能留下重复副本，外部“改名
同时改正文”无法启发式保留身份，删源前仍有极窄 TOCTOU 窗口。

新建采用 `create_new` 空文件占位后原子替换，若占位后进程被杀，可能留下可见的空 Markdown
文件，但不会覆盖已有正文；恢复扫描和创建日志属于下一步。

## ADR-0010：文件 watcher 只负责唤醒，完整快照比较才是事实

状态：Accepted（Windows 本机工作区 alpha）

使用 `notify 8.2.0` 的 `RecommendedWatcher` 递归监控固定工作区。回调不把事件 kind、路径或
rename 配对送入业务层，只向容量 1 的队列发送无路径唤醒；300 ms 安静期后向 WebView 发一个
递增序号。`.zhiweave` 是应用自己的 identity/index/recovery 区，单纯隐藏区写入不唤醒前端；
平台错误、空路径和 `need_rescan` 必须唤醒。

前端携带上次接受的稳定 ID、path、revision 调用 application `detect_changes`。application
重新读取受验证的完整 Markdown 快照，再分类 created/modified/deleted/moved；移动时可同时
标记正文变化。这样平台把 rename 拆成 create/delete、顺序错乱、重复或漏掉中间事件都不会
直接改变用户状态。

外部更改中心只自动应用干净缓冲。脏缓冲保持原对象与旧 revision，直到用户明确选择；接受磁盘
版本前先把所有未保存编辑逐篇创建到 `recovery/`，任何创建失败或恢复期间继续输入都会中止重载。

代价：每次有效事件都会完整扫描正文，尚未达到 10,000 篇目标；底层平台完全不发事件且不发
rescan 时只能在后续事件或重启发现。网络文件系统不在当前固定本机工作区支持范围。
