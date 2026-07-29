import { useEffect, useState } from "react";
import {
  BookOpenText,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  FlaskConical,
  GitBranch,
  GraduationCap,
  Library,
  LockKeyhole,
  Network,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";

import { MarkdownEditor } from "./MarkdownEditor";
import { loadSystemStatus, type SystemStatus } from "./system";

const INITIAL_MARKDOWN = `# 欢迎来到知织

## 当前理解

知织把问题、证据、代码、论文、英文和复习织成一张可以持续修正的知识网络。

## 待探索

- [ ] 在 Windows 验证 Markdown 编辑器
- [ ] 在 Android 验证中文输入法和软键盘
- [ ] 接入客户端密码保护的 Stronghold
- [ ] 接入本地 SQLite 与原子文件保存
`;

const NAVIGATION = [
  { label: "今天", icon: CalendarDays },
  { label: "继续学习", icon: GraduationCap, active: true },
  { label: "学习主题", icon: Network },
  { label: "资料与论文", icon: Library },
  { label: "实验与记录", icon: FlaskConical },
  { label: "复习", icon: CheckCircle2 },
  { label: "版本控制", icon: GitBranch },
] as const;

export function App() {
  const [markdownValue, setMarkdownValue] = useState(INITIAL_MARKDOWN);
  const [status, setStatus] = useState<SystemStatus>();

  useEffect(() => {
    void loadSystemStatus().then(setStatus);
  }, []);

  return (
    <main className="app-shell">
      <aside className="navigation">
        <div className="brand">
          <span className="brand-mark"><BrainCircuit /></span>
          <span>
            <strong>知织</strong>
            <small>ZhiWeave</small>
          </span>
          <button type="button" aria-label="新建"><Plus /></button>
        </div>

        <label className="search">
          <Search />
          <input aria-label="搜索" placeholder="搜索知识…" />
        </label>

        <nav aria-label="学习导航">
          {NAVIGATION.map(({ label, icon: Icon, ...item }) => (
            <button
              className={"active" in item && item.active ? "is-active" : ""}
              key={label}
              type="button"
            >
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <section className="topic-progress">
          <span>当前主题</span>
          <strong>构建 ZhiWeave</strong>
          <div><i /></div>
          <small>1 / 8 个节点已完成</small>
        </section>

        <div className="build-identity">
          <LockKeyhole />
          <span>
            <strong>{status?.protocol ?? "正在读取核心…"}</strong>
            <small>{status?.stage ?? "architecture spike"}</small>
          </span>
        </div>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <span className="eyebrow">当前学习节点</span>
            <h1>独立跨平台架构</h1>
          </div>
          <div className="header-actions">
            <button type="button"><BookOpenText /> 阅读</button>
            <button className="primary" type="button"><Sparkles /> 复制给 AI</button>
          </div>
        </header>
        <MarkdownEditor value={markdownValue} onChange={setMarkdownValue} />
      </section>

      <aside className="context-panel">
        <span className="eyebrow">下一步</span>
        <h2>验证第一条垂直切片</h2>
        <p>先证明编辑、Rust、SQLite 和密码解锁能在 Windows 与 Android 共用，再扩展功能。</p>

        <section>
          <h3>完成标准</h3>
          <label><input type="checkbox" /> Windows 输入与保存</label>
          <label><input type="checkbox" /> Android 中文输入</label>
          <label><input type="checkbox" /> Stronghold 重启解锁</label>
          <label><input type="checkbox" /> SQLite 检索</label>
        </section>

        <section className="architecture-card">
          <BrainCircuit />
          <div>
            <h3>真正独立</h3>
            <p>
              {status?.obsidianDependency === false
                ? "Rust 核心确认：不依赖 Obsidian。"
                : "正在验证独立核心…"}
            </p>
          </div>
        </section>
      </aside>
    </main>
  );
}
