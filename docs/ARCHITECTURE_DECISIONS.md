# 架构决策记录

最近更新：2026-07-30

## ADR-0001：CodeMirror 6 + Lezer 作为 Markdown 主编辑内核

状态：Accepted

原因：源码保真、transaction/undo 一致性、视口渲染、增量语法树、可映射 Decoration 和扩展体系与目标匹配。ProseMirror/Lexical 更偏结构化富文本，Monaco 包体积和 Markdown Live Preview 适配成本更高。

Tree-sitter 只作为缺失代码语言的 Worker 候选，未经基准不进入主链。

## ADR-0002：Markdown 文件为正文事实来源

状态：Accepted

普通笔记正文只写 UTF-8 Markdown。SQLite 是可重建索引和状态库。删除 SQLite 后，正文、附件、集合和 Canvas 仍完整存在。

## ADR-0003：Rust 拥有持久化和安全边界

状态：Accepted

React/TypeScript 负责 UI、输入、编辑器和浏览器测试；Rust 负责路径、原子文件、SQLite、索引、迁移、密钥、同步、版本、附件、FSRS 和恢复。前端不得直接操作数据库或主密钥。

## ADR-0004：浏览器适配器与生产适配器隔离

状态：Accepted

浏览器预览仅用于 UI/E2E，返回明确的 `browser UI preview` 身份。生产 Tauri 命令失败时不得静默回退到浏览器 Mock。端口接口必须可在类型与测试中区分。

## ADR-0005：工作台 command-first

状态：Accepted

鼠标、快捷键、命令面板和右键菜单调用同一 command registry。避免相同功能拥有多个不一致实现。布局状态单独持久化，不在每次按键序列化全文。

## ADR-0006：SQLite 使用 bundled + WAL

状态：Proposed，阶段 2 验证后转 Accepted

使用 bundled SQLite 降低平台差异，数据库位于本机应用数据目录。启用外键、WAL、busy timeout 和显式 checkpoint；正文不进 SQLite 唯一副本。必须测试磁盘满、损坏、长读事务和重建。

## ADR-0007：同步采用加密对象与显式冲突

状态：Proposed，阶段 9 前需威胁模型与密码学审查

服务端只接触不透明加密对象。同步由用户触发，使用版本 DAG 和幂等请求；不得静默 last-write-wins。所有算法选型采用成熟库，不自行设计密码学。

## ADR-0008：内嵌实验采用声明式组件注册表

状态：Accepted

Markdown 使用 `zhiweave-lab` fenced block 携带版本化 JSON。运行时经过大小上限、schema、kind、字段白名单和值域校验后，只能进入知织内置的受信任 React 组件。拒绝通用 JavaScript、动态模块、远程插件和隐式能力。

理由：学习实验需要交互和动画，但 Markdown 必须继续可移植、可审计、可增量版本化。声明式定义能在普通阅读器中自然降级，也让未知版本、恶意输入和 AI 输出统一经过零信任验证。
