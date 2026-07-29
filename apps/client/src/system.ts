import { invoke } from "@tauri-apps/api/core";

export interface SystemStatus {
  readonly product: string;
  readonly protocol: string;
  readonly protocolVersion: number;
  readonly stage: string;
  readonly obsidianDependency: boolean;
}

const BROWSER_PREVIEW_STATUS: SystemStatus = {
  product: "知织 / ZhiWeave",
  protocol: "ZHIWEAVE/1",
  protocolVersion: 1,
  stage: "browser UI preview",
  obsidianDependency: false,
};

export async function loadSystemStatus(): Promise<SystemStatus> {
  if (
    typeof window === "undefined" ||
    !("__TAURI_INTERNALS__" in window)
  ) {
    return BROWSER_PREVIEW_STATUS;
  }
  return invoke<SystemStatus>("system_status");
}
