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
- 索引混淆/损坏：固定数据库路径、SQLite application ID、schema 版本、quick check 和严格
  表结构；现存损坏/外来/未来数据库不静默替换。
- 隐藏身份篡改：版本化 JSON、2 MiB/10,000 条上限、portable path/UUID/revision 校验、
  ID/path 唯一约束；损坏时 create/save/rebuild 在正文变更前失败关闭。
- FTS 查询注入/资源滥用：前端不传 SQL；Rust 把用户输入绑定为参数和字面短语，限制 256 字与
  100 项结果，控制字符和零 limit 被拒绝。
- Wiki 关系混淆/资源滥用：只扫描 Markdown 正文安全范围，target/alias 有 500 字符上限；
  path/H1/stem 多候选保留 ambiguous，不用目录距离或排序猜测；反向链接参数绑定且最多返回
  200 个 occurrence。
- Wiki 正向打开：IPC 只接受当前固定工作区内的稳定来源 ID 与最多 500 Unicode scalar 的
  单行 target；Rust 返回三态结果和固定根内的 portable path。unknown source、控制字符、
  超限或空 target 结构化拒绝，浏览器预览不伪造原生 resolver。
- missing Wiki 创建：客户端只确认 Rust 给出的标题、portable path 与 heading 提案；确认后
  后端重新快照并要求 authored target 仍为 missing 且提案路径完全相同，再用 `create_new`
  发布。歧义、目标已出现、陈旧来源或目的文件存在都不覆盖、不猜测。
- 本地附件预览：IPC 只接受稳定来源 ID、原始 target 和受限引用类型。Rust 拒绝远程/活动
  scheme、`.zhiweave`、符号链接、根外路径、控制字符、超限 target 和多个候选；扩展名与
  文件签名必须一致，只允许有界 PNG/JPEG/静态 WebP。SVG、GIF、动画 WebP、PDF、音视频和
  未知格式保持 inert placeholder，不进入 WebView 活动资源管线。
- 本地附件导入：系统选择器和完整外部路径只存在于 Rust；WebView 仅发送来源稳定 ID，随后
  收到不含系统路径的 opaque token 与精确提案。拒绝符号链接/非文件；Windows 打开时使用
  `FILE_FLAG_OPEN_REPARSE_POINT`，并对已打开句柄再次核对文件类型与重解析点属性，关闭选择后
  路径替换竞态。单文件 64 MiB、待确认 8 项/128 MiB、10 分钟 TTL。确认时重新生成并核对
  目标、相对 Markdown 引用、显示策略、字节长度和 SHA-256，使用 `create_new`、同步和回读
  校验；来源移动、同名竞态或陈旧提案失败关闭。非安全静态图片只生成 inert Wiki 附件引用。
- 文件事件欺骗/丢失：watcher 事件仅作为无路径唤醒信号，不直接修改 UI 状态；每次由固定根
  `WorkspacePort` 重新读取、验证并比较完整快照。平台错误、空路径和 `Rescan` 都按可能漏报处理。

## 当前文件安全基线

- Tauri 只暴露 `system_status`、工作区快照/变化核对、创建/保存/非覆盖重命名、受限全文搜索/
  反向链接和显式索引重建；根目录固定，命令没有任意根路径、SQL、shell 或网络能力。
- `PortablePath` 在 Rust 反序列化入口再次验证，不能由前端绕过；文件遍历逐段拒绝符号链接并校验 canonical root。
- 正文使用同目录原子替换，精确字节 SHA-256 expected revision 阻止常规外部修改覆盖；成功后回读校验。
- 浏览器 `localStorage` 只保留明确标识的 UI 预览数据。原生端启动后从 Markdown 文件加载正文，不把正文写入 WebView `localStorage`。
- 冲突不覆盖，编辑器内容先恢复为独立 Markdown 文件后才重新载入外部版本。
- 稳定 ID 位于 `.zhiweave/identity.json`，不写普通笔记；SQLite 只保存可删除的本机派生副本。
- Wiki occurrence 只保存派生 link/embed、原始 target、有界上下文和来源范围；YAML、代码、
  HTML comment、转义/畸形语法不进入关系表，删除 SQLite 后可从 Markdown 重建。
- Wiki 点击不会把 authored target 当作系统路径、URL 或 shell 参数；resolved 结果必须先映射
  回当前稳定工作区快照。missing/ambiguous 不打开任何节点，heading 只在既有 Markdown AST
  中查找并滚动，不执行内容。
- Wiki missing 确认不是“信任前端路径”：后端在写入前重新生成并逐字段比较提案，使用已有
  身份/索引更新流程发布，文件已存在即失败。
- 附件 resolver 逐段检查 `symlink_metadata`，再验证 canonical path 仍在固定 root；普通图片
  只按来源目录解析，Wiki 嵌入候选冲突返回 ambiguous。读取上限 8 MiB，图像单边上限 16,384、
  总像素上限 40,000,000，结果带 SHA-256；WebView 只接收验证后字节的 inert data URL。
- 附件 importer 不接受前端路径。原生 picker 捕获的原始字节只暂存在有界内存 proposal，
  确认后写入固定 `attachments/`；发布失败由创建资源 guard 清理不完整目的文件。Markdown
  引用由 CodeMirror 单次 transaction 插入，撤销引用不连带删除用户附件。
- 显式索引重建先完整生成/校验候选库，再保存旧数据库到 recovery；失败不会修改 Markdown。
- 应用内移动采用目标 `create_new`、完整写入/sync/校验、源 revision 复查、最后删源；目的地
  存在时失败，不使用平台相关的覆盖式 rename。
- 外部变化按稳定 ID/path/revision 分类。自动刷新只替换干净缓冲；脏缓冲继续留在内存。接受磁盘
  版本前先逐篇创建 recovery，且恢复期间继续输入会中止重载。
- 正式历史位于独立固定路径 `history.sqlite3`；application ID、schema、`quick_check`、
  foreign-key check 与严格表结构阻止把外来/未来/损坏数据库当成历史。
- 每个版本保存完整内容哈希与有序内容寻址清单；读取时逐块解压并复核块 SHA-256、原始长度、
  完整长度、UTF-8/LF 和完整 SHA-256，任何不一致都不向编辑器返回正文。
- 保存、checkout 和删除都使用 expected head；删除在单一 SQLite 事务内重接子节点、调整 head
  并回收无引用块。恢复先保护当前编辑，再以 Markdown expected revision 写回，最后切换 head。
- 命名检查点和保留策略由 Rust 选择候选；当前 head、根、分支末端和检查点固定保护。清理令牌
  绑定完整图、固定时间边界和候选集，应用前重算；候选块损坏、head/检查点变化均在事务前失败。
- 备份包路径由后端 UUID 固定，manifest 只接受受限 portable 相对路径；拒绝符号链接、`..`、
  非常规文件、重复路径和超限文件。逐文件长度/SHA-256、payload 路径集合、总字节和历史节点
  重建全部通过后才发布。
- 历史备份通过 SQLite `VACUUM INTO` 生成一致快照，不复制可能缺少 WAL 的裸数据库。恢复先
  生成当前工作区安全备份并完整构建 stage；外部 restore plan 绑定固定根名与 UUID 同级目录。
  下次启动在 storage/watcher 打开前执行双 rename，旧根不自动删除；中断后按 plan 继续或回退。

## 当前剩余风险

- SQLite/FTS 与稳定身份已落地，但 identity 本身尚无加密/签名，SQLite 本机正文索引也未加密；
  客户端密码/Stronghold 未完成前，不适合威胁模型包含本地磁盘窃取的真实敏感数据。
- 已有固定本机工作区 watcher、单篇 recovery、持久版本恢复和可校验本机目录备份包，但尚无
  任意位置导入、跨设备恢复演练、历史/备份加密或同步。备份目录与原文具有相同敏感度。
- watcher 依赖平台通知，网络文件系统不在支持范围；如果平台既漏报又不发 `Rescan`，只能由后续
  事件或重启快照发现。高频压力、休眠恢复和目录锁场景尚未完成。
- 安全移动不是原子 rename；进程终止可能留下重复目标，且最后一次源 revision 检查与删除之间
  存在文件系统级极窄竞态。尚未完成平台锁和 watcher 的组合验证。
- 新建文件在空占位后被强制终止可能留下空 Markdown；不会覆盖旧正文，但还没有自动恢复任务。
- 磁盘满与目录只读已有结构化错误设计，备份/恢复事务回滚已有临时目录与中断测试，但仍需
  可重复的 Windows 卷级磁盘满和 ACL 故障注入夹具。
- 交互实验的零能力边界已落地，但通用 Markdown HTML/SVG 清洗管线尚未实现。
- Cargo advisory 扫描无已知 vulnerability，但仍有 17 个传递依赖维护/unsound warning；Windows 当前目标图不包含 GTK3/glib，`unic-*` 来自 Tauri 的 `urlpattern` 链。跨平台发布前必须升级或完成逐项风险接受，不能把 exit code 0 表述成零供应链风险。

## 验证

单元/属性/模糊测试覆盖路径、Unicode、frontmatter、HTML 清洗、同步协议和加密对象；集成测试注入磁盘满、权限拒绝、损坏数据库、进程中断、重放与冲突。发布前执行依赖审计和威胁模型复审。
