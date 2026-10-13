// Typed wrappers over the Rust commands. Errors arrive as plain strings.

import { invoke } from "@tauri-apps/api/core";

export interface AppInfo {
  version: string;
  platform: string;
}

export type LabToolId = "deskzero" | "deskmedic" | "deskfolio" | "deskshot";
export interface LabTool {
  id: LabToolId;
  installed: boolean;
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
  /** Which Office converters this computer has. */
  officeConverters: () => invoke<{ office: string[]; libreoffice: string | null }>("office_converters"),
  /** PDF bytes made from a Word/Excel/PowerPoint file by Office or LibreOffice. */
  officeToPdf: async (path: string) => new Uint8Array(await invoke<ArrayBuffer>("office_to_pdf", { path })),
  takeStartupPaths: () => invoke<string[]>("take_startup_paths"),
  /** Digital IDs: read a .pfx/.p12, write one, the saved-IDs folder and its files. */
  digitalIdImport: (path: string, password: string) => invoke<{ cert: number[]; chain: number[][]; pkcs8: number[] }>("digital_id_import", { path, password }),
  digitalIdExport: (path: string, cert: number[], chain: number[][], pkcs8: number[], password: string, alias: string) =>
    invoke<void>("digital_id_export", { path, cert, chain, pkcs8, password, alias }),
  digitalIds: () => invoke<[string, string[]]>("digital_ids"),
  digitalIdDelete: (name: string) => invoke<void>("digital_id_delete", { name }),
  revealFile: (path: string) => invoke<void>("reveal_file", { path }),
  openLink: (id: "site" | "repo" | "issues" | "releases" | "developer" | LabToolId) => invoke<void>("open_link", { id }),
  /** The other DeskLab tools and whether each is installed here. */
  desklabTools: () => invoke<LabTool[]>("desklab_tools"),
  /** Start an installed DeskLab tool, optionally with a file for it to open. */
  openTool: (id: LabToolId, file?: string) => invoke<void>("open_tool", { id, file: file ?? null }),
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
