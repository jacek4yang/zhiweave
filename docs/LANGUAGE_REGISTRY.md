# Language Registry 规格

最近更新：2026-07-30

## 目标

为编辑视图、阅读视图、导出和代码块工具栏提供唯一的语言身份、别名和加载策略。未知语言必须安全回退到纯文本并保留 fence 标识。

## 数据模型

```ts
interface LanguageDefinition {
  canonicalId: string;
  aliases: readonly string[];
  fileExtensions: readonly string[];
  mimeTypes: readonly string[];
  displayName: string;
  iconKey: string;
  defaultTabSize: number;
  commentSyntax: CommentSyntax;
  indentationRules: IndentationRules;
  bracketRules: BracketRules;
  parserLoader: () => Promise<LanguageSupport>;
  formatterCapability: "none" | "external";
  grammarVersion: string;
}
```

注册时验证 canonical id、别名冲突和加载器唯一性。规范化先执行 Unicode/ASCII 大小写规则，再查 O(1) alias map；不得用模糊匹配猜测语言。

初始别名：

```text
js→javascript ts→typescript py→python rs→rust
sh|bash→shell ps1→powershell cs→csharp yml→yaml
```

## 加载与缓存

- 首屏只包含 Markdown 和纯文本。
- 由 fenced code resolver 请求 grammar，使用动态 `import()`。
- 同一语言并发请求共享 promise；失败带原因缓存短时间，允许显式重试。
- 缓存键：canonical id、grammar version、内容哈希、主题 token version。
- 当前视口优先，其次当前代码块、邻近代码块、后台空闲解析。
- grammar 和 WASM 均离线打包，不允许运行时网络请求。

## 支持分层

Tier 1 首批：JavaScript、TypeScript、JSX/TSX、Python、Rust、Go、C/C++、C#、Java、Kotlin、SQL、Shell、PowerShell、HTML/CSS/SCSS、JSON/JSONC、YAML、TOML、XML、Markdown、Lua、Dockerfile、Diff、Regex、GraphQL、Protocol Buffers。

Tier 2 在独立扩展中提供，不进入首屏包。每个 Tier 1 定义必须有别名、动态加载、最小语法 corpus、未知/失败回退和包体积记录。

## 安全

parser 只读取文本；grammar 不访问网络、文件系统或执行代码。Tree-sitter WASM 如启用，只运行在受限 Worker，限制输入大小、时间和内存，并在超限时回退纯文本。
