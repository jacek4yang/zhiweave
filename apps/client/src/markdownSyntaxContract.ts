export const MAX_WIKI_TARGET_LENGTH = 500;

export type CalloutKind =
  | "abstract"
  | "bug"
  | "caution"
  | "example"
  | "failure"
  | "info"
  | "note"
  | "question"
  | "quote"
  | "success"
  | "tip"
  | "warning";

export const CALLOUT_TITLES: Readonly<Record<CalloutKind, string>> = {
  abstract: "摘要",
  bug: "问题",
  caution: "危险",
  example: "示例",
  failure: "失败",
  info: "信息",
  note: "笔记",
  question: "问题",
  quote: "引用",
  success: "成功",
  tip: "提示",
  warning: "警告",
};

const CALLOUT_NAMES: Readonly<Record<string, CalloutKind>> = {
  abstract: "abstract",
  bug: "bug",
  caution: "caution",
  danger: "caution",
  error: "failure",
  example: "example",
  fail: "failure",
  failure: "failure",
  faq: "question",
  help: "question",
  info: "info",
  note: "note",
  question: "question",
  quote: "quote",
  success: "success",
  summary: "abstract",
  tip: "tip",
  todo: "info",
  warning: "warning",
};

export function calloutKindFromName(value: string): CalloutKind | null {
  return CALLOUT_NAMES[value.trim().toLocaleLowerCase("en-US")] ?? null;
}
