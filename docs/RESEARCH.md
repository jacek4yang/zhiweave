# 研究记录

最近更新：2026-07-30

本文件只记录官方文档、标准、源码或原始研究。结论用于 ZhiWeave 的自主设计，不复制第三方专有代码、主题、图标或品牌。

## CodeMirror 6

来源：

- [CodeMirror System Guide](https://codemirror.net/docs/guide/)
- [CodeMirror Reference Manual](https://codemirror.net/docs/ref/)
- [CodeMirror language package example](https://codemirror.net/examples/lang-package/)

结论与证据：

- CodeMirror 用不可变 `EditorState` 和 transaction 统一文档、选区与扩展状态。
- `EditorView` 只渲染视口及其邻近区域，并暴露 `visibleRanges`，适合大文档。
- Decoration、StateField、Facet 和 ViewPlugin 能承载 Live Preview，而不改写 Markdown 原文。
- 编辑器语言包应提供增量 parser，并将高亮、缩进、折叠和补全作为可组合扩展。

限制：CodeMirror 不提供完整产品级 Markdown Live Preview；光标揭示、IME、移动输入和原文保真仍需项目级设计与回归测试。

设计影响：保留 CodeMirror 6；禁止把它继续当普通 textarea；所有视觉替换通过 transaction/decoration 实现。

## Lezer

来源：

- [Lezer System Guide](https://lezer.codemirror.net/docs/guide/)
- [Lezer Reference Manual](https://lezer.codemirror.net/docs/ref/)

结论与证据：

- Lezer 面向编辑器，语法树紧凑、可增量复用并内置错误恢复。
- `TreeFragment` 能映射变更并复用未修改子树。
- `parseMixed` 支持嵌套语言，适合 Markdown fenced code。

限制：很小的语义变化仍可能使后续大区域失去复用；外部 token lookahead 会影响增量正确性。

设计影响：Markdown 主树优先 Lezer。缺失语言才评估 Worker 中的 Tree-sitter WASM，且必须经过包体积与输入延迟基准。

## Markdown 标准

来源：

- [CommonMark 0.31.2](https://spec.commonmark.org/0.31.2/)
- [GitHub Flavored Markdown Spec](https://github.github.com/gfm/)

结论：统一解析管线以 CommonMark 为基线，增加 GFM 表格、删除线、任务列表和自动链接，再叠加 ZhiWeave 扩展。未知语法必须原样保存。标准示例直接进入 corpus 测试，不能用手写逐行正则替代。

## 专业工作台

来源：

- [Visual Studio Code user interface](https://code.visualstudio.com/docs/editing/userinterface)
- [Visual Studio Code custom layout](https://code.visualstudio.com/docs/configure/custom-layout)

结论：Activity Bar、主/次侧栏、状态栏、面板、标签、预览标签、分屏和命令面板构成成熟工作台的稳定心智模型。ZhiWeave 采用这些信息架构原则，但不复制视觉设计；编辑器始终拥有最高视觉优先级。

## Tauri 权限边界

来源：

- [Tauri capabilities](https://v2.tauri.app/security/capabilities/)

结论：capability 必须按窗口和平台最小授权。前端被攻破时 capability 只能限制暴露面，不能弥补不安全的 Rust 命令、过宽 scope 或实现错误。生产命令需要显式命令清单与路径校验。

## SQLite

来源：

- [SQLite WAL](https://www.sqlite.org/wal.html)
- [SQLite FTS5](https://www.sqlite.org/fts5.html)

结论：WAL 允许读写并行但同一时刻仍只有一个 writer，依赖同机共享内存，因此数据库不得位于网络文件系统。需要 checkpoint 策略与长读事务监控。FTS5 只作为可重建派生索引。

## 声明式交互实验与 UUID

来源：

- [RFC 9562: Universally Unique IDentifiers](https://www.rfc-editor.org/rfc/rfc9562.html)
- [Web Cryptography Level 2](https://www.w3.org/TR/webcrypto-2/)
- [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12)
- [CommonMark fenced code blocks](https://spec.commonmark.org/0.31.2/#fenced-code-blocks)

结论：

- UUID 是 128 位值；版本字段位于 48–51，RFC 9562 变体的高位模式为 `10xx`。
- UUID v4 的版本/变体共固定 6 位，其余 122 位来自随机或伪随机源。
- UUID v7 的前 48 位是大端 Unix 毫秒时间戳，适合演示时间有序特性。
- Web Crypto `randomUUID()` 生成 version 4 UUID；兼容实现可用 `getRandomValues()` 后显式设置版本/变体位。
- CommonMark info string 能让普通阅读器保留原始声明，同时让知织识别精确的 `zhiweave-lab` 扩展。
- 每个交互块先按 JSON Schema 对应的白名单校验，再进入内置组件；不能把 AI 输出或 Markdown 当作受信任代码。

## Neovim 语义配色

只读检查服务器 `~/.config/nvim` 后确认其使用 TokyoNight Moon 与按语法角色分配颜色的逻辑。知织采用“背景/正文/弱化/标题/关键字/字符串/数字/注释/错误”等角色映射，并重新实现 CSS token 与 CodeMirror HighlightStyle；没有复制插件源代码、品牌或配置文件。

## 原子文件与内容修订

来源：

- [`atomic-write-file` 0.3.0 文档](https://docs.rs/atomic-write-file/0.3.0/atomic_write_file/)
- [RustCrypto `sha2` 0.10.9 文档](https://docs.rs/sha2/0.10.9/sha2/)
- [Rust `std::fs::canonicalize`](https://doc.rust-lang.org/std/fs/fn.canonicalize.html)

结论：

- 原子覆盖必须让临时文件与目标位于同一目录，完成写入和同步后再 commit；未 commit 的 writer 被销毁时旧目标保持可读。
- `atomic-write-file` 同时实现 Windows 与 Unix 替换语义，但不提供“目标从未存在”的通用 `create_new` 原子承诺；知织的新建先用系统 `create_new` 预留空目标，再以已准备好的临时文件替换，并把强杀留下空占位记录为待恢复风险。
- expected revision 对包含 BOM 和原始换行的精确字节做 SHA-256，而不是对 UI 规范化文本做哈希，避免不同落盘表示被误判为同一版本。
- canonicalize 只是一层边界检查；仍需逐段 `symlink_metadata` 和 portable path 验证。检查与使用之间的 TOCTOU 不能靠单次 canonicalize 消除。

## 后续研究队列

- Typora 的光标揭示与移动输入边界。
- Obsidian/Logseq/Joplin 的文件监控与冲突表达。
- Anki/FSRS 的调度状态迁移与可追溯历史。
- JSON Canvas、集合开放格式和跨工具回退。
- Tree-sitter WASM 的按需加载、缓存和内存基准。
