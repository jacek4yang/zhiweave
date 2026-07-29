# 参与知织开发

感谢你愿意帮助建设知织（ZhiWeave）。

## 开始之前

1. 阅读 [架构与产品基线](ARCHITECTURE.zh-CN.md)。
2. 对涉及协议、加密、同步格式或数据模型的更改，先建立设计讨论。
3. 不提交真实笔记、密码、密钥、服务器地址或数据库文件。

## 本地检查

```text
pnpm install
pnpm typecheck
pnpm test
pnpm build
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
```

## 变更原则

- Markdown 文件是用户可携带、可读、可恢复的事实来源。
- SQLite 是可重建索引，不是唯一事实来源。
- 服务器只保存加密后的对象与版本元数据。
- 同步必须由用户主动触发，不在后台静默覆盖内容。
- 冲突必须显式呈现；不得以“最后写入获胜”掩盖数据损失。
- 用户界面使用学习语言，不直接暴露内部字段与实现细节。

## 提交说明

提交标题使用祈使语气并说明结果，例如：

```text
Add immutable commit validation
Fix Android editor viewport resize
```

每个提交应当聚焦一个可验证目标，并带上相应测试。
