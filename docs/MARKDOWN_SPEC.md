# Markdown 规格

最近更新：2026-07-30

## 兼容基线

1. CommonMark 0.31.2。
2. GFM 表格、删除线、任务列表和自动链接。
3. ZhiWeave 扩展：Wiki Link、嵌入、Frontmatter、Callout、数学、Mermaid、附件引用和可扩展 fence 元数据。

Markdown 源文本始终可独立读取。扩展不得要求二进制正文或只能由 SQLite 解释的隐藏内容。

## 统一管线

```text
UTF-8 Markdown source
→ 标准 Markdown AST
→ ZhiWeave extension AST
→ 编辑器 decorations
→ 安全阅读视图
→ 大纲/搜索/反向链接/导出/Prompt/复习候选
```

编辑器和阅读器必须共享语义，不允许继续维护独立的手写逐行正则预览器。

## 往返规则

- 未编辑字节不因打开、预览或索引而改变。
- 保留换行风格的策略必须显式；保存前统一到用户或工作区设置。
- 未知 frontmatter 键、fence info、HTML 和扩展节点原样保存。
- Wiki Link 解析不能擅自重写显示文本或路径。
- 解析错误生成可定位诊断，但不阻断继续编辑和保存原文。

## 安全渲染

- 原始 HTML 默认禁用；启用时只允许严格白名单并清洗 URL。
- `javascript:`、危险 `data:`、远程脚本和事件属性一律禁止。
- SVG、Mermaid、Graphviz 和附件都是不可信输入。
- 外部链接显示最终目标，使用安全 opener 策略。
- 普通代码块永远是文本，不自动执行。
- `zhiweave-lab` fence 只允许版本化声明式 JSON，并由内置组件注册表解释；详见 [Markdown 内嵌交互实验](./EMBEDDED_LABS.md)。
- 未知、超限或校验失败的交互块必须显示原始 fenced block，不得猜测或下载执行器。

## Corpus

Corpus 至少覆盖 CommonMark 官方示例、GFM、深层列表、表格、脚注、frontmatter、Wiki Link、混合中英文、Emoji、RTL、大代码块、错误 fence、恶意 HTML/SVG/URL 和截断输入。

每个解析器变更运行：

1. parse 不崩溃；
2. AST snapshot；
3. 未编辑原文 round-trip；
4. 安全渲染断言；
5. 大输入与模糊测试。

## 当前差距

`MarkdownPreview.tsx` 仍使用逐行解析，只覆盖少量标题、列表、引用、任务、代码块和三类行内语法，必须在阶段 3 替换为统一 AST 管线。2026-07-30 已先修复 fence info string 的保留，并完成严格隔离的 `zhiweave-lab` 垂直切片；这不等于通用 Markdown 管线已经完成。
