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
现覆盖标题、强调、链接、Wiki、行内代码、任务、Callout、数学、安全本地图片、脚注和闭合
代码围栏；Wiki、公式与脚注长度以及 Callout 名称映射由小型共享契约约束。原生双向 Wiki
导航复用 Rust 权威 resolver 与可重建关系边，受限静态附件复用来源身份，版本差异和导出尚未全部接入同一
范围契约。

## Wiki 关系、正向打开与反向链接

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
- 正向打开只向 Rust 传入稳定来源 ID 与 authored target；返回 `resolved/missing/ambiguous`、
  稳定目标身份及可选 heading fragment。前端不得另写正则、目录距离或“最接近标题”规则。
- 原生阅读视图单击 Wiki Link/嵌入占位可打开目标；Live Preview 使用 VS Code 风格
  `Ctrl/Cmd+单击`，普通单击仍保留光标编辑。heading 通过共享 mdast 大纲 offset 定位。
- ambiguous 提示改用完整 Markdown path，不跳到猜测节点。missing 只在用户明确选择创建后
  显示 Rust 给出的标题、路径与可选 heading 提案；确认时后端重解析且只允许非覆盖创建。
  Wiki 元素右键只显示“解析并打开目标”和“复制目标文本”等对象命令。
- `wiki_edge` 是 SQLite schema v2 的派生表。删除或显式重建索引后必须从 Markdown 与
  identity 得到相同已解析关系；正文不进入只能由关系表恢复的状态。

## 本地附件

- `![alt](relative/path.png)` 从当前 Markdown 所在目录解析；绝对路径、根外逃逸、远程 URL、
  活动 scheme、查询/fragment 和隐藏 `.zhiweave` 元数据不可读取。
- `![[name.ext]]` 作为附件时依次形成来源目录、`attachments/` 与工作区根候选；恰好一个
  既有候选才可读取，多个候选返回 ambiguous。带目录的嵌入按显式工作区 portable path 解析。
- 不具有受支持附件扩展名的普通 `![[target]]` 继续作为 Wiki 节点嵌入解析；显式
  `![[attachments/name]]` 始终是惰性附件，便于保存未知格式而不执行。
- 当前活动预览只允许签名与扩展名一致的 PNG、JPEG 和静态 WebP，最大 8 MiB、单边 16,384
  像素、总像素 40,000,000。GIF、SVG、动画 WebP、PDF、音视频与未知格式显示 inert placeholder。
- Rust 返回经过验证的字节、MIME、尺寸、portable path 和 SHA-256；WebView 不自行打开路径。
  阅读视图与 Live Preview 惰性请求，失败状态可见且不吞原始 target。
- 浏览器演示没有本地文件 capability，只显示安全占位；不得以 `localStorage`、mock URL 或
  前端路径拼接冒充原生附件。
- “导入附件到光标”只在原生可编辑上下文出现。Rust 系统选择器先读取但不写入，确认框展示
  原文件名、portable 目标、大小、完整 SHA-256、显示方式和精确引用；单文件上限 64 MiB。
- 确认后 Rust 重新生成提案，以 `create_new`、同步和回读校验保存原始字节，不覆盖同名文件。
  CodeMirror 再用一次 transaction 插入完整引用；`Ctrl+Z` 撤销引用，但不删除已经保存的附件。
- 安全静态图片生成相对来源的 `![alt](path)`；其他格式生成
  `![[attachments/name.ext]]`，继续以 inert placeholder 降级。

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
| Wiki Link / 嵌入 | 原生阅读视图经 Rust resolver 打开既有节点/heading；missing 可明确确认非覆盖创建；浏览器保持无原生跳转占位 |
| 图片 / 附件 | 原生模式惰性加载经 Rust 复核的 PNG/JPEG/静态 WebP；其他格式、失败或浏览器模式显示带原因的 inert placeholder |
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

- Live Preview 已覆盖数学、安全本地图片/占位、脚注和闭合 fence；光标进入任一结构时恢复完整源码，
  composition 期间停止结构替换，未知/截断指令块与未闭合公式/围栏保持原文；
- Wiki 正向打开、稳定 ID 反向链接、missing 显式新建、受限静态附件解析以及受控附件导入/
  可撤销引用事务已接入；局部图谱尚未完成；
- Mermaid、Graphviz、导出、版本语义 diff 和 Corpus snapshot/fuzz 尚未完成；
- 远程图片默认不加载；后续必须经过工作区资源策略与隐私提示，不能直接恢复任意 `src`；
- 数学和解析器已按需分包，但 KaTeX 字体资产与首屏主包仍需优化。
