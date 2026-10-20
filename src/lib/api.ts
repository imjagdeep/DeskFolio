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
  /** Batch: the PDFs in a folder (sorted), and an output path that doesn't exist yet. */
  batchListPdfs: (dir: string, recursive: boolean) => invoke<string[]>("batch_list_pdfs", { dir, recursive }),
  batchFreePath: (path: string) => invoke<string>("batch_free_path", { path }),
  openLink: (id: "site" | "repo" | "issues" | "releases" | "developer" | LabToolId) => invoke<void>("open_link", { id }),
  /** The other DeskLab tools and whether each is installed here. */
  desklabTools: () => invoke<LabTool[]>("desklab_tools"),
  /** Start an installed DeskLab tool, optionally with a file for it to open. */
  openTool: (id: LabToolId, file?: string) => invoke<void>("open_tool", { id, file: file ?? null }),
  notifyUpdate: (version: string) => invoke<void>("notify_update", { version }),
  /** OCR language packs: the list (with what's downloaded), download one, its bytes, remove one. */
  ocrLangs: () => invoke<OcrLangInfo[]>("ocr_langs"),
  ocrLangDownload: (code: string) => invoke<void>("ocr_lang_download", { code }),
  ocrLangData: async (code: string) => new Uint8Array(await invoke<ArrayBuffer>("ocr_lang_data", { code })),
  ocrLangRemove: (code: string) => invoke<void>("ocr_lang_remove", { code }),
  /** Trusted timestamps: the services on offer [id, name], and one RFC 3161 round trip. */
  timestampServices: () => invoke<[string, string][]>("timestamp_services"),
  timestampRequest: async (service: string, request: Uint8Array) =>
    new Uint8Array(await invoke<ArrayBuffer>("timestamp_request", request, { headers: { "x-tsa": service } })),
};

export interface OcrLangInfo {
  code: string;
  name: string;
  /** Download size in bytes. */
  size: number;
  installed: boolean;
}

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  // A slip in DeskFolio's own code ("x is not iterable") means nothing to the
  // person using it: say so plainly and keep the details for the console.
  if (e instanceof TypeError || e instanceof ReferenceError || e instanceof SyntaxError) {
    console.error(e);
    return "Something went wrong inside DeskFolio. Please try again; if it keeps happening, use Help › Report a problem.";
  }
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
