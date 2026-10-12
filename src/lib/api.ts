// Typed wrappers over the Rust commands. Errors arrive as plain strings.

import { invoke } from "@tauri-apps/api/core";

export interface AppInfo {
  version: string;
  platform: string;
}

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  /** The file's bytes (sent raw, not as JSON). */
  readFile: async (path: string) => new Uint8Array(await invoke<ArrayBuffer>("read_file", { path })),
  /** Save bytes to `path` (temp file, then rename). */
  writeFile: (path: string, bytes: Uint8Array) =>
    invoke<void>("write_file", bytes, { headers: { "x-path": encodeURIComponent(path) } }),
  /** Smaller PDF bytes (the same bytes back when nothing could be saved). */
  compressPdf: async (bytes: Uint8Array, preset: "light" | "balanced" | "strong", password?: string) =>
    new Uint8Array(
      await invoke<ArrayBuffer>("compress_pdf", bytes, {
        headers: { "x-preset": preset, "x-password": encodeURIComponent(password ?? "") },
      }),
    ),
  takeStartupPaths: () => invoke<string[]>("take_startup_paths"),
  revealFile: (path: string) => invoke<void>("reveal_file", { path }),
  openLink: (id: "releases" | "developer" | "deskzero" | "deskmedic") => invoke<void>("open_link", { id }),
  notifyUpdate: (version: string) => invoke<void>("notify_update", { version }),
};

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
