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
- `pnpm test`：通过，3 files / 15 tests；包含版本增量/分支删除/旧数据迁移/日记/H1 命名与交互实验 schema/UUID 位解析。
- `pnpm build`：通过，主 chunk 有 >500 KB 警告。
- `pnpm audit --prod --audit-level high`：无已知漏洞。
- 浏览器：搜索、阅读/编辑、分栏、标签、刷新恢复、复制保真、上下文菜单分流、输入粘贴、编辑撤销、UUID 生成/校验/提示词通过。
- 视口：1280×720、1366×768、1440×900、1920×1080、2560×1440、320×720、390×844、412×915、915×412 均无水平溢出。
- Rust 1.95.0 基线 fmt、Clippy 与 workspace tests 已在 Windows 通过；合并前必须对最终差异重跑。
- `cargo-audit`：环境未安装，尚未运行。

## 故障注入矩阵

磁盘满、目录只读、目标外部修改、SQLite 损坏、写入中断、网络断开、重复请求、对象篡改、同步冲突和旧版本迁移。每个缺陷先建立最小失败测试，再修复并检查相邻路径。

## 合并门

相关测试、`git diff --check`、类型/格式/Clippy、生产构建、真实浏览器操作、截图与 CI 必须通过。不能运行的检查必须记录原因、替代证据、剩余风险和所需环境。
