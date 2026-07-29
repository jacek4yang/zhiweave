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
- 圆角：2/4/6/8 px；避免 12 px 以上大圆角
- 阴影：只用于命令面板、菜单、对话框等真实叠层

## 主题

- 默认深色：中性偏冷表面，正文对比满足 WCAG AA。
- 浅色：低眩光暖白，不使用纯白大面积卡片。
- 高对比：不依赖透明度，焦点与边界明确。

主题切换不得重新创建编辑器 state 或丢失选区。

## 密度

- Comfortable：32 px 行、较宽编辑器留白。
- Compact：28 px 行、默认专业工作台密度。
- Terminal：24 px 行、最小圆角、等宽信息优先。

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

默认主题基于服务器 Neovim TokyoNight Moon 的角色逻辑重新映射：编辑画布 `#222436`、深表面 `#1e2030`、正文 `#c8d3f5`，蓝/青/绿/紫/橙/黄分别承担标题、链接、字符串、关键字、数字与警告等语义。颜色不是按组件随意分配。

专业工作台已移除旧版浅色 Dashboard、营销卡、大圆角和网络字体，并增加焦点环、选中态、状态栏与叠层阴影约束。浅色、高对比、三种密度以及 token 命名统一仍待完成。

- [Windows 工作台 1280×720](./baseline/workbench-windows-1280x720.png)
- [窄屏工作台 390×844](./baseline/workbench-narrow-390x844.png)
