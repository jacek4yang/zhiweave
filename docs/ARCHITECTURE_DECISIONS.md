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

实现证据：registry 已统一 command id、分类、关键词、快捷键、平台能力、上下文顺序与启用条件；
Windows 原生和浏览器预览使用同一清单，但通过能力过滤避免预览冒充文件、索引或备份能力。命令
面板、上下文菜单与键盘入口只分发展示对象和 command id，业务执行仍复用既有工作流。

## ADR-0006：SQLite 使用 bundled + WAL

状态：Accepted（schema v2：FTS + Wiki 派生边）；大规模启动优化仍待验证

使用 `rusqlite 0.40.1` + bundled SQLite 降低平台差异，数据库固定为工作区
`.zhiweave/index.sqlite3`，不得接受前端任意路径。启用 application ID、schema `user_version`、
foreign keys、WAL、`synchronous=FULL`、5 秒 busy timeout、1000 页自动 checkpoint 和操作后
显式 passive checkpoint。数据库不得放在网络文件系统。

schema v1 先建立严格 `note_index` 元数据表和 FTS5 trigram 虚表；schema v2 在不改变
Markdown 事实源的前提下增加可重建 `wiki_edge`。trigram 服务中英文子串，
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

## ADR-0011：版本 DAG 使用内容寻址分块，不使用父版本补丁链

状态：Accepted（本地历史 schema v2）

正式版本历史存放在固定工作区的 `.zhiweave/history.sqlite3`，与可重建的
`index.sqlite3` 分离。它是用户数据的一部分：损坏、外来 application ID 或未来 schema
必须失败关闭，不能静默删除或重建。

每个版本节点记录稳定笔记 ID、父节点、标题、时间、完整内容哈希和一份有序分块清单。正文
使用 FastCDC 内容定义分块，分块以 SHA-256 寻址并用 zstd 压缩；相同内容块只保存一次。
版本不保存依赖父节点才能解释的文本补丁，所以每个仍保留的节点都能独立校验并重建。这样既
能让局部编辑复用大部分旧内容，也允许在一个事务中删除精确旧节点、把直接子节点重接到旧父
节点并垃圾回收无引用块，而不会重写后代正文。

每篇笔记有一个显式 head。保存、切换 head 和删除都携带调用方看见的 expected head；多窗口
或多进程竞争返回结构化冲突，不做 last-write-wins。切换到旧节点后继续保存会自然形成分支。
同一 head 上内容哈希相同的保存是 no-op。恢复时先验证压缩块、分块 SHA-256、长度和完整内容
SHA-256；任何不一致都拒绝把内容交给编辑器。

本地历史格式限制单篇 Markdown 为 16 MiB、单篇最多 10,000 个版本、标题 200 字、说明
200 字。SQLite 启用独立 application ID、schema version、foreign keys、WAL、
`synchronous=FULL`、busy timeout 和 `quick_check`。后续同步层传输加密后的版本对象，但不能
改变本地 DAG、显式冲突和校验语义。

选择完整清单 + 内容寻址分块，而不是单段前缀/后缀 delta 或父依赖补丁链，是为了把删除、
分支、损坏隔离和恢复从“重写整条后代链”降为局部事务。代价是每个版本多一份小型清单，并
需要在写入和读取时执行分块、压缩与哈希。

schema v2 为节点增加可选命名检查点。保留策略始终保护当前 head、所有根、所有分支末端、
命名检查点、指定天数内节点和指定数量的最新节点。清理先返回绑定 head、完整图、固定时间
边界和精确候选集的 SHA-256 预览令牌；应用时在 `IMMEDIATE` 事务内重新计算，任何 head、
检查点或图变化都会使旧预览失效。批量删除先把保留节点重接到最近保留祖先，再回收全局无
引用块；候选内容损坏时预览失败，不借清理掩盖损坏。

## ADR-0012：完整备份使用校验清单，恢复在下次启动前切换目录

状态：Accepted（Windows 本机工作区 alpha）

完整备份是 `.zhiweave/backups/<UUID>.zhiweave-backup/` 目录包。`payload/` 保存普通工作区
文件、附件、开放集合/Canvas、identity、recovery 和一份通过 SQLite `VACUUM INTO` 得到的
一致历史快照；可重建的 `index.sqlite3`、WAL/SHM、临时文件和已有备份不进入 payload。
`manifest.json` 对每个 portable 相对路径记录长度和 SHA-256，并记录总字节与历史节点数。
包只有在逐文件复读、路径集合、总量和全部历史节点重建校验通过后才从 `.pending-*` 同卷
重命名为正式目录。符号链接、路径穿越、非常规文件、超过 100,000 个文件、单文件 4 GiB 或
总计 64 GiB 均失败关闭。

恢复不在运行中的工作区逐文件覆盖。用户选择恢复后，系统先复核目标包，再创建并校验当前
工作区安全备份，然后在工作区同级构建完整 stage；外部原子写入 restore plan。下次启动时，
在 `FileWorkspace`、SQLite 与 watcher 打开之前再次校验 stage，把现工作区重命名为唯一
`previous` 目录，再把 stage 重命名为固定 workspace。plan 使进程在任一次 rename 前后中断
时可以继续或回退；旧工作区不自动删除。恢复后的派生搜索索引从 Markdown 与 identity 重建。

此设计牺牲“点击后立即热切换”，换取文件监控、SQLite 连接和 WebView 都无法观察到半恢复
状态。当前包是本机未加密目录；它可以手动复制用于离线备份，但在客户端加密完成前必须像
原始 Markdown 一样保护。

## ADR-0013：mdast 是跨阅读功能的语义边界，原始 source 始终并存

状态：Accepted（阶段 3 第一纵切）

CodeMirror 6 + Lezer 继续作为编辑输入期的增量语法内核；阅读、结构化复制、大纲、Wiki/
Callout 扩展和后续导出使用 `mdast-util-from-markdown` 产生的标准 AST，再提升为 ZhiWeave
扩展节点。两层通过 source position 和受测适配器对齐，不能让阅读器再维护逐行正则语义，
也不能为了共享 AST 把整篇解析塞进每次按键主线程。标准节点已有精确 position；Wiki 子节点
已有输入期 Lezer 范围，Callout 名称/标题和 Wiki 长度上限由小型共享契约约束；其余扩展继续
随 Corpus 扩充范围适配。

`MarkdownDocument` 同时保存 AST 与未改写的 source。未知节点优先按 position 从 source
降级；解析异常显示转义后的原文。原始 HTML 不经 `dangerouslySetInnerHTML`，图片不自动发起
网络请求，链接只允许 `http`、`https`、`mailto`，普通 fence 永不执行。数学按需加载 KaTeX
并设置 `trust=false`；`zhiweave-lab` 仍只接受严格 schema 的内置声明式组件。

选择 mdast 是为了复用成熟的 CommonMark/GFM/frontmatter/脚注/数学语义，同时保持 Markdown
事实源和未知扩展保真。代价是编辑器 Lezer 与跨功能 mdast 仍需一层位置/节点契约，以及解析器
和 KaTeX 的按需包体。首批 Live Preview 与大纲不能代表整条管线完成；搜索、反向链接、版本
差异和真实附件仍需接入同一契约并通过 Corpus。数学、图片安全占位、脚注与闭合 fence 已完成
当前输入期范围适配，但真实 IME/Android、附件解析和语义导出未通过前不能标记整条管线完成。

## ADR-0014：Wiki 关系是 Markdown 派生边，歧义解析失败关闭

状态：Accepted（SQLite index schema v2）

`[[target]]`、`[[target|alias]]` 和 `![[target]]` 仍只存在于可移植 Markdown。共享 Rust
扫描器从正文安全范围提取 occurrence；SQLite `wiki_edge` 保存来源稳定 ID、link/embed、
原始 target、UTF-8 字节范围、Unicode 行列和有界上下文。它与 FTS 一样可删除、可重建，
不得成为正文、alias 或关系的唯一事实来源。

解析优先级固定为：

1. 精确 portable path，允许省略 `.md`；
2. 唯一 H1；
3. 唯一文件名 stem；
4. `[[#heading]]` 的当前节点身份。

带 `/` 或 `\` 的路径引用不回退成标题。大小写折叠后任一级有多个候选就保留
`ambiguous`，缺失保持 `missing`；不能依据最近访问、目录距离或排列顺序猜测。创建、H1/path
变化、删除和全快照重新解析受影响关系；普通正文保存只重新解析当前来源的边，避免每次自动
保存遍历全部 occurrence。后续 10,000/100,000 节点基准可能要求为目标候选增加持久归一化键，
但不得改变歧义失败关闭语义。

schema v1→v2 在事务中新增 nullable `wiki_revision` 和严格 `wiki_edge` 表。旧行以 NULL
强制从 Markdown 回填；未来 schema 继续拒绝降级。目标删除使用外键把派生 target 置空，
随后解析为 missing；来源删除级联移除边。显式重建先在临时库生成、完整性检查并保留旧库，
沿用 ADR-0006 的恢复边界。

IPC 对外标明 `sourceByteStart/sourceByteEnd`，防止把 Rust UTF-8 byte offset 误当成 JavaScript
UTF-16 position。客户端在打开来源时执行受测转换再交给 CodeMirror。右侧关系检查器仅在
Tauri + ready index 能力下出现；浏览器 UI 预览不得用前端正则或演示数据冒充生产关系。

同一 resolver 也通过 `ResolveWikiTargetRequest` 提供正向读取：输入只有稳定来源 ID 与 authored
target，输出是 `resolved/missing/ambiguous`、可选稳定目标元数据和 heading。阅读视图直接单击，
Live Preview 用 `Ctrl/Cmd+单击` 避免破坏插入点；heading 再由共享 mdast 大纲位置定位。
missing/ambiguous 失败关闭，不创建文件、不回退猜测。Wiki DOM 使用独立 `wiki-link` command
scope，右键菜单不继承整个预览区的通用操作；浏览器预览只允许复制 target，不显示原生打开。

## ADR-0015：缺失 Wiki 与附件写入都是来源身份绑定的后端提案

状态：Accepted（阶段 3 本地知识资源纵切）

缺失 Wiki 目标不由前端把 authored target 转成文件路径。application 层根据稳定来源身份和
当前全量快照生成标题、portable Markdown path 与可选 heading 提案；用户确认后，后端重新
快照、重新调用同一 Wiki resolver，并要求结果仍为 `missing` 且重新生成的路径与提案完全一致。
随后使用 `create_new` 写入 H1 与可选 H2，任何歧义、陈旧来源、状态变化或目的文件存在都失败
关闭。这样确认对话框是审查界面而不是路径授权令牌。

附件读取同样只接受稳定来源 ID、原始 target 和受限引用类型。普通 Markdown 图片相对来源
文件目录解析；Wiki 嵌入在来源目录、`attachments/` 和工作区根生成确定候选，多个既有候选
返回 `ambiguous`。不带已知附件扩展名的 Wiki 嵌入返回“非附件”，继续交给 Wiki 节点 resolver。
显式位于 `attachments/` 下的嵌入即使扩展名未知也视为惰性附件，避免导入后的通用文件被误当作
知识节点。
所有候选使用 portable resource path，并逐段拒绝 `.zhiweave` 与符号链接；最终 canonical path
必须仍位于固定 workspace root。

当前活动附件只允许 PNG、JPEG 和静态 WebP。Rust 在返回字节前复核扩展名、文件签名、动画
标志、8 MiB 大小、16,384 单边与 40,000,000 总像素限制，并计算 SHA-256。SVG、GIF、动画
WebP、PDF、音视频、远程/活动 scheme 和未知格式只产生结构化状态，不进入 WebView 活动资源
管线。Tauri 把已验证字节编码为精确 MIME 的 inert data URL；React/CodeMirror 仍执行 MIME/
scheme 防御检查并惰性加载。浏览器预览没有该 capability，只显示占位。

附件导入只由 Rust 打开原生系统选择器；WebView 只提交当前来源稳定 ID，从不接收、保存或回传
所选文件的完整系统路径。Rust 拒绝符号链接和非普通文件；Windows 以
`FILE_FLAG_OPEN_REPARSE_POINT` 打开选择结果，并对已打开句柄再次核对类型与重解析点属性，
避免选择后到读取前的路径替换。单次最多读取 64 MiB 原始字节，生成 `attachments/` 下经过
portable 文件名清洗、Windows 设备名规避和同名后缀分配的提案。
提案包含原文件名、精确目标、原始大小、SHA-256、显示策略和将插入的 Markdown，并绑定一个
10 分钟、一次性、内存中的 opaque token；待确认队列同时受数量和总字节预算约束。

确认时后端丢弃 token 后重新验证来源身份，以捕获的原始字节重新生成目标和摘要，要求与用户
看到的提案逐字段一致，再以 `create_new → write_all → sync_all → bounded re-read` 发布。任何
同名竞态、摘要变化、过期 token、根外路径或 I/O 失败都删除本次未提交文件且不覆盖既有资源。
签名、扩展名和预览预算均安全的静态图片使用相对来源的标准 Markdown 图片语法；PDF、音视频、
未知格式和超出活动预览预算的资源使用 `![[attachments/name.ext]]` 惰性引用，不执行文件。

文件发布成功后，React 只把后端返回的完整引用交给 CodeMirror，一次 transaction 在当前光标
插入并进入统一 undo 历史；后端不直接改写 Markdown。撤销只移除引用，不删除原始附件，避免
编辑器失败或误操作造成数据丢失；若极端情况下光标已不可用，界面明确显示已保存路径和引用。

这一设计以多一次后端往返和当前较保守的媒体支持，换取路径、身份、竞态与活动内容边界集中在
Rust。后续缩略图缓存、PDF/音视频阅读器必须扩展同一端口和限制，不能把任意系统路径、
`asset:` URL 或未清洗 SVG 直接交给 WebView。

## ADR-0016：局部图谱是 Wiki 派生边的有界只读投影

状态：Accepted（阶段 3 局部知识关系纵切）

局部图谱复用 ADR-0014 的 `wiki_edge` 与稳定节点身份，不建立第二份前端关系解析器，也不把
节点坐标、选中状态或聚合边写回 Markdown/SQLite。`LocalGraphRequest` 只接受当前稳定节点 ID
与节点上限；零上限结构化拒绝，任何调用最多返回 80 个节点。第一版只查询一跳直接邻居，
按总 occurrence 次数、标题和稳定 ID 确定截断顺序，并把同一来源、目标、link/embed 类型聚合
为带计数的有向边。中心节点始终在结果首位，额外读取一个邻居只用于可信地标记 `truncated`。

查询采用“先选邻居、再取这些邻居相关边”两阶段流程，防止单个高频邻居占满 SQL 行后把其他
已选节点的边截断。所有参数绑定，动态 SQL 只生成由后端集合长度决定的占位符；unknown root
和损坏的 ID/path/kind 失败关闭。图谱是可删除重建索引的读取视图，不改变 Markdown 事实源。

React 只在原生索引 ready 且用户打开面板时动态加载 40 节点视图；大纲、反向链接和图谱互斥，
避免多次压缩正文。SVG 节点保留 `note-item` 上下文、稳定 ID、键盘焦点和 Enter/Space 操作；
图谱背景使用独立 `graph` scope，因此右键命令由真实命中对象决定。浏览器预览隐藏原生入口。
这项决策只接受有界局部图谱；全局图谱必须另建分片/聚类/虚拟化查询和大数据性能门，不能把
扩大本接口上限当作全局实现。

## ADR-0017：标签会话只有一个可替换预览槽

状态：Accepted（阶段 1 专业工作台纵切）

标签打开顺序、关闭历史和临时预览身份由纯前端 `TabSession` 一次性建模；这些都是工作台会话
状态，不写入 Markdown、稳定身份清单、派生 SQLite 或版本 DAG。任一时刻最多一个打开标签是
临时预览。单击未打开节点会创建预览；继续浏览另一个未固定节点时在同一位置替换旧预览，并且
不把自动替换记录成用户主动关闭。单击已有固定标签只切换活动节点，不降低它的固定级别。

双击、显式打开、分栏、版本入口和首次正文编辑都把目标转为固定标签。用户也可通过同一 command
registry 的 `tab.pin` / `tab.unpin` 从命令面板或目标相关右键菜单切换；能力矩阵保证一个标签只
出现与当前状态相反的动作。转为临时预览时若已有另一个预览，旧预览退出会话，目标同时成为
活动标签，避免活动节点指向已移除标签。

显式关闭仍进入最多 20 项的重开历史，重开时固定；“关闭其他标签”保留并固定目标。外部 Markdown
快照、删除和 recovery 重映射只保留有效稳定节点 ID，并同步清除悬空预览/关闭项。跨进程
持久化遵循 ADR-0018 的独立 UI 会话边界，不能因此把正文或未保存缓冲写入 WebView 存储。

## ADR-0018：工作台恢复只保存有界、版本化的 UI 会话

状态：Accepted（阶段 1 专业工作台纵切）

工作台使用独立的 `zhiweave.workbench.preferences.v3` 保存活动稳定节点 ID、编辑/阅读/分栏
模式、实时语法开关、桌面侧栏意图、唯一检查器、版本视图状态、两侧面板宽度，以及 ADR-0017
的标签打开顺序、关闭历史和预览身份。记录不包含 Markdown、编辑器缓冲、revision、portable
path、工作区根、附件、SQLite 或版本 DAG；原生正文仍只从 Rust 固定工作区加载。旧 v1 四开关
和 v2 会话记录只读迁移，不原地改写；未知未来 schema、损坏 JSON 和非法字段回退到安全默认值。

输入边界最多接受 50 个打开标签、20 个关闭历史，稳定 ID 最长 200 字符且不能含控制字符；
恢复前去重并与当前 Rust 快照中的有效 ID 交集。有效活动节点会被确保打开；活动节点消失时选取
仍有效的已开标签，全部旧标签失效时才回退当前 Markdown 快照选择。用户明确关闭全部标签的空
会话保持为空，不在重启时偷偷重开。预览 ID 必须属于打开集合，关闭历史不能与打开集合重叠。

原生启动先异步取得并验证 Markdown 快照，再恢复 ID 会话；在快照 ready 以前禁止偏好写回，
避免演示占位 ID 覆盖真实会话。紧凑视口启动时强制隐藏侧栏，但单独保留桌面侧栏意图，回到
宽视口后恢复；响应式强制隐藏不会篡改用户的桌面布局。检查器仍保持大纲/反向链接/局部图谱
互斥，浏览器预览不恢复原生专属检查器。布局写入按 UI 状态变化发生，不在每次 CodeMirror
按键时序列化 Workspace 或全文。

## ADR-0019：快捷键是命令注册表的版本化本机投影

状态：Accepted（阶段 1 专业工作台纵切）

默认快捷键继续定义在类型化 command registry；用户覆盖只在独立的
`zhiweave.shortcuts.v1` 本机设置中保存 `command id → 一至两段按键/null`。`null` 表示显式
解绑。记录不包含 Markdown、节点 ID、正文、路径、revision、附件或工作区信息，不进入
identity、SQLite、版本 DAG 或同步对象；损坏 JSON、未来 schema、未知命令和越界按键全部
失败关闭。

每段只接受带 Ctrl/Cmd 的组合键或 F1–F12；最多两段。冲突同时检查完全相同和前缀关系，避免
一段命令吞掉二段 chord。界面必须准确命名冲突命令，只有用户明确“替换”后才解绑旧命令；
单项恢复默认、全部恢复默认和解绑同样经过该模型。输入法 composition 期间不录制或分发全局
快捷键。

按钮提示、状态栏、命令面板、右键菜单、工具栏和键盘分发统一读取同一份 effective shortcut
投影，不能显示默认值却执行覆盖值。全局 capture 监听只负责匹配并分发 command id，业务仍走
统一执行器；`Ctrl/Cmd+K Ctrl/Cmd+S` 打开可搜索、可录制、可恢复且有焦点陷阱的快捷键编辑器。
编辑器按需分包，不进入初始执行路径。Vim 模式和移动端命令入口是后续独立能力，不能借快捷键
覆盖模型隐式实现。

Windows 自定义标题栏只额外声明关闭、最小化和开始拖动三个必要 Tauri 窗口权限；最大化沿用
框架默认能力。标题栏按钮仍调用同一 command registry，不扩大文件、Shell 或网络能力。

## ADR-0020：面板尺寸是有界、可撤销的 UI 投影

状态：Accepted（阶段 1 专业工作台纵切）

主侧栏和右侧检查器分别使用 `200–400 px`、`220–420 px` 的有界宽度，默认值为 `244 px` 和
`270 px`。拖动只更新当前渲染投影，指针释放、取消或失去 capture 时才提交版本化工作台偏好；
因此不会在每个 pointer move 序列化记录。非有限值、越界值和旧 schema 迁移统一经过同一
normalize 模型，不能把损坏尺寸带进 CSS。

分隔条是 `role=separator` 的可聚焦控件，暴露当前值与上下限；方向键每次调整 12 px，
`Shift` 加速为 36 px，`Home`/`End` 跳到边界，`Enter` 或双击恢复该面板默认值。右键命中
`panel-resizer` scope 时只显示“恢复默认面板宽度”，执行器一次恢复两侧，避免把全局菜单伪装成
当前位置操作。

响应式布局不篡改桌面宽度意图：`≤1100 px` 的检查器变成右侧覆盖层，`≤960 px` 的主侧栏变成
覆盖层且隐藏分隔条，`≤480 px` 的检查器占满正文表面；恢复宽视口后继续使用已验证的用户宽度。
桌面双栏必须至少给编辑器保留 `320 px`，不足时先约束检查器的有效宽度。该投影只属于本机 UI
会话，不进入 Markdown、稳定身份、索引、版本历史、同步对象或服务端数据。
