# 编辑器架构

最近更新：2026-07-30

## 决策

Markdown 主编辑器采用 CodeMirror 6 + Lezer。Tree-sitter WASM 不进入主 Markdown 输入链；仅在缺少 Lezer grammar 的代码语言中作为 Worker 候选，并需通过包体积、首次加载、缓存、内存和输入 P95 基准。

## 当前实现审计

`MarkdownEditor.tsx` 创建长生命周期 `EditorView`，启用 `basicSetup`、`@codemirror/lang-markdown`、
自动换行和 update listener，并通过 transaction 同步外部恢复值。阅读侧已新增
`markdownAst.ts`：使用 micromark/mdast 解析 CommonMark、GFM、YAML frontmatter、脚注和数学，
再提升 Wiki Link、嵌入和 Callout 为 ZhiWeave 扩展节点。`MarkdownPreview.tsx`、大纲/标题
适配器和结构化复制开始共享这层语义；原始 source 始终与 AST 并存，未知节点按 source 范围
安全降级。

编辑器仍尚未：

- 暴露完整保存、选区、视口或 composition telemetry；
- 配置主题、国际化、可访问性或移动输入策略；
- 使用 StateField/ViewPlugin/Decoration 实现 Live Preview；
- 动态解析 fenced code language；
- 覆盖大文件、IME、多光标和恢复测试。

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
后续导出的语义边界。后续 Live Preview 必须建立经过测试的节点/范围适配层，不能让两棵树
分别发明 Markdown 语义。

## 工作台命令边界

`commandRegistry.ts` 已成为工作台操作的单一描述源：稳定 command id、分类、关键词、快捷键、
运行环境能力、上下文可见性与启用条件都由类型约束。React 按钮、菜单和命令面板只提交 command
id，由 `App` 的执行器连接现有工作流；编辑器撤销、重做、剪贴板仍委托给 CodeMirror command，
不会复制其历史状态。当前已加入“复制 Markdown 原文”和“复制结构化阅读文本”：前者逐字符
复制 note buffer，后者通过共享 AST 生成标题、任务层级、表格制表符、代码、公式和脚注文本。
下一步把保存协调与 Live Preview 下沉到独立模块时，保持这些 command id 稳定，并让执行器
依赖端口而不是组件内部细节。

## Live Preview

1. 从 Lezer 语法树计算候选语法范围。
2. 根据主选区、composition 和多选区决定哪些范围揭示源码。
3. 使用 StateField 保存可映射 decoration set。
4. 只对 `visibleRanges` 及小幅缓冲生成昂贵 widget。
5. transaction 映射装饰，禁止直接改 CodeMirror DOM。
6. 未知节点不替换、不重写。

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
