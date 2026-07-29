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

## ADR-0009：固定工作区、原子替换与内容修订

状态：Accepted（文件层）；SQLite 索引、文件监控和重命名身份仍为后续切片

Windows Tauri 端只打开应用数据目录下的固定 `workspace`，前端命令不能传入任意根目录。所有用户路径先转为跨平台 `PortablePath`：仅允许相对 Markdown 路径，统一 `/`，拒绝盘符、UNC、空组件、`.`、`..`、NUL、控制字符、Windows 设备名和不可移植字符；文件适配器再逐段拒绝符号链接并校验 canonical root。

读取时：

- 原始字节不得超过 16 MiB，工作区快照最多 10,000 篇、12 层目录；
- 只接受严格 UTF-8；
- 记录 UTF-8 BOM 和 LF/CRLF/CR/Mixed；
- 编辑器内统一为 LF，但保存时恢复原来的单一换行风格与 BOM；
- Mixed 必须由用户明确选择规范化，不能静默改写。

保存时：

- 对精确原始字节计算 SHA-256 修订；
- UI 必须提交上次读取的 expected revision；
- 写入同目录临时文件并同步，再次读取源文件校验修订，最后原子替换并回读验证；
- 外部修改返回结构化 `conflict`，绝不自动 last-write-wins；
- UI 保留编辑器缓冲；用户选择恢复时先另存 `recovery/`，再载入外部版本。

浏览器预览仍使用独立 `localStorage` 演示状态，并在界面明确标注，不会作为 Tauri 命令失败时的回退。

文件扫描、创建和保存通过 Tauri blocking worker 执行；不在 WebView/IPC 响应线程同步遍历磁盘。单一 workspace mutex 先保证同一进程内写入串行，后续基准证明需要时再引入更细粒度并发。

已知边界：当前笔记 ID 暂由 portable path 派生，重命名身份保持要等可重建 SQLite manifest；尚无文件 watcher。通用文件系统无法提供跨外部编辑器的无窗口 compare-and-swap，最后一次修订检查与 rename 之间仍有极窄 TOCTOU 窗口；后续用 watcher、平台锁研究和冲突中心缩小并显式处理。新建采用 `create_new` 空文件占位后原子替换，若占位后进程被杀，可能留下可见的空 Markdown 文件，但不会覆盖已有正文；恢复扫描和创建日志属于下一步。
