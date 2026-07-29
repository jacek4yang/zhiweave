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

- Vite ready：约 185 ms。
- Vitest：3 files / 15 tests，约 249 ms。
- Vite production build：约 402 ms。
- CSS：28.18 KB（gzip 5.86 KB）。
- 主 JavaScript：867.83 KB（gzip 290.74 KB）。
- `EmbeddedLab` 按需 chunk：6.22 KB（gzip 2.57 KB）。
- Vite 仍报告主 chunk 超过 500 KB。

交互实验已从主包动态拆分，但主包 gzip 仍超过目标 90.74 KB。下一步必须用可重复的 chunk 报告定位 CodeMirror、图标和工作台依赖；语言 grammar、图谱、Canvas、数学和实验组件均不得进入无关首屏。

## 基准数据集

小 Vault、10,000/100,000 笔记、2 MB 单笔记、10,000 行代码块、100 种 fenced language、深层 Markdown、密集 Wiki Link、公式、图片、图表与复习历史。

## 门禁

每次性能相关 PR 记录环境、数据集、样本数、P50/P95/P99、包体积和相对基线。超过预算阻止合并，除非 PR 明确说明原因、风险、临时阈值和恢复计划。
