# 开发进度

最后更新：2026-07-30 06:57 CST

## 执行拓扑

- 开发、构建、Rust/TypeScript 测试、Tauri 运行和浏览器验收全部在当前 Windows 电脑完成。
- Linux 上传中转机只承担最终的 GitHub 提交/推送，不运行开发服务或质量门。
- 当前本地分支：`agent/professional-workbench`；Markdown 文件纵切与首轮 CI 证据已通过 Linux 中转推送到 Draft PR #1。
- 用户指定的 SOCKS5 下载代理已按要求尝试，包括 `notify`、`fastcdc` 和 `zstd` 下载；本机无法建立 TCP 连接后才单次直连回退。代理地址本身不写入仓库。

## 已完成

- 阶段 0 产品、UX、设计、编辑器、Markdown、性能、安全、测试与架构审计文档。
- Windows Node 26.1.0、pnpm 11.9.0、Rust/Cargo 1.95.0 基线。
- TypeScript 类型检查、前端测试、生产构建及 Rust fmt/Clippy/workspace tests 基线通过。
- TokyoNight Moon 角色化语义配色：从服务器 `~/.config/nvim` 只读研究后适配，不复制插件实现。
- 专业深色工作台：48 px Activity Bar、可折叠笔记栏、编辑器优先布局、无营销卡片、无网络字体。
- Windows 原生无系统标题栏：客户区顶部差为 1 px，仅保留可缩放边框；自定义最小化/最大化/关闭按钮。
- 多标签、关闭/重开/切换、VS Code 风格快捷键、详细状态栏、实时分栏和阅读预览。
- H1 驱动知识节点显示名，恢复同一笔记版本时编辑器正确同步。
- 持久化父节点版本 DAG、分支、图形历史、恢复保护、旧节点安全删除/子节点重接与真实存储摘要。
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
- 原生新建知识节点、今日日记和 UUID 实验写入 Markdown；Ctrl+S 保存文件，Ctrl+Alt+S 创建持久版本节点。
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
- `.zhiweave/history.sqlite3` 是独立于可重建索引的正式历史库；使用独立 application ID、schema v2、WAL/FULL、foreign keys、busy timeout、`quick_check` 和 optimistic head；v1 原位迁移已测试。
- 正文通过 FastCDC 内容定义分块、SHA-256 内容寻址和 zstd 压缩；相同块跨版本复用，每个版本仍能脱离父节点独立校验并重建。
- 保存相同 head 内容是 no-op；恢复前先持久保护当前编辑内容，目标版本经分块/长度/完整哈希验证后才以文件 revision 防冲突写回，再切换分支 head。
- 精确删除旧节点时在同一事务内把直接子节点重接到旧父节点、调整 head，并只回收全局无引用块；多窗口陈旧 head 结构化冲突，不做 last-write-wins。
- 版本节点支持 1–80 字命名检查点；右键和节点卡操作会按当前检查点状态显示“命名并保护”或“取消保护”。
- 保留策略先精确预览再清理：固定保护 head、根、每条分支末端、检查点、最近天数和最新数量；预览令牌在 head、图或检查点变化后失效。
- 批量清理在一个 SQLite 事务内重接保留节点、删除候选并回收全局无引用块；损坏候选在预览阶段失败关闭。
- 完整工作区备份包包含 Markdown、附件/开放文件、identity、recovery 与一致历史快照；派生索引和已有备份不递归打包。
- 每个备份以路径、长度和 SHA-256 清单逐文件复读校验；临时包通过后才同卷发布，备份列表可随时执行完整复核。
- 完整恢复先校验目标并自动备份当前工作区，再构建完整 stage；下次启动在 SQLite/watcher 打开前切换目录，旧工作区保留为 previous，双 rename 中断可继续恢复。
- 类型化 command registry 统一 50 余项工作台、导航、视图、标签、知识节点、编辑器、版本、
  备份、窗口与对话框操作；按钮、VS Code 风格快捷键、命令面板和右键菜单只分发同一 command id。
- 命令面板支持中文、关键词/别名与模糊子序列检索，键盘选择/执行/Esc、焦点陷阱和触发点恢复；
  原生能力矩阵不会在浏览器预览中伪造文件、索引、重命名或完整备份能力。
- 标题栏、Activity Bar、工作区、笔记栏、具体节点、标签、编辑器/输入框、预览、实验、状态栏、
  版本节点和备份节点使用独立上下文矩阵；菜单支持首项聚焦、方向键、Home/End、Esc 与焦点恢复。
- Activity Bar、笔记列表与标签增加对应方向键/roving tab 操作；新建节点和外部更改对话框增加
  焦点陷阱、初始焦点和准确触发点恢复。
- `markdownAst.ts` 使用标准 mdast + GFM/frontmatter/math 扩展建立 source-preserving 语义层，
  并把 Wiki Link、嵌入与 Callout 提升为显式 ZhiWeave 节点。
- 手写逐行 MarkdownPreview 已替换：标题/段落/引用/嵌套任务、表格、脚注、代码元数据、Wiki、
  附件占位、Callout、行内/块数学和 frontmatter 使用语义 DOM；未知节点与异常按原始 source
  安全降级，不丢内容。
- 原始 HTML 只显示为转义源码，远程图片不自动加载，危险 URL 不生成链接；普通代码不执行，
  KaTeX 按需加载并禁用 trust，声明式 `zhiweave-lab` 仍经过独立严格校验。
- 当前节点新增“复制 Markdown 原文”和“复制结构化阅读文本”统一命令，可由命令面板及对象相关
  右键菜单调用；代码和块公式提供精确源码复制。
- H1 命名扫描新增 YAML/fence 排除、Setext H1、链接/Wiki 显示名处理，避免把元数据或代码里的
  `#` 错当成知识节点名。
- 输入期新增 Lezer frontmatter 与 Wiki Link/嵌入节点；首批 Live Preview 使用 StateField、
  ViewPlugin 与 Decoration，覆盖标题、强调/删除线、链接、Wiki、行内代码、任务和 Callout。
  composition 期间停止替换，全部选区都会揭示所在语法，未知语法保持源码。
- 新增 mdast offset 驱动的可关闭文档大纲；编辑/分栏定位 CodeMirror，阅读模式定位同一源码
  offset 的标题。大纲、实时语法开关、命令面板和位置相关右键菜单分发同一 command id，布局
  偏好与 Markdown 数据分离保存。
- Wiki 长度上限与 Callout 名称/中文标题抽为轻量共享契约，减少 Lezer 输入层和 mdast 阅读层
  漂移；任务 checkbox 修改走正常 CodeMirror transaction，可撤销。

## 当前质量证据

- `pnpm typecheck`：通过。
- `pnpm test`：8 files / 41 tests，通过。
- `pnpm build`：通过，最近一次约 500 ms。
- 交互实验独立 chunk：5.99 KB（gzip 2.46 KB）。
- Markdown 阅读器 / AST 独立 chunk：11.32 / 92.24 KB（gzip 3.98 / 26.02 KB）。
- 文档大纲独立 chunk：1.16 KB（gzip 0.67 KB）。
- KaTeX 独立 chunk：259.54 KB（gzip 77.66 KB），只在公式出现时加载。
- 主 CSS：53.19 KB（gzip 10.03 KB）。
- 主 JavaScript：927.07 KB（gzip 308.74 KB），仍超过 200 KB 首屏预算并触发 Vite 警告。
- Rust workspace 49 项测试通过，其中 application 4 项、Tauri 4 项、storage 30 项、portable path 5 项；fmt 和全 workspace Clippy `-D warnings` 通过。
- `pnpm audit --prod --audit-level high`：无已知漏洞；`cargo audit --no-fetch --stale` 扫描 471 个 lockfile 依赖，无已知 vulnerability，17 项既有 allowed warning。
- Windows 原生进程：`知织 · ZhiWeave` 正常运行；固定工作区有 6 个真实 Markdown、identity v1 的 6 个唯一 ID/路径和有效 SQLite 3 数据库。
- 共享 Markdown AST 功能提交 `27bf009` 已推送；GitHub CI run `30497652526` 的 Frontend 与
  Rust 全部通过。
- GitHub CI run `30487216178`：watcher 跨平台修复后的 Frontend 与 Rust 全部通过。
- CI 有一项非阻断 annotation：部分 actions 仍声明 Node 20，GitHub runner 已强制 Node 24；列为 workflow 维护项。
- [Draft PR #1](https://github.com/jacek4yang/zhiweave/pull/1) 已创建。
- GitHub CI：Frontend 通过（18 s），Rust 通过（3 min 7 s）。
- Windows 原生版本验收：创建第二版本、恢复旧节点、从旧节点形成分支；重启后 3 个节点、3 个去重块和 796 B 统计保持；删除一个分支节点回收 275 B，其他节点仍可恢复。随后恢复原始 Markdown 并清空全部测试版本，最终 0 节点/0 B。
- Windows 原生保留验收：创建 6 节点线性历史、命名“核心理解完成”检查点，以“最新 2 个/最近 0 天”生成 2 个候选和 540 B 精确预览；执行后保留根、检查点和最新节点，右键菜单同步变化。验收节点随后清空，原 Markdown 不变。
- Windows 原生完整备份：创建并再次逐文件校验“版本与备份功能上线基线”，覆盖 8 个文件、46.1 KB 和空历史库；1280×800、390×844 均无页面级横向溢出，恢复确认取消后无 pending plan。
- 命令系统浏览器验收：中文“分支”检索、方向键/Enter、Esc 和触发点恢复通过；节点菜单按对象
  分流并恢复到原按钮；新建对话框初始焦点/Tab 循环/Esc 恢复通过；390×844 与 1280×800
  无页面级溢出，窄屏滚动条已按主题收敛。
- 命令系统 Windows 原生验收：原生命令面板正确增加完整备份、重建索引、路径复制和重命名；
  `Ctrl+P`、`Ctrl+Shift+P`、节点菜单方向键/Esc 与焦点恢复通过，无 console error/warning；
  全程未修改 Markdown、版本或备份。
- Markdown AST 浏览器验收：复杂文档完整显示 YAML、H1、跨行段落、强调/删除、Wiki、Callout、
  嵌套任务、表格、代码、公式、脚注、附件/嵌入占位和转义 HTML；代码/公式/Markdown/结构化
  文本复制正确。DOM 中无 script、事件属性、iframe 或活动图片，console 无 warning/error。
- Markdown AST 响应式验收：1280×720 与 390×844 均无页面或正文水平溢出；宽表格和长 HTML
  源码只在自身容器滚动，窄屏右键菜单完全位于视口内。
- Windows 原生只读验收：真实 welcome Markdown 进入新阅读器，H1 与正文完整；命令面板和预览
  右键菜单均显示两类复制命令，无页面/正文溢出且未修改 Markdown、版本或备份。
- 本轮 Live Preview 页面由 Windows Vite 服务以 HTTP 200 提供；应用内浏览器控制连接在导航
  阶段连续超时，因此尚未把本轮光标/大纲视觉交互记为浏览器验收通过。
- 本轮 Windows Tauri dev profile 重新编译并启动 `知织 · ZhiWeave`，窗口进程正常响应且启动
  日志无运行期错误；该证据只覆盖原生壳启动，不替代光标、IME 和视觉交互验收。

## 当前任务

1. 为首批 Live Preview 完成真实 Windows 光标/IME/多光标与窄屏验收，再补数学、图片、脚注
   和 fence 装饰。
2. 扩展 Markdown Corpus、2 MiB/深层/恶意输入基准；大纲已接入，继续 Wiki 目标、反向链接、
   附件和版本语义 diff。
3. 增加快捷键编辑器、预览标签和移动触控入口。
4. 补 watcher 高频压力、文件锁、磁盘满、只读目录和强杀恢复夹具。
5. 继续集合、Canvas 与跨设备加密备份/同步设计；现有本机目录备份不能冒充加密云备份。

## 未解决风险

- 原生正文和版本 DAG 已移出 `localStorage`；浏览器预览仍保留独立演示历史，布局持久化尚未独立建模。
- 隐藏 ID 和 SQLite/FTS 已落地，但启动快照仍扫描并读取全部 Markdown，尚未达到 10,000/100,000 篇性能预算。
- 显式移动采用安全的“新建目标 → 写入/同步/校验 → 再删源”以避免跨平台覆盖；强杀最坏可能留下两份文件，且删源前仍有极窄外部竞态。
- 外部“改名同时改正文”无法仅凭 revision 自动识别为同一节点；应用内显式重命名可以稳定保持身份。
- watcher 只保证“事件后完整核对”，不保证底层平台一定投递事件；网络文件系统不在当前固定本机工作区支持范围，高频事件压力和进程休眠恢复仍需基准。
- create 的空占位后若进程强杀可能留下空 Markdown，自动恢复日志未完成。
- 通用阅读器、输入期首批 Lezer Decoration 和大纲已按 source offset 对齐，但数学、图片、
  脚注、fence、搜索/反向链接/导出/版本差异尚未统一完成。
- 首屏 JS gzip 超预算 108.74 KB；CodeMirror/图标/工作台和命令面板需进一步分包和测量。
- KaTeX 虽按需加载，但构建仍携带上游 WOFF2/WOFF/TTF 多格式字体，安装包资产需要收敛。
- 已有可校验完整工作区目录包和重启前目录切换恢复，但尚无系统文件选择器导入、跨设备恢复演练、备份加密或同步加密；本地 SQLite 与备份包目前未加密，不得宣称客户端密码保护已完成。
- Command registry/命令面板第一纵切已完成，但快捷键编辑器、完整树/属性/反向链接、FSRS 与深度学习 schema 尚未完成。
- 当前垂直切片已发布到 Draft PR；根目录 `AGENTS.md` 仍是用户未跟踪文件，严禁暂存。

## 当前截图

- [Windows 工作台 1280×720](./baseline/workbench-windows-1280x720.png)
- [窄屏工作台 390×844](./baseline/workbench-narrow-390x844.png)
