# 设计系统

状态：阶段 1 基线
最近更新：2026-07-30

## 设计方向

专业、克制、高信息密度、长时间阅读舒适。视觉语言应像成熟的编辑器和知识工具，不像 SaaS 营销页。主编辑器优先于装饰、统计卡和品牌区域。

## Token 约定

所有颜色、间距、字体、圆角、阴影、动效和控件尺寸必须经 CSS custom properties 暴露，组件不得散布十六进制常量。

建议层级：

- 表面：`--surface-app`、`--surface-panel`、`--surface-editor`、`--surface-elevated`
- 文本：`--text-primary`、`--text-secondary`、`--text-muted`、`--text-inverse`
- 边界：`--border-subtle`、`--border-default`、`--border-focus`
- 语义：`--accent`、`--success`、`--warning`、`--danger`、`--info`
- 尺寸：4 px 基线网格，控件高度 24/28/32 px，正文行高 1.6–1.75
- 面板：主侧栏默认 244 px（200–400 px），检查器默认 270 px（220–420 px）；8 px 分隔热区，
  空闲线条不制造视觉噪声，Hover/Focus/拖动时才使用强调色
- 圆角：2/4/6/8 px；避免 12 px 以上大圆角
- 阴影：只用于命令面板、菜单、对话框等真实叠层

## 主题

- 默认深色：中性偏冷表面，正文对比满足 WCAG AA。
- 浅色：低眩光暖白，不使用纯白大面积卡片。
- 高对比：不依赖透明度，焦点与边界明确。

主题切换不得重新创建编辑器 state 或丢失选区。

## 密度

- Comfortable：48 px 工具栏、40 px 笔记行、17 px 阅读正文和较宽编辑留白。
- Compact：44 px 工具栏、34 px 笔记行，作为默认专业工作台密度。
- Terminal：38 px 工具栏、28 px 笔记行、15 px 阅读正文，为键盘工作流保留更多空间。

密度只改变控件高度、字号、行高和内边距，不改变命令、标签、知识节点、检查器或版本状态。

## 字体

不请求网络字体。界面使用平台无衬线栈，代码使用平台等宽栈，长文可选本地衬线栈。当前实现只使用 Windows/系统字体与 Cascadia Code/Consolas 回退，不发起字体网络请求。

## 状态

- Hover：轻微表面变化，不改变布局。
- Active/Selected：同时使用背景、边界或图标标记。
- Focus：2 px 明确焦点环，不能被 `outline: 0` 无替代地移除。
- Disabled：降低强调度且保留可读性。
- Loading：局部骨架或进度，不冻结编辑器。
- Empty：解释下一步，不放营销插画。
- Error/Warning/Success：图标、文字和颜色三者组合。

## 当前实现

默认主题基于服务器 Neovim TokyoNight Moon 的角色逻辑重新映射：编辑画布 `#222436`、深表面
`#1e2030`、正文 `#c8d3f5`，蓝/青/绿/紫/橙/黄分别承担标题、链接、字符串、关键字、数字与
警告等语义。颜色不是按组件随意分配。

专业工作台已完成月夜深色、低眩光暖纸浅色和高对比三套主题，以及 Comfortable/Compact/
Terminal 三档密度。三套主题共享 `canvas/panel/surface/ink/line/accent/status/syntax` 角色；
Markdown 标题、链接、代码、字符串、数字、标点和警告保持不同语法颜色。高对比主题使用纯黑
主表面、白色主文字、实线边界、无叠层阴影和 2 px 焦点环；浅色主题使用暖白画布而不是纯白
卡片。外观面板按需加载，Activity Bar 与状态栏均可打开，状态栏持续显示当前组合。

主题/密度切换已经实测不会重新创建 CodeMirror、改变 Markdown、活动标签或滚动位置；独立
版本化记录跨 Windows 原生进程恢复。仍需逐步把历史组件中少量局部常量收敛到语义 token，
但它们不再阻塞三套完整主题的使用。

- [Windows 工作台 1280×720](./baseline/workbench-windows-1280x720.png)
- [窄屏工作台 390×844](./baseline/workbench-narrow-390x844.png)
