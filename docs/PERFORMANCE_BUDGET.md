# 性能预算

最近更新：2026-07-30

## 预算

| 场景 | 初始预算 |
| --- | --- |
| 普通输入延迟 | P95 ≤ 16.7 ms |
| composition 提交 | P95 ≤ 50 ms，零丢字/重复 |
| 冷启动到可编辑 | ≤ 2.0 s（基准设备） |
| 热启动到可编辑 | ≤ 750 ms |
| 打开普通笔记 | P95 ≤ 100 ms |
| 2 MB Markdown 打开 | ≤ 1.5 s，输入 P95 ≤ 33 ms |
| 10,000 笔记搜索首批 | ≤ 150 ms |
| 100,000 笔记搜索首批 | ≤ 500 ms |
| 原子保存普通笔记 | P95 ≤ 100 ms |
| 主线程长任务 | 无 >50 ms 连续输入长任务 |
| 首屏 JS gzip | 目标 ≤ 200 KB |
| 单个按需 grammar gzip | 目标 ≤ 150 KB |

## Windows 当前基线

环境：当前 Windows 电脑，Vite 直接绑定 `127.0.0.1:1420`，Tauri 2 原生开发壳。

- Vitest：9 files / 47 tests，最近一次约 1.18 s。
- Vite production build：最近一次约 753 ms。
- 主 CSS：55.20 KB（gzip 10.32 KB）。
- 主 JavaScript：934.49 KB（gzip 310.59 KB）。
- `EmbeddedLab` 按需 chunk：5.99 KB（gzip 2.46 KB）。
- `MarkdownPreview` 按需 chunk：11.32 KB（gzip 3.98 KB）。
- `markdownAst` 按需 chunk：92.24 KB（gzip 26.02 KB）。
- `DocumentOutline` 按需 chunk：1.16 KB（gzip 0.67 KB）。
- `MathFormula` 包装 chunk：0.47 KB（gzip 0.40 KB）；共享 `mathRenderer`/KaTeX 按需 chunk：
  259.23 KB（gzip 77.61 KB），KaTeX CSS 28.83 KB（gzip 7.92 KB）。
- Vite 仍报告主 chunk 超过 500 KB。

交互实验、Markdown 解析/阅读、大纲和公式都不进入无关首屏；主包 gzip 仍超过目标 110.59 KB。
KaTeX 只在遇到公式时加载，但当前上游 CSS 让构建产物同时包含 WOFF2/WOFF/TTF 变体，增加
安装包体积；后续应验证 WebView2/跨平台字体覆盖后收敛到必要格式。下一步必须用可重复的
chunk 报告定位 CodeMirror、图标、工作台和命令面板边界；语言 grammar、图谱和 Canvas 继续
保持按需加载。

Live Preview 自动性能门在当前 Windows 电脑的单次 Vitest 样本中：

- 2 MiB Markdown 创建 EditorState 并投影 640 字符窄视口约 322 ms，低于 1.5 s 打开预算；
- 10,000 行 fenced code 的前 24 行视口用例约 9 ms，断言最多只生成 24 条代码行装饰；
- 两个用例都逐字符核对 CodeMirror 文档仍等于原始 source。

这些是回归门而不是输入延迟分布；仍需在固定硬件上补局部编辑 P50/P95/P99、滚动 FPS、内存
和 Android 低内存样本。

Windows 小样本原生版本验收中，三份约 261–317 B 的 Markdown 版本经内容寻址压缩后实际占用
796 B/3 块；删除一个独有版本回收 275 B。该结果只证明统计和垃圾回收路径正确，不代表大正文
去重率预算；仍需使用局部编辑的 2 MiB/长历史数据集测 P50/P95、压缩比和数据库增长。

## 基准数据集

小 Vault、10,000/100,000 笔记、2 MB 单笔记、10,000 行代码块、100 种 fenced language、深层 Markdown、密集 Wiki Link、公式、图片、图表与复习历史。

## 门禁

每次性能相关 PR 记录环境、数据集、样本数、P50/P95/P99、包体积和相对基线。超过预算阻止合并，除非 PR 明确说明原因、风险、临时阈值和恢复计划。
