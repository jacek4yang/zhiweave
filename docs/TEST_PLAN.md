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
- `pnpm test`：通过，17 files / 101 tests；除原有版本/分支、日记/H1、持久版本 DTO、种子、
  交互实验和保存状态用例外，新增 command id/快捷键唯一性、IME 防误触、上下文矩阵、原生能力
  隔离、禁用条件、中文/别名检索、共享 Markdown AST/安全渲染，以及 Lezer frontmatter/Wiki、
  光标揭示、composition 停用、任务/Callout、数学/图片/脚注/fence、多光标、大输入和源码
  不变回归测试；另覆盖反向链接面板/来源节点上下文隔离、Wiki 正向解析/阅读按钮/编辑器
  `Ctrl/Cmd+单击`、heading offset、UTF-8 字节位置到 UTF-16 CodeMirror offset 的 Unicode
  转换，以及图谱背景/具体 SVG 节点的上下文隔离与 79 邻居（80 总节点）确定布局。新增标签
  会话覆盖唯一预览槽替换、固定、转为预览、显式关闭/重开、关闭其他、无效 ID 协调和 recovery
  ID 重映射；command matrix 断言固定/转预览命令互斥。工作台偏好新增 9 项用例，覆盖 v1
  迁移、v2 round-trip、损坏/未来 schema、安全默认、ID 去重/控制字符/数量上限、失效 ID
  回退、活动标签确保打开、明确空标签会话和仅序列化 UI 字段。工作台偏好现为 v3，并覆盖
  v2 精确迁移、损坏/未来 v3 失败关闭、面板宽度归一化和只序列化 UI 字段；面板布局新增 4 项
  回归，覆盖非有限值/边界/舍入、左右指针方向、普通/Shift 键步长及 Home/End/Enter。快捷键
  新增 12 项回归，覆盖
  一/二段 chord、modifier 重复按下、完全/前缀冲突、确认替换解绑、单项/全部恢复、损坏设置
  失败关闭、IME 防误触，以及命令面板/右键/提示/实际分发共享同一有效绑定。外观模型新增
  4 项回归，覆盖文档默认值、v1 round-trip、损坏/未来 schema 失败关闭、字段独立归一化和
  仅序列化 schema/theme/density；命令矩阵再覆盖外观面板、状态栏、Activity Bar 与中文检索。
- `pnpm build`：最终差异通过，主 chunk 有 >500 KB 警告。
- `pnpm audit --audit-level high`：先使用用户指定 SOCKS5 代理，50 秒无响应后安全中止；
  临时直连回退通过，无已知漏洞。代理地址不写入仓库。
- `pnpm tauri build`：在当前 Windows 电脑通过，生成 6,156,288 B MSI 与 4,647,873 B NSIS；
  SHA-256 分别为 `AAD7C976D2A3BEDA1C97BB919AFDFD1DF52F8A8B3FA1F214B48683188E505E7E`
  和 `A3C55E1E4D70A85D76379B0A1631AECFFEAF77722BC2797513826F68C6005D99`。
- 浏览器：搜索、阅读/编辑、分栏、标签、刷新恢复、复制保真、上下文菜单分流、输入粘贴、编辑撤销、UUID 生成/校验/提示词通过；单击节点生成临时预览、双击/编辑固定，固定和临时标签的
  右键菜单只出现相反状态动作；命令面板中文筛选、方向键、Enter、Esc、焦点恢复和
  390×844/1280×800 布局通过。
- 本轮 Wiki 正向导航浏览器自动化因应用内浏览器本地导航与 DOM 读取连续超时尚未通过，不得用
  原生截图替代；Windows 原生 IPC、WebView2 DOM 检查、DWM 截图与临时目录/Tauri 集成测试是
  明确区分的替代证据。
- 视口：1280×720、1366×768、1440×900、1920×1080、2560×1440、320×720、390×844、412×915、915×412 均无水平溢出。
- 标签增量检查在 390×844 返回 `scrollWidth === innerWidth === 390`；两个标签宽度为
  153/123 px。≤480 px 检查器与正文表面同宽（342 px），关闭后正文仍为 342 px，没有留下
  看似裁切的正文窄条。
- 工作台会话浏览器验收：保存两个标签及唯一 preview、活动节点、split、大纲和桌面侧栏，
  重载后逐项恢复；390×844 启动不自动打开侧栏且 `scrollWidth === innerWidth === 390`，
  回到 1280×800 后桌面侧栏意图恢复，split/大纲仍存在。最终重载没有新增 console
  error/warning。
- 快捷键浏览器验收：`Ctrl+K Ctrl+S` 打开 41 项编辑器；把分栏录为 `Ctrl+P` 时准确指出快速
  打开冲突，确认替换后快速打开解绑，实际按键进入分栏，命令面板和编辑器右键同步显示新值；
  重载保持覆盖，单项恢复仍处理冲突，全部恢复有二次确认。480×720 下页面与对话框均无水平
  溢出，测试设置已恢复默认。
- 面板浏览器验收：1280×800 默认列为 `48/244/988 px`，正文/检查器为 `718/270 px`；
  Explorer 与 Inspector 的方向键、Shift 加速、Home/End/Enter、双击恢复、命令面板和
  `panel-resizer` 右键菜单均通过。`400/318 px` 跨重载精确恢复且页面无水平溢出；恢复默认后
  1101 px 桌面保留 320 px 正文，1100 px 检查器覆盖，960/720/480 px 按响应式边界隐藏分隔条
  且 `scrollWidth === innerWidth`。最终重载无 console error/warning。
- Windows Tauri WebView2 跨进程验收：welcome pinned + ownership preview、split、大纲和
  隐藏侧栏在首次关闭/重启后恢复；随后版本视图在第二次关闭/重启后恢复。测试态 v2 记录
  366 B、恰含 schema version、活动节点、编辑模式、检查器、实时语法、侧栏、标签会话和版本
  视图 8 个字段，禁用词检查不含正文、路径、revision、附件或根信息。
- 原生会话验收前后 6 篇 Markdown/1004 B 的路径、大小和逐文件 SHA-256 完全一致；
  `.zhiweave/identity.json` 仍为 1171 B，SHA-256 为
  `E9CF4C6438DE888803B85E6123BF27680F830C31338A62679C6CB7EFA00D07E2`。测试 v2 偏好已移除，
  原有 v1 偏好保留；所有 Tauri/Vite/9335 进程和端口均已关闭。
- Windows Tauri WebView2 快捷键验收：录制 `Ctrl+Alt+J` 分栏后，独立设置 JSON 只含
  schema、command id 和按键字段；完整关闭/第二个原生进程启动后 UI 与实际分栏行为均恢复。
  最小化 API 返回 `is_minimized=true`，自定义关闭按钮结束原生/Vite/CDP；权限修复后新日志
  无窗口 permission error。
- Windows Tauri WebView2 面板验收：真实鼠标把主侧栏 `244 → 324 px`、检查器
  `270 → 330 px`，首个进程即时写入 v3；第二个完整进程启动后 DOM/CSS/ARIA 精确恢复。
  首次启动从既有 v2 只读迁移，旧记录不被覆盖；v3 恰含已知 UI 字段且不含 content/path/
  revision/root/attachment。随后双击恢复 `244/270 px` 并关闭检查器。
- 面板原生验收前后固定工作区均为 6 篇 Markdown/1004 B，逐文件 SHA-256 不变；
  `.zhiweave/identity.json` 仍为 1171 B，SHA-256 为
  `E9CF4C6438DE888803B85E6123BF27680F830C31338A62679C6CB7EFA00D07E2`。两个原生进程均由
  自定义关闭按钮结束，Tauri/Vite 无 permission、panic 或 runtime error，1420/9335 无监听。
- 外观浏览器验收：月夜深色、暖纸浅色和高对比三套主题均有独立表面/文字/语法颜色；高对比
  叠层为 2 px 实线边界且无阴影。Comfortable 与 Terminal 的工具栏高度分别为 48/38 px、
  笔记行为 40/28 px、编辑器字号为 16/14 px；切换前后正文、活动标签和滚动位置不变。
  radio 方向键、Esc/焦点恢复、`Ctrl+Shift+P` 中文检索执行通过；外观面板右键恰为 7 个外观
  命令，状态栏右键只增加打开/恢复入口。
- 外观响应式验收：1280×720、1366×768、1440×900、1920×1080、2560×1440、320×720、
  390×844、412×915、915×412 的 `scrollWidth/scrollHeight` 均等于视口；320×720 下编辑/
  预览上下排列，外观面板为 304×527 px，所有选项与恢复按钮完整可见。最终重载为深色/紧凑，
  无 console error/warning 或外部资源请求。
- Windows Tauri WebView2 外观验收：切换到暖纸浅色/舒适时 CodeMirror DOM 实例未重建，
  Markdown、滚动位置和活动标签不变；首个进程写入的独立 v1 JSON 精确为
  `{"schemaVersion":1,"theme":"light","density":"comfortable"}`，第二个完整原生进程启动后
  DOM token、48 px 工具栏、40 px 笔记行和 17 px Live Preview 字号精确恢复。记录字段恰为
  `schemaVersion/theme/density`，不含正文、路径、revision、根、附件、节点或工作区信息。
  验收后恢复深色/紧凑并由自定义按钮退出；前后 6 篇 Markdown/1004 B 的逐文件 SHA-256 及
  1171 B identity 摘要完全一致，1420/9335 和原生进程均已关闭。
- 原生验收曾意外创建精确的 UUID 实验测试文件。只在文件大小与 SHA-256 同时匹配后移出，并
  只删除对应稳定 identity 项；最终复核恢复原有 6 篇 Markdown/1004 B、逐文件 SHA-256 和
  1171 B identity 摘要，隔离文件与快捷键设置均已删除。后续原生写入验收必须使用隔离 profile。
- Rust 1.95.0 的最终差异已通过 fmt、workspace all-target/all-feature Clippy `-D warnings`
  与 workspace all-feature tests。
- GitHub CI run `30509720758` 在 Linux runner 上再次通过 Frontend、fmt、workspace
  all-target/all-feature Clippy `-D warnings` 与 workspace all-feature tests。
- GitHub CI run `30512755304` 对受控原生附件导入提交再次通过 Frontend、fmt、workspace
  all-target/all-feature Clippy `-D warnings` 与 workspace all-feature tests。
- GitHub CI run `30512970355` 对附件验证记录提交再次通过 Frontend、fmt、workspace
  all-target/all-feature Clippy `-D warnings` 与 workspace all-feature tests。
- GitHub CI run `30517970089` 对临时预览/固定标签功能与验证提交通过 Frontend、fmt、
  workspace all-target/all-feature Clippy `-D warnings` 与 workspace all-feature tests。
- GitHub CI run `30520065978` 对工作台会话恢复功能/验证提交 `7955800`/`91f9337` 通过
  Frontend、fmt、workspace all-target/all-feature Clippy `-D warnings` 与 workspace
  all-feature tests。
- GitHub CI run `30524240833` 对快捷键编辑器、标题栏权限修复和验证文档提交
  `2051f85`/`5238a81`/`e9aac5b` 通过 Frontend、fmt、workspace all-target/all-feature
  Clippy `-D warnings` 与 workspace all-feature tests。
- GitHub CI run `30527471482` 对可调面板功能/验证提交 `a9fa6c6`/`962ce3d` 通过 Frontend、
  fmt、workspace all-target/all-feature Clippy `-D warnings` 与 workspace all-feature tests。
- GitHub CI run `30530585925` 对完整外观功能/验证提交 `20e0ede`/`493860d` 通过 Frontend、
  fmt、workspace all-target/all-feature Clippy `-D warnings` 与 workspace all-feature tests。
- GitHub CI run `30514256379` 对输入可靠性提交 `1c3bf82` 再次通过 Frontend、fmt、workspace
  all-target/all-feature Clippy `-D warnings` 与 workspace all-feature tests。
- GitHub CI run `30516132915` 对局部图谱提交 `9faa7bc` 再次通过 Frontend、fmt、workspace
  all-target/all-feature Clippy `-D warnings` 与 workspace all-feature tests。
- `cargo audit --no-fetch --stale`：advisory DB 扫描 475 个 lockfile 依赖，无已知 vulnerability；有 17 个 allowed warning。GTK3/glib 项来自非 Windows 的 Tauri target 依赖（当前 Windows `cargo tree -i glib/atk` 不在目标图），其中 `glib` 有一项 unsound advisory；`urlpattern` 链含 6 个 unmaintained `unic-*`，另有 `proc-macro-error` warning。发布前必须在各目标平台更新 Tauri/传递依赖并以 `-D warnings` 重新评估，不能忽略。

## Markdown 文件纵切证据

- Rust 当前 workspace 75 项测试通过，其中 storage 50 项、domain/portable resource 6 项、
  application 4 项、Markdown 7 项、protocol 1 项、server 1 项和 Tauri 6 项。
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

## 局部知识图谱证据

- storage 临时目录覆盖中心节点、出边/入边、link/embed 聚合次数、邻居按总引用次数排序、
  节点上限截断和零上限结构化拒绝；图谱复用 `wiki_edge`，没有第二套正文解析器。
- application port、Tauri `workspace_local_graph` 与 camelCase TypeScript DTO 已贯通；Tauri
  种子集成测试返回 welcome/ownership 两节点、一条有向 link 边和准确 occurrence count。
- 前端布局测试以完整 79 个邻居核对坐标唯一且位于 640×420 viewBox 内，所有边路径不含 NaN，
  Unicode 标题按 code point 截断。command matrix 明确区分 `graph` 背景和 `note-item` 图节点。
- Windows 原生只读验证显示当前用户既有 welcome/ownership 两节点、一条关系；鼠标单击与
  Enter 均能切换稳定根节点。图谱空白右键标题为当前局部图谱并显示图谱/文档操作；关联 SVG
  节点右键标题为精确节点名，只显示该节点的打开、分栏、复制、重命名和版本操作。
- 1280×800 与 390×844 均无页面级水平溢出；窄屏面板位于 Activity Bar 右侧、关闭按钮完整，
  自适应画布填满剩余高度且图例贴底。浏览器预览的图谱按钮和面板计数均为 0，页面宽度等于
  视口，不冒充原生索引能力。
- 验收前后用户工作区保持 6 个 Markdown、1004 字节，组合 SHA-256 为
  `C69884AD14DA1F3CFAFB520E642C5120320057BEE11FEC51CDCC49F3E4A68517`；identity 文件 1171
  字节，SHA-256 为 `E9CF4C6438DE888803B85E6123BF27680F830C31338A62679C6CB7EFA00D07E2`。
  未保存或注入正文，Tauri/Vite/9335 进程与端口均已关闭。

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
- 输入可靠性回归覆盖 composition generation：旧计时器不能释放更新的组合输入，稳定窗口不少于
  50 ms；状态栏按所有 selection ranges 汇总选区，并报告实际光标数。
- missing Wiki 创建集成测试覆盖安全标题/path 提案、可选 heading、确认时重验证、目的地
  已存在不覆盖和创建后稳定身份/索引可见；Tauri 命令覆盖完整提案到真实临时目录发布。
- 附件测试覆盖来源相对路径、Wiki 根/`attachments` 候选、未知扩展 inert 附件、歧义、
  missing、远程/活动 scheme、
  根外逃逸、`.zhiweave`、符号链接、扩展名与签名不符、GIF/SVG/动画 WebP、8 MiB/尺寸/像素
  上限及 PNG/JPEG/静态 WebP 成功读取；前端覆盖惰性 resolver、失败占位和附件右键矩阵。
- 附件导入 storage 集成测试覆盖确认前零写入、原始二进制逐字节一致、SHA-256、来源相对图片
  引用、通用文件 inert 引用、Windows 保留名、同名 `-2` 分配、确认前来源移动失败关闭和
  外部同名竞态不覆盖。
  Tauri 测试覆盖完整系统路径不进入 proposal、opaque token 一次性、确认后真实文件与二次
  确认失败；Windows 选择结果使用拒绝重解析点的文件句柄并复核已打开句柄元数据。前端覆盖
  命令只在原生编辑器上下文出现，以及引用在一个插入操作中保留已有正文。
- Windows 原生实际打开 Rust 系统文件选择器，选择 46.0 KB PNG 后确认页完整显示原文件名、
  portable 目标、SHA-256、显示策略和引用；1280×800 与 390×844 无页面/对话框水平溢出，
  primary button 获得焦点。只执行取消后，6 篇既有 Markdown 的组合摘要不变且目标附件不存在。
  原生编辑器右键显示导入命令；浏览器工具栏、命令面板和编辑器右键均不显示原生能力。
- 实际浏览器在默认桌面与 900×650 视口确认编辑/阅读附件占位、对象相关右键和无布局溢出；
  期间捕获并修复 `Block decorations may not be specified via plugins` 与跨换行 replace
  Decoration 白屏，新增任何插件 widget/replace 范围不得跨换行的回归断言。
- Windows 自动性能门覆盖 2 MiB 窄视口（约 322 ms）和 10,000 行 fence 可见行上限
  （约 9 ms、最多 24 行装饰）。
- Windows Tauri WebView2 实际验证 `Ctrl+Alt+↑` 产生 2 个光标且状态栏同步显示；单次输入让
  82 字符变为 84，单次 `Ctrl+Z` 精确恢复 82。composition gate 的 Live Preview 装饰数按
  `5 → 0 → 0（结束后 20 ms）→ 5（总计 90 ms）` 变化。
- Windows Tauri WebView2 标签验收：从 pinned welcome 单击“知识库”得到 preview ownership，
  预览右键有“固定”且无“转为预览”；双击后变为 pinned。随后“复习”生成一个 preview，
  “今天”在同一槽位替换它，总标签数保持 3。窗口宽度与 document scrollWidth 都是 1280。
- 标签验收只导航和改变会话状态；前后 6 个 Markdown 均为 1004 B，组合摘要
  `FC7B12872F9C699524187D15EE82F0332216DCCF3159EB2CCC6026A3F9303E75`，1171 B identity
  摘要 `E9CF4C6438DE888803B85E6123BF27680F830C31338A62679C6CB7EFA00D07E2`，均不变。
- 验收前后 6 篇用户 Markdown 的组合 SHA-256 与 identity 摘要逐字节相同；未创建版本、附件或
  笔记，Tauri/Vite/9335 进程和端口均已关闭。物理微软拼音候选窗尝试因用户正在使用前台窗口而
  在发送任何按键前中止，输入布局已恢复英文，因此不得将物理候选窗标记为通过。

尚未完成的 Markdown 测试：CommonMark 官方全集快照、round-trip 属性/模糊测试、局部输入
P95/滚动与内存基准、物理 Windows 中文候选窗与 Android 软键盘、隔离应用数据下附件 picker →
确认 → 编辑器 undo 的完整 UI E2E、全局分片图谱、Mermaid 和导出。

尚未完成：稳定 Windows 磁盘满/只读目录故障注入、Tauri IPC 自动 E2E、watcher 高频压力/休眠恢复、
占位/安全移动强杀恢复、长读事务、10,000 文件性能基准、100,000 条索引查询基准和 Android
文件系统验证。

## 故障注入矩阵

磁盘满、目录只读、目标外部修改、SQLite 损坏、写入中断、网络断开、重复请求、对象篡改、同步冲突和旧版本迁移。每个缺陷先建立最小失败测试，再修复并检查相邻路径。

## 合并门

相关测试、`git diff --check`、类型/格式/Clippy、生产构建、真实浏览器操作、截图与 CI 必须通过。不能运行的检查必须记录原因、替代证据、剩余风险和所需环境。
