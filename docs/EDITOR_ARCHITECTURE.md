# 编辑器架构

最近更新：2026-07-30

## 决策

Markdown 主编辑器采用 CodeMirror 6 + Lezer。Tree-sitter WASM 不进入主 Markdown 输入链；仅在缺少 Lezer grammar 的代码语言中作为 Worker 候选，并需通过包体积、首次加载、缓存、内存和输入 P95 基准。

## 当前实现审计

`MarkdownEditor.tsx` 创建长生命周期 `EditorView`，启用 `basicSetup`、`@codemirror/lang-markdown`、
自动换行和 update listener，并通过 transaction 同步外部恢复值。输入侧现有
`markdownLezerExtensions.ts` 为 YAML frontmatter 与 Wiki Link/嵌入提供增量节点；
`markdownLivePreview.ts` 以带 generation 的 StateField 记录 composition、以 ViewPlugin 持有
DecorationSet，只扫描可见行并让所有选区决定源码揭示。`compositionend` 后保留 60 ms
稳定窗口；期间发生的新 composition 会使旧释放任务失效，避免 WebView2 尚未提交候选文本时
重新挂载替换装饰。标题、强调、删除线、链接、Wiki、行内代码、任务与
Callout 之外，数学、图片安全占位、脚注和闭合代码围栏也已接入；未知指令块与未闭合结构不
替换。任务切换仍通过普通 transaction 进入撤销历史，不直接改 DOM 或源码；KaTeX 只在可见
公式出现时动态加载，`trust=false`。
阅读侧已有
`markdownAst.ts`：使用 micromark/mdast 解析 CommonMark、GFM、YAML frontmatter、脚注和数学，
再提升 Wiki Link、嵌入和 Callout 为 ZhiWeave 扩展节点。`MarkdownPreview.tsx`、大纲/标题
适配器和结构化复制开始共享这层语义；原始 source 始终与 AST 并存，未知节点按 source 范围
安全降级。`DocumentOutline.tsx` 使用 mdast position 导航编辑器或阅读标题，不自行解析标题。

编辑器仍尚未：

- 暴露完整保存、选区、视口或 composition telemetry；
- 配置主题、国际化、可访问性或移动输入策略；
- 动态解析 fenced code language；
- 覆盖物理 Windows 中文候选窗、Android 软键盘和完整恢复自动化；Windows WebView2 的
  composition 生命周期、延迟恢复和多光标输入/单步撤销已有原生自动证据。

## 目标模块

```text
EditorHost
├─ EditorState factory
├─ Command registry
├─ Markdown language + extensions
├─ Live preview StateField/ViewPlugin
├─ Fenced-code language resolver
├─ Save coordinator port
├─ Selection/viewport telemetry
└─ Error boundary
```

React 只持有编辑器宿主和跨组件状态，不在每次按键重建编辑器。文档内容、选区、undo history、语法树和装饰均以 CodeMirror transaction 为一致性边界。

阅读 AST 不进入普通编辑首屏，也不在每次按键同步解析：预览、分栏和结构化复制通过动态
import 加载。CodeMirror/Lezer 继续负责输入期增量语法；mdast 是跨阅读、复制、大纲、链接和
后续导出的语义边界。当前适配层共享 Wiki 长度和 Callout 名称/标题契约，并以源码 offset
连接大纲；其余节点仍须逐项经过 Corpus，不能让两棵树分别发明 Markdown 语义。

## 工作台命令边界

`commandRegistry.ts` 已成为工作台操作的单一描述源：稳定 command id、分类、关键词、快捷键、
运行环境能力、上下文可见性与启用条件都由类型约束。React 按钮、菜单和命令面板只提交 command
id，由 `App` 的执行器连接现有工作流；编辑器撤销、重做、剪贴板仍委托给 CodeMirror command，
不会复制其历史状态。当前已加入“复制 Markdown 原文”和“复制结构化阅读文本”：前者逐字符
复制 note buffer，后者通过共享 AST 生成标题、任务层级、表格制表符、代码、公式和脚注文本。
`tabModel.ts` 独立维护打开、关闭和唯一临时预览 ID：预览替换不产生伪关闭历史，显式打开和
编辑把当前预览固定，外部快照刷新只按仍有效的稳定节点 ID 协调或恢复标签，不进入 Markdown、
SQLite 或版本历史。切换已有标签只改变活动节点，不暗中改变固定状态。
`workbenchPreferences.ts` 只序列化有界稳定 ID 和 UI 枚举；原生启动必须先取得 Rust Markdown
快照再协调标签，快照 ready 前不允许占位会话写回。损坏/未来 schema 回到安全默认，v1
显示开关只读迁移。该模块不得接收 note markdown、CodeMirror state、revision、路径或附件。
局部图谱也使用同一命令边界：面板背景是 `graph` scope，SVG 节点是带稳定 ID 的
`note-item` scope；事件目标允许 HTMLElement/SVGElement，避免右键落在 `<g>/<rect>/<text>`
时错误回退成工作区菜单。图谱、大纲和反向链接共享互斥检查器槽位，但各自保持独立按需模块。
下一步把保存协调与 Live Preview 下沉到独立模块时，保持这些 command id 稳定，并让执行器
依赖端口而不是组件内部细节。

## Live Preview

1. [已落地] 从 Lezer 语法树计算候选语法范围。
2. [已落地] 根据 composition 和全部选区决定哪些范围揭示源码。
3. [已落地] 使用 StateField + ViewPlugin 保存 composition 与 decoration set。
4. [已落地] 只对 `visibleRanges` 覆盖的完整行生成 widget。
5. [已落地] 任务交互走 transaction；禁止直接改 CodeMirror 文档 DOM。
6. [已落地] 数学按需安全渲染，图片不主动请求资源，脚注与闭合 fence 使用可点击回源码的
   widget；任一选区进入结构时不替换。
7. [持续约束] 未知/截断指令块、未闭合数学或 fence 不替换、不重写；远程图片不自动加载。

## React/Rust 保存边界

```text
CodeMirror transaction
→ 当前文档缓冲与 dirty revision
→ 防抖或显式保存
→ Rust save_note(expected_revision, content)
→ 同目录临时文件 + flush/fsync + 原子替换
→ SQLite 增量索引事务
→ 保存结果与新 revision
→ 状态栏
```

浏览器预览适配器只能使用内存或隔离测试存储；生产路径只通过明确的 Tauri port 调用 Rust，禁止自动回退到 Mock。

## 强制测试

中文/英文 composition、撤销重做、选区与多光标、外部 value 更新、语法范围边界、未知语法保真、2 MB 文档、10,000 行代码块、切换主题不丢状态、Android 软键盘与后台恢复。
