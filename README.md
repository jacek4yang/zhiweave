# 知织 / ZhiWeave

知织是一款跨平台、离线优先、端到端加密、Markdown 原生的学习型笔记软件。

项目主页：<https://github.com/jacek4yang/zhiweave>

目标平台：

- Android
- macOS
- Linux
- Windows

核心体验：

- 启动密码解锁；
- 干净的 Markdown；
- 面向“今天、主题、资料、实验、论文、复习”的学习导航；
- 可视化知识树；
- 由用户主动复制的网页 AI 学习提示词；
- Git 式手动检查、提交、拉取、推送和冲突处理；
- 自建端到端加密同步服务器。

项目已经停止以 Obsidian 插件为产品载体。旧 Learning Loop 数据只通过一次性导入进入
ZhiWeave，新客户端和服务端使用全新协议。

## 当前状态

`0.1.1` 是可交互的跨平台技术尖峰。当前骨架包含：

- Tauri 2 + React + TypeScript 客户端；
- CodeMirror 6 Markdown 编辑器；
- 可操作的学习导航、新建、搜索、阅读与网页 AI 提示词复制；
- 本机草稿、任务进度和手动版本历史持久化；
- Rust 领域与应用层；
- `ZHIWEAVE/1` 协议标识；
- Rust Axum 服务端健康检查；
- 基础测试和 CI 入口。

它还不是可用于真实数据的发行版。加密配置、SQLite、文件持久化和同步将在架构尖峰通过后
逐层接入。

完整产品与开发基线见
[ARCHITECTURE.zh-CN.md](ARCHITECTURE.zh-CN.md)。

## 本地验证

```text
pnpm install
pnpm typecheck
pnpm test
pnpm build
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
```

启动桌面技术原型：

```text
pnpm dev
```

## 许可证

ZhiWeave 采用
[GNU Affero General Public License v3.0 or later](LICENSE)，SPDX 标识为
`AGPL-3.0-or-later`。
