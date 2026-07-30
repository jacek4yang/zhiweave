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

当前纵切已经实现 source-preserving mdast 语义层，并让安全阅读视图、结构化复制、H1/
Setext H1 标题识别和可交互大纲使用明确适配器。CodeMirror 的 Lezer 树负责输入期增量解析，
新增 frontmatter、Wiki Link/嵌入、数学、脚注和保真指令块节点。Live Preview Decoration
现覆盖标题、强调、链接、Wiki、行内代码、任务、Callout、数学、图片安全占位、脚注和闭合
代码围栏；Wiki、公式与脚注长度以及 Callout 名称映射由小型共享契约约束。原生反向链接已由
共享 Rust Markdown 扫描器产生可重建关系边，真实附件目标、版本差异和导出尚未全部接入同一
范围契约。

## Wiki 关系与反向链接

- 支持 `[[target]]`、`[[target|alias]]` 与 `![[target]]`；索引只读取，不改写原始 Markdown。
- YAML frontmatter、fenced/indented code、跨行 inline code、HTML comment、转义标记、嵌套/
  截断语法及超过 500 Unicode scalar 的 target/alias 不生成关系。
- 每个引用记录 link/embed、原始 target、来源稳定 ID、UTF-8 字节范围、Unicode 行列和最多
  240 字符的单行上下文；WebView 定位前显式把 UTF-8 字节位置转换为 CodeMirror 使用的
  UTF-16 offset。
- 解析目标时先匹配完整 portable Markdown path（可省略 `.md`），再匹配唯一 H1 或文件名
  stem；带目录的引用不得回退为标题。`[[#heading]]` 只指向当前稳定节点。
- 大小写折叠后的多个 path、H1 或 stem 候选一律标记为 ambiguous，不猜测其中一个。缺失目标
  保持 missing；后续创建、重命名、删除或全量快照会重新解析。
- `wiki_edge` 是 SQLite schema v2 的派生表。删除或显式重建索引后必须从 Markdown 与
  identity 得到相同已解析关系；正文不进入只能由关系表恢复的状态。

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

当前安全阅读器的执行规则：

| 语法 | 当前行为 |
| --- | --- |
| 标题、段落、强调、删除线、任务/嵌套列表、引用、表格、脚注 | 语义 HTML 渲染 |
| YAML frontmatter | 默认折叠的只读源码面板 |
| Wiki Link / 嵌入 / 图片 | 阅读视图显示安全占位；原生索引解析 Wiki 目标和反向链接，但尚不主动加载附件资源 |
| 普通链接 | 仅 `http`、`https`、`mailto` 可点击，并使用新窗口与 `noopener noreferrer` |
| fenced code | 显示语言、title、高亮行元数据和精确源码复制；不执行 |
| 行内/块数学 | 按需加载 KaTeX，`trust=false`；可复制块公式源码 |
| 原始 HTML | 作为转义后的不可信源码显示，事件、脚本、iframe 和图片均不进入 DOM |
| `zhiweave-lab` | 仅已登记、严格校验的声明式内置实验可以运行 |
| 未知节点/解析异常 | 按原始 source 范围或整篇 source 转义降级，不吞内容 |

## Corpus

Corpus 至少覆盖 CommonMark 官方示例、GFM、深层列表、表格、脚注、frontmatter、Wiki Link、混合中英文、Emoji、RTL、大代码块、错误 fence、恶意 HTML/SVG/URL 和截断输入。

每个解析器变更运行：

1. parse 不崩溃；
2. AST snapshot；
3. 未编辑原文 round-trip；
4. 安全渲染断言；
5. 大输入与模糊测试。

## 当前差距

逐行正则阅读器已移除，但统一管线仍在分批完成：

- Live Preview 已覆盖数学、图片安全占位、脚注和闭合 fence；光标进入任一结构时恢复完整源码，
  composition 期间停止结构替换，未知/截断指令块与未闭合公式/围栏保持原文；
- 阅读视图中的 Wiki/附件仍是安全占位；稳定 ID 反向链接已接入，正向打开、附件解析与局部图谱
  尚未完成；
- Mermaid、Graphviz、导出、版本语义 diff 和 Corpus snapshot/fuzz 尚未完成；
- 远程图片默认不加载；后续必须经过工作区资源策略与隐私提示，不能直接恢复任意 `src`；
- 数学和解析器已按需分包，但 KaTeX 字体资产与首屏主包仍需优化。
