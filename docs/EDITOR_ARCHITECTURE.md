# 编辑器架构

最近更新：2026-07-30

## 决策

Markdown 主编辑器采用 CodeMirror 6 + Lezer。Tree-sitter WASM 不进入主 Markdown 输入链；仅在缺少 Lezer grammar 的代码语言中作为 Worker 候选，并需通过包体积、首次加载、缓存、内存和输入 P95 基准。

## 当前实现审计

`MarkdownEditor.tsx` 只创建 `EditorView`，启用 `basicSetup`、`@codemirror/lang-markdown`、自动换行和 update listener。它尚未：

- 把外部 value 变更映射为 transaction；
- 暴露保存、选区、视口或 composition 状态；
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
