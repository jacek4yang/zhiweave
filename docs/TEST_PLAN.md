# 测试计划

最近更新：2026-07-30

## 分层

1. TypeScript 单元：command、状态机、Language Registry、Live Preview、Prompt 隐私、快捷键。
2. Rust 单元：路径、原子保存、迁移、索引、FSRS、加密、版本和冲突。
3. 属性测试：Markdown 往返、路径/Unicode、序列化、集合查询、调度与合并。
4. 模糊测试：Markdown/frontmatter/Wiki Link、Canvas JSON、导入、HTML 清洗、同步和加密对象。
5. 集成：真实临时目录、SQLite、崩溃恢复、文件监控和 Tauri command。
6. 浏览器 E2E：工作台、编辑器、搜索、主题、密度、键盘、响应式和离线资源。
7. 视觉回归：深/浅/高对比、三种密度、中英文、代码、公式、表格、状态与 Android。
8. 跨平台：Ubuntu/Windows/macOS/Android 构建与人工清单。

## 阶段 0 证据

- `pnpm install --frozen-lockfile`：通过，142 个 lockfile 条目通过供应链策略。
- `pnpm typecheck`：通过。
- `pnpm lint`：通过（当前等同 TypeScript noEmit，需加入真实 ESLint）。
- `pnpm test`：通过，5 files / 22 tests；包含版本增量/分支删除/旧数据迁移/日记/H1 命名、种子一致性与旧显示名修复、交互实验 schema/UUID 位解析，以及 native DTO、结构化错误与并发保存状态合并。
- `pnpm build`：通过，主 chunk 有 >500 KB 警告。
- `pnpm audit --prod --audit-level high`：无已知漏洞。
- 浏览器：搜索、阅读/编辑、分栏、标签、刷新恢复、复制保真、上下文菜单分流、输入粘贴、编辑撤销、UUID 生成/校验/提示词通过。
- 视口：1280×720、1366×768、1440×900、1920×1080、2560×1440、320×720、390×844、412×915、915×412 均无水平溢出。
- Rust 1.95.0 基线 fmt、Clippy 与 workspace tests 已在 Windows 通过；合并前必须对最终差异重跑。
- `cargo audit --no-fetch --stale`：2026-07-28 advisory DB 扫描 444 个 lockfile 依赖，无已知 vulnerability；有 17 个 allowed warning。GTK3/glib 项来自非 Windows 的 Tauri target 依赖（当前 Windows `cargo tree -i glib/atk` 不在目标图），其中 `glib` 有一项 unsound advisory；`urlpattern` 链含 6 个 unmaintained `unic-*`，另有 `proc-macro-error` warning。发布前必须在各目标平台更新 Tauri/传递依赖并以 `-D warnings` 重新评估，不能忽略。

## Markdown 文件纵切证据

- Rust 当前 workspace 29 项测试通过，其中 storage 15 项、portable path 5 项、
  application 2 项、Markdown 4 项、protocol 1 项、server 1 项和 Tauri
  seed/restart/search 1 项。
- 原子保存：真实临时目录创建、修改、无变化保存、回读修订与 H1 标题通过。
- 字节往返：UTF-8 BOM + CRLF 编辑后精确保留；Mixed 保存失败并要求明确规范化。
- 冲突：读取后由外部进程改写，保存返回结构化 conflict，外部正文逐字节保留。
- 覆盖保护：重复 create 返回 AlreadyExists；普通文件占据父目录时失败且不生成子文件。
- 只读：源文件 readonly 时保存返回 permissionDenied，原文保持不变。
- 中断：`AtomicWriteFile` 写入临时文件后不 commit 即销毁，旧 Markdown 保持可读。
- 输入边界：绝对路径、UNC、`..`、Windows 设备名、非法字符、无效 UTF-8、16 MiB 超限被拒绝；反序列化不能绕过路径校验。
- Windows Tauri：开发进程完成重编译并在固定应用数据工作区生成 6 个种子 Markdown，证明 setup → application service → storage adapter 链路可运行。
- Tauri seed/restart：首次生成 6 篇；用户修改 welcome 后再次初始化不会覆盖正文。
- 浏览器：桌面重新载入后无新增 console error/warning；状态栏上下文菜单按环境分流；390×844 与 320×720 无页面水平溢出。

## SQLite、稳定身份与搜索证据

- identity v1：首次扫描生成隐藏清单；ID/path 唯一；非法 JSON、非法 UUID、重复项和非法
  revision 失败关闭。
- 故障原子性：identity 损坏时 create/save/rebuild 在修改 Markdown 前返回结构化失败。
- 重命名：外部唯一同 revision 改名保持 ID；相同内容的多个文件不共享 ID；应用内移动保持
  ID、更新搜索路径、目标存在时不覆盖任一文件。
- schema/migration：空库从 `user_version=0` 进入 v1；未来 `user_version=999` 不自动降级。
- FTS：标题/正文中文 trigram、单字短查询、保存后增量替换和旧词消失通过；空查询、零 limit
  和超过 256 字查询被拒绝。
- 可重建：删除 SQLite 后快照重新生成索引且 identity 不变；正文逐字节不变。
- 损坏恢复：伪造非 SQLite 文件后快照仍返回 Markdown 并标记 `needsRebuild`，搜索失败；只有
  显式重建才替换，旧字节保留在 `.zhiweave/recovery/`，新搜索恢复。
- Windows 原生：真实 Tauri 进程运行；应用数据工作区有 6 篇 Markdown、identity v1 的
  6 个唯一 ID/路径和有效 `SQLite format 3` 数据库。
- 本次 UI 变更后的 in-app browser 重新访问被本地 URL 安全策略拒绝，未尝试绕过；由
  TypeScript 检查、组件测试、原生运行和既有视觉基线替代。本切片仍需在后续可用会话补视觉截图。

尚未完成：稳定 Windows 磁盘满/只读目录故障注入、Tauri IPC 自动 E2E、文件 watcher 竞态、
占位/安全移动强杀恢复、长读事务、10,000 文件性能基准、100,000 条索引查询基准和 Android
文件系统验证。

## 故障注入矩阵

磁盘满、目录只读、目标外部修改、SQLite 损坏、写入中断、网络断开、重复请求、对象篡改、同步冲突和旧版本迁移。每个缺陷先建立最小失败测试，再修复并检查相邻路径。

## 合并门

相关测试、`git diff --check`、类型/格式/Clippy、生产构建、真实浏览器操作、截图与 CI 必须通过。不能运行的检查必须记录原因、替代证据、剩余风险和所需环境。
