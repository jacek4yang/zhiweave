# 安全模型

最近更新：2026-07-30

## 保护目标

- 用户 Markdown、附件、集合、Canvas、复习历史和密钥的机密性、完整性与可恢复性。
- 防止不可信 Markdown、HTML、SVG、图表、附件和同步对象获得代码执行或越权文件访问。
- 防止前端 compromise 扩大为任意本地系统访问。

## 信任边界

不可信：AI 生成内容、导入文件、同步对象、网页摘录、Markdown/HTML/SVG、附件元数据、外部链接、文件名和前端参数。

受限信任：React UI 与 WebView。它们不能直接持有主密钥、数据库连接或任意路径权限。

高信任：经过验证的 Rust application/domain 端口与成熟密码学库。高信任代码仍需输入验证、最小 capability 和故障测试。

## 主要威胁与控制

- 路径遍历/Zip Slip：规范化相对路径，拒绝绝对路径、`..`、NUL、设备路径和根目录逃逸；最终目标必须位于已打开 workspace。
- 覆盖与竞态：expected revision、同目录临时文件、flush/fsync、原子替换、外部修改冲突。
- XSS/脚本：原始 HTML 默认禁用或严格清洗；禁用事件属性、脚本、危险 URL；SVG 隔离。
- 任意代码执行：代码块只读；未来代码实验使用独立对象、明确命令、无网络、临时目录、超时与用户确认。
- capability 过宽：按窗口/平台最小授权；命令清单与路径 scope 明确。
- 密钥泄漏：成熟 KDF/AEAD/密钥存储库，内存清理，日志和错误中不输出秘密。
- 同步重放/篡改：对象身份认证、版本/nonce 规则、幂等请求和显式冲突。
- Prompt 外泄：默认最小上下文，复制前预览范围与敏感信息提示，不自动上传。
- Markdown 交互实验：只接受 `zhiweave/lab@1` 声明式 JSON、16 KB 上限、严格字段白名单和内置组件；无 eval、脚本、网络、文件或密钥能力，失败时显示原始 fence。

## 当前文件安全基线

- Tauri 只暴露 `system_status`、工作区快照、创建笔记和冲突安全保存；根目录固定，命令没有任意路径、shell、网络或数据库能力。
- `PortablePath` 在 Rust 反序列化入口再次验证，不能由前端绕过；文件遍历逐段拒绝符号链接并校验 canonical root。
- 正文使用同目录原子替换，精确字节 SHA-256 expected revision 阻止常规外部修改覆盖；成功后回读校验。
- 浏览器 `localStorage` 只保留明确标识的 UI 预览数据。原生端启动后从 Markdown 文件加载正文，不把正文写入 WebView `localStorage`。
- 冲突不覆盖，编辑器内容先恢复为独立 Markdown 文件后才重新载入外部版本。

## 当前剩余风险

- 还没有 SQLite 可重建索引、文件 watcher、备份包、工作区迁移、重命名身份保持、加密或同步。
- 最后一次修订检查与原子 rename 之间存在文件系统级极窄竞态；尚未完成平台锁和 watcher 的组合验证。
- 新建文件在空占位后被强制终止可能留下空 Markdown；不会覆盖旧正文，但还没有自动恢复任务。
- 磁盘满与目录只读已有结构化错误设计，仍需可重复的 Windows 故障注入夹具。
- 交互实验的零能力边界已落地，但通用 Markdown HTML/SVG 清洗管线尚未实现。
- Cargo advisory 扫描无已知 vulnerability，但仍有 17 个传递依赖维护/unsound warning；Windows 当前目标图不包含 GTK3/glib，`unic-*` 来自 Tauri 的 `urlpattern` 链。跨平台发布前必须升级或完成逐项风险接受，不能把 exit code 0 表述成零供应链风险。

## 验证

单元/属性/模糊测试覆盖路径、Unicode、frontmatter、HTML 清洗、同步协议和加密对象；集成测试注入磁盘满、权限拒绝、损坏数据库、进程中断、重放与冲突。发布前执行依赖审计和威胁模型复审。
