# 测试计划

最近更新：2026-07-30

## 分层

1. TypeScript 单元：command、状态机、Language Registry、Live Preview、Prompt 隐私、快捷键。
2. Rust 单元：路径、原子保存、迁移、索引、FSRS、加密、版本和冲突。
3. 属性测试：Markdown 往返、路径/Unicode、序列化、集合查询、调度与合并。
4. 模糊测试：Markdown/frontmatter/Wiki Link、Canvas JSON、导入、HTML 清洗、同步和加密对象。
5. 集成：真实临时目录、SQLite、崩溃恢复、文件监控和 Tauri command。
6. 浏览器 E2E：工作台、编辑器、搜索、主题、密度、键盘、响应式和离线资源。
7. 视觉回归：深/浅/高对比、三种密度、中英文、代码、公式、表格、状态与 Android。
8. 跨平台：Ubuntu/Windows/macOS/Android 构建与人工清单。

## 阶段 0 证据

- `pnpm install --frozen-lockfile`：通过，142 个 lockfile 条目通过供应链策略。
- `pnpm typecheck`：通过。
- `pnpm lint`：通过（当前等同 TypeScript noEmit，需加入真实 ESLint）。
- `pnpm test`：通过，10 files / 54 tests；除原有版本/分支、日记/H1、持久版本 DTO、种子、
  交互实验和保存状态用例外，新增 command id/快捷键唯一性、IME 防误触、上下文矩阵、原生能力
  隔离、禁用条件、中文/别名检索、共享 Markdown AST/安全渲染，以及 Lezer frontmatter/Wiki、
  光标揭示、composition 停用、任务/Callout、数学/图片/脚注/fence、多光标、大输入和源码
  不变回归测试；另覆盖反向链接面板/来源节点上下文隔离、Wiki 正向解析/阅读按钮/编辑器
  `Ctrl/Cmd+单击`、heading offset 和 UTF-8 字节位置到 UTF-16 CodeMirror offset 的 Unicode 转换。
- `pnpm build`：最终差异通过，主 chunk 有 >500 KB 警告。
- `pnpm audit --prod --audit-level high`：先使用用户指定 SOCKS5 代理，registry audit 请求重试后
  失败；不下载依赖的直接网络回退通过，无已知漏洞。代理地址不写入仓库。
- `pnpm tauri build`：在当前 Windows 电脑通过，生成 5,935,104 B MSI 与 4,493,937 B NSIS；
  SHA-256 分别为 `E4AAE024283090544881A85AA7DD200637F206B56975641F8F8DD19DFECD8E9C`
  和 `60D7578D028D220CE701FD7F3D9642536A4268CB25CEBCA1513943F5A0B8C78D`。
- 浏览器：搜索、阅读/编辑、分栏、标签、刷新恢复、复制保真、上下文菜单分流、输入粘贴、编辑撤销、UUID 生成/校验/提示词通过；命令面板中文筛选、方向键、Enter、Esc、焦点恢复和 390×844/1280×800 布局通过。
- 本轮 Wiki 正向导航浏览器自动化因应用内浏览器本地导航与 DOM 读取连续超时尚未通过，不得用
  原生截图替代；Windows 原生 IPC、WebView2 DOM 检查、DWM 截图与临时目录/Tauri 集成测试是
  明确区分的替代证据。
- 视口：1280×720、1366×768、1440×900、1920×1080、2560×1440、320×720、390×844、412×915、915×412 均无水平溢出。
- Rust 1.95.0 的最终差异已通过 fmt、workspace all-target/all-feature Clippy `-D warnings`
  与 workspace all-feature tests。
- GitHub CI run `30509720758` 在 Linux runner 上再次通过 Frontend、fmt、workspace
  all-target/all-feature Clippy `-D warnings` 与 workspace all-feature tests。
- `cargo audit --no-fetch --stale`：advisory DB 扫描 471 个 lockfile 依赖，无已知 vulnerability；有 17 个 allowed warning。GTK3/glib 项来自非 Windows 的 Tauri target 依赖（当前 Windows `cargo tree -i glib/atk` 不在目标图），其中 `glib` 有一项 unsound advisory；`urlpattern` 链含 6 个 unmaintained `unic-*`，另有 `proc-macro-error` warning。发布前必须在各目标平台更新 Tauri/传递依赖并以 `-D warnings` 重新评估，不能忽略。

## Markdown 文件纵切证据

- Rust 当前 workspace 66 项测试通过，其中 storage 42 项、domain/portable resource 6 项、
  application 4 项、Markdown 7 项、protocol 1 项、server 1 项和 Tauri 5 项。
- 原子保存：真实临时目录创建、修改、无变化保存、回读修订与 H1 标题通过。
- 字节往返：UTF-8 BOM + CRLF 编辑后精确保留；Mixed 保存失败并要求明确规范化。
- 冲突：读取后由外部进程改写，保存返回结构化 conflict，外部正文逐字节保留。
- 覆盖保护：重复 create 返回 AlreadyExists；普通文件占据父目录时失败且不生成子文件。
- 只读：源文件 readonly 时保存返回 permissionDenied，原文保持不变。
- 中断：`AtomicWriteFile` 写入临时文件后不 commit 即销毁，旧 Markdown 保持可读。
- 输入边界：绝对路径、UNC、`..`、Windows 设备名、非法字符、无效 UTF-8、16 MiB 超限被拒绝；反序列化不能绕过路径校验。
- Windows Tauri：开发进程完成重编译并在固定应用数据工作区生成 6 个种子 Markdown，证明 setup → application service → storage adapter 链路可运行。
- Tauri seed/restart：首次生成 6 篇；用户修改 welcome 后再次初始化不会覆盖正文；已经初始化或
  从备份恢复的空知识库保持为空，不会重新注入示例内容。
- 浏览器：桌面重新载入后无新增 console error/warning；状态栏上下文菜单按环境分流；390×844 与 320×720 无页面水平溢出。

## SQLite、稳定身份与搜索证据

- identity v1：首次扫描生成隐藏清单；ID/path 唯一；非法 JSON、非法 UUID、重复项和非法
  revision 失败关闭。
- 故障原子性：identity 损坏时 create/save/rebuild 在修改 Markdown 前返回结构化失败。
- 重命名：外部唯一同 revision 改名保持 ID；相同内容的多个文件不共享 ID；应用内移动保持
  ID、更新搜索路径、目标存在时不覆盖任一文件。
- schema/migration：空库从 `user_version=0` 进入 v2，真实 v1 fixture 原位迁移并回填 Wiki 边；
  未来 `user_version=999` 不自动降级。
- FTS：标题/正文中文 trigram、单字短查询、保存后增量替换和旧词消失通过；空查询、零 limit
  和超过 256 字查询被拒绝。
- 可重建：删除 SQLite 后快照重新生成索引且 identity 不变；正文逐字节不变。
- 损坏恢复：伪造非 SQLite 文件后快照仍返回 Markdown 并标记 `needsRebuild`，搜索失败；只有
  显式重建才替换，旧字节保留在 `.zhiweave/recovery/`，新搜索恢复。
- Windows 原生：真实 Tauri 进程运行；应用数据工作区有 6 篇 Markdown、identity v1 的
  6 个唯一 ID/路径和有效 `SQLite format 3` 数据库。
- 本次 Wiki 正向导航后的 in-app browser 本地导航与 DOM 读取连续超时，未尝试绕过；由
  TypeScript 检查、原生 IPC/WebView2 DOM 检查、Tauri 临时目录集成测试和新增 Windows 原生
  视觉基线替代。浏览器点击 E2E 仍明确记为未通过。

## Wiki 双向关系与导航证据

- Rust 解析单元覆盖 Unicode 字节范围、alias、embed、YAML、fenced/indented/inline code、
  HTML comment、转义、嵌套/截断与超限语法；非正文区域不生成边。
- storage 临时目录覆盖 source 早于 target 创建、内容增量替换旧边、link/embed occurrence、
  Unicode 行列/上下文、同名 H1 歧义失败关闭、重命名后重解析、删除目标和显式全量重建。
- schema v1 真实数据库降级夹具原位迁移到 v2；已有 FTS/identity/Markdown 保留，`wiki_revision`
  触发旧文档回填，迁移后可立即查询反向链接。
- 普通正文保存只重新解析当前来源边；新建、H1/path 变化及全量快照才重新解析全局候选，避免
  每次键入后保存都扫描全部关系边。10,000/100,000 节点关系基准仍未完成。
- application port、Tauri `workspace_backlinks` 和 camelCase TypeScript DTO 已贯通；Tauri
  种子集成测试验证先创建来源、后创建目标仍返回 welcome → ownership 关系。
- 正向 resolver 复用同一 Rust 权威候选规则；storage 集成测试覆盖精确路径、唯一 H1/stem、
  `[[#heading]]`、missing、ambiguous，以及空值、控制字符、未知来源和 500 Unicode scalar 边界。
  Tauri 种子集成测试覆盖可解析的 welcome → ownership 正向目标。
- 前端测试确认：具备原生 resolver 时阅读器把 Wiki 渲染为可聚焦按钮，浏览器预览保持惰性文本；
  编辑器只在 `Ctrl/Cmd+单击` 时按 Lezer 语法节点查找 authored target，普通单击仍用于编辑；
  heading 定位复用 mdast outline offset，SSR 和长行换行不丢正文。
- Wiki Link 右键使用独立 `wiki-link` scope：原生环境只显示“解析并打开目标”和“复制目标文本”，
  浏览器预览只显示复制；missing/ambiguous 显示明确诊断并失败关闭，不猜测、不创建文件。
- Windows 原生壳实际显示可关闭关系检查器，2560×1368 DWM 截图无裁切；本机既有 6 篇工作区
  没有当前目标的入链，所以截图为空状态。真实非空结果由临时目录/Tauri 集成测试验证，未向
  用户 Markdown 注入验收数据。
- 本轮 Windows 原生 IPC 对当前用户工作区只读验证：`#下一步` 解析回当前稳定 welcome 节点和
  heading，缺失目标返回 `missing/null`。内存临时 Wiki DOM 标记触发的菜单标题为
  “Wiki 链接：Rust 所有权”，且仅有上述两项命令；标记随后删除，未保存或改写用户 Markdown。
- 新基线 `wiki-forward-navigation-windows.png` 为 1942×1214 物理像素；WebView2 DOM 核对
  1280×800 CSS viewport、24 px 状态栏、编辑区完整到底部，长正文采用换行而非裁切。本机当前
  只有一篇既有 welcome 笔记，因此截图不伪造跨节点 authored Wiki 链接。
- 应用内浏览器在本地导航和 DOM 读取阶段连续超时，未把本轮浏览器点击/E2E 标记为通过；
  浏览器预览按设计也不会伪造 SQLite 关系。

## Windows watcher 与外部更改中心证据

- application 纯比较测试覆盖 created/modified/deleted/moved；移动以稳定 ID 判定并单独标记
  `contentChanged`，结果按路径确定排序。
- 客户端 baseline 限制 10,000 篇；重复 ID 与重复路径是结构化失败，防止歧义比较。
- Tauri watcher 测试确认普通源文件触发核对、`.zhiweave` 自身写入被过滤；平台错误、空路径和
  `Rescan`（代表事件丢失）即使只指向隐藏目录也必须触发完整核对。
- 前端模型测试确认干净笔记接受外部版本，修改中笔记和外部已删除的脏笔记仍保留原编辑对象并
  返回 unresolved ID。
- Windows 原生应用中依次外部创建 `watcher-verification.md`、改名、改正文和删除；UI 分别显示
  新建/移动（正确前后路径）/修改/删除，状态栏均为 1 项。
- 原生冲突中心截图检查通过：分类标签、路径、说明和三个处理动作完整显示；测试临时文件删除后
  Markdown、identity 唯一 ID/路径和 SQLite 状态都恢复为 6。
- 监听线程使用容量 1 的非阻塞唤醒队列与 300 ms trailing debounce；事件风暴不会无界堆积，
  业务层不信任或重放原始事件路径。

## 持久版本 DAG 证据

- storage 7 项专门测试覆盖重启持久化、相同 head 内容 no-op、FastCDC/zstd 去重统计、旧节点
  checkout 后分支、删除祖先后的子节点重接与可恢复性。
- 陈旧 expected head 在写 node/chunk/head 前失败，原图保持不变；manifest 写入中途注入
  `RAISE(ABORT)` 后 node、chunk 与 head 全部事务回滚。
- 篡改压缩块后读取返回 `historyCorrupt`，不向调用方返回任何 Markdown；未来
  `user_version=999` 失败关闭且不降级。
- 跨笔记 parent 篡改在 history/delete 变更前失败关闭；损坏图不会被“删除”操作顺手改写成
  看似健康的图。
- 删除独有节点会回收无引用压缩块；仍被其他版本引用的块不会被删除。版本正文不依赖父节点
  delta，所以删除和重接不需要重写后代正文。
- Windows 原生 Tauri：保存第二版本、恢复旧节点、从旧节点另存分支；重启后 3 个节点、
  3 个去重块和 796 B 统计保持。删除一条分支回收 275 B，其余版本仍显示和恢复。
- 原生验证结束前恢复初始 Markdown，逐一删除测试版本；界面最终显示 0 节点、0 B，测试进程、
  本机调试端口和 WebView 连接均已关闭。

## 检查点、保留与完整备份恢复证据

- history schema v1→v2 迁移保留节点并可立即命名检查点；未来 schema 仍失败关闭且不降级。
- 保留测试覆盖根/head/最新数量/分支末端/检查点固定保护、候选内容完整重建、批量重接和空间
  回收。预览后新增检查点会使 token 失效，事务不删除任何节点。
- 篡改候选压缩块时 retention preview 返回 `historyCorrupt`；不会把“清理”当成修复损坏库。
- 完整备份测试真实复制 Markdown、普通附件、identity、recovery 与 `VACUUM INTO` 历史快照，
  逐项复读长度/SHA-256，并验证历史所有节点可以重建。
- 篡改备份 payload 后完整校验与恢复准备均失败，live workspace 与 restore plan 均不变化。
- 完整恢复测试先创建 current safety backup，再在下次 `FileWorkspace::new` 前切换 stage；原始
  修改后 workspace 作为唯一 previous 目录保留，恢复后的 Markdown、附件、identity 和版本一致。
- 故障测试在“live root 已改名、stage 尚未激活”处模拟进程中断；下一次启动按外部 plan 完成
  恢复。plan 根名/目录名不匹配时失败关闭，不使用清单中的路径逃逸固定父目录。
- Windows 原生 UI：6 节点生成 2 候选/540 B 预览，检查点受保护；执行后保留 4 节点，最终清空
  验收历史且 Markdown 不变。真实完整备份覆盖 8 文件/46.1 KB，再次完整校验通过。
- 1280×800 与 390×844 版本/备份界面均无页面级水平溢出；窄屏只在版本统计条内保留受控横向
  滚动。恢复按钮的明确确认被取消后没有生成 pending plan。
- Windows 原生命令面板只在 Tauri 能力存在时展示工作区备份、索引重建、路径复制和 Markdown
  重命名；`Ctrl+P`、`Ctrl+Shift+P`、节点右键方向键/Esc 与焦点恢复通过。该轮只读验收未创建
  版本、备份或修改 Markdown，1280×800 无页面级溢出且无 console error/warning。

## 共享 Markdown AST 与安全阅读证据

- AST 单元覆盖 YAML frontmatter、GFM 任务/深层列表/表格、脚注、代码 metadata、Wiki Link/
  嵌入、Callout、行内/块数学、原始 source 保留和结构化纯文本。
- H1 命名单元覆盖 frontmatter、fenced code 中的伪标题、ATX/Setext H1 和链接显示名。
- 安全渲染单元确认 `javascript:` 不生成 href、远程图片不生成 src、原始 HTML 被转义且提示
  未执行；未知 fence metadata 原样保留。
- 真实浏览器复杂文档完整显示 40 行/658 字符，没有脚本、事件属性、iframe 或活动图片；
  code/LaTeX/Markdown 原文/结构化阅读文本四类剪贴板结果均核对。
- 1280×720 与 390×844 的 document/article 水平溢出均为 0；表格/长原始 HTML 只在自己的
  容器滚动，窄屏右键菜单边界为 138–386 px，完整位于 390 px 视口内。
- Windows 原生 welcome Markdown 只读验收确认 H1、4 个正文段落、任务列表、两类复制命令和
  能力矩阵；未修改 Markdown、版本或备份，原生进程与 9335 调试端口均关闭。
- Live Preview 单元覆盖数学、图片安全占位、脚注、闭合/未闭合 fence、未知/截断指令块、
  转义美元、货币、超限公式、composition 和四处多光标同时揭示，均核对 source 未改变。
- missing Wiki 创建集成测试覆盖安全标题/path 提案、可选 heading、确认时重验证、目的地
  已存在不覆盖和创建后稳定身份/索引可见；Tauri 命令覆盖完整提案到真实临时目录发布。
- 附件测试覆盖来源相对路径、Wiki 根/`attachments` 候选、歧义、missing、远程/活动 scheme、
  根外逃逸、`.zhiweave`、符号链接、扩展名与签名不符、GIF/SVG/动画 WebP、8 MiB/尺寸/像素
  上限及 PNG/JPEG/静态 WebP 成功读取；前端覆盖惰性 resolver、失败占位和附件右键矩阵。
- 实际浏览器在默认桌面与 900×650 视口确认编辑/阅读附件占位、对象相关右键和无布局溢出；
  期间捕获并修复 `Block decorations may not be specified via plugins` 与跨换行 replace
  Decoration 白屏，新增任何插件 widget/replace 范围不得跨换行的回归断言。
- Windows 自动性能门覆盖 2 MiB 窄视口（约 322 ms）和 10,000 行 fence 可见行上限
  （约 9 ms、最多 24 行装饰）。

尚未完成的 Markdown 测试：CommonMark 官方全集快照、round-trip 属性/模糊测试、局部输入
P95/滚动与内存基准、真实 IME + Live Preview Decoration、附件导入/引用写入事务、局部图谱、
Mermaid 和导出。

尚未完成：稳定 Windows 磁盘满/只读目录故障注入、Tauri IPC 自动 E2E、watcher 高频压力/休眠恢复、
占位/安全移动强杀恢复、长读事务、10,000 文件性能基准、100,000 条索引查询基准和 Android
文件系统验证。

## 故障注入矩阵

磁盘满、目录只读、目标外部修改、SQLite 损坏、写入中断、网络断开、重复请求、对象篡改、同步冲突和旧版本迁移。每个缺陷先建立最小失败测试，再修复并检查相邻路径。

## 合并门

相关测试、`git diff --check`、类型/格式/Clippy、生产构建、真实浏览器操作、截图与 CI 必须通过。不能运行的检查必须记录原因、替代证据、剩余风险和所需环境。
