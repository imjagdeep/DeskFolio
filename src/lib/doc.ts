// The open PDF: its bytes (the source of truth for every edit), the pdf.js
// copy used for drawing it, an undo stack, recent files, and saving.
//
// Edits never touch the file on disk until you save, and "Save as" (a new
// file next to the original) is the default.

import { open, save } from "@tauri-apps/plugin-dialog";
import { useSyncExternalStore } from "react";
import { api } from "./api";
import { fileName, siblingPath } from "./format";
import { closePdf, loadPdf, PasswordNeeded, type PDFDocumentProxy } from "./pdfjs";
import { createStore, toast, toastError } from "./store";

export interface OpenDoc {
  path: string;
  name: string;
  bytes: Uint8Array;
  pdf: PDFDocumentProxy;
  pages: number;
  /** Set when the file needed one; edits re-open with it. */
  password?: string;
  /** Changed since it was opened or last saved. */
  dirty: boolean;
  /** Short descriptions of the edits, newest last. */
  edits: string[];
  /** Bumped on every change, so views know to redraw. */
  rev: number;
}

const docStore = createStore<OpenDoc | null>(null);
export const useDoc = () => useSyncExternalStore(docStore.subscribe, docStore.get);
export const currentDoc = () => docStore.get();

/** Earlier versions of the open file, for Undo. */
let undoStack: { bytes: Uint8Array; edits: string[]; pages: number }[] = [];
const MAX_UNDO = 15;

// ---------- password prompt (answered by the PasswordDialog component) ----------

type PasswordAsk = { name: string; wrong: boolean; answer: (pw: string | null) => void };
const askStore = createStore<PasswordAsk | null>(null);
export const usePasswordAsk = () => useSyncExternalStore(askStore.subscribe, askStore.get);
function askPassword(name: string, wrong: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    askStore.set({
      name,
      wrong,
      answer: (pw) => {
        askStore.set(null);
        resolve(pw);
      },
    });
  });
}

/** Open PDF bytes, asking for a password when the file has one. */
export async function loadWithPassword(
  bytes: Uint8Array,
  name: string,
): Promise<{ pdf: PDFDocumentProxy; password?: string } | null> {
  let password: string | undefined;
  for (;;) {
    try {
      return { pdf: await loadPdf(bytes, password), password };
    } catch (e) {
      if (!(e instanceof PasswordNeeded)) throw e;
      const pw = await askPassword(name, e.wrong);
      if (pw === null) return null;
      password = pw;
    }
  }
}

// ---------- recent files ----------

const RECENT_KEY = "deskfolio-recent";
const recentStore = createStore<string[]>(readRecent());
function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 12) : [];
  } catch {
    // Storage unavailable or damaged: start an empty list.
    return [];
  }
}
export const useRecent = () => useSyncExternalStore(recentStore.subscribe, recentStore.get);
function remember(path: string) {
  const next = [path, ...recentStore.get().filter((p) => p !== path)].slice(0, 12);
  recentStore.set(next);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Not kept across restarts; fine.
  }
}
export function forgetRecent(path: string) {
  const next = recentStore.get().filter((p) => p !== path);
  recentStore.set(next);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Same as above.
  }
}

// ---------- opening ----------

/** True when it is fine to replace the open document (asks if unsaved). */
async function okToReplace(): Promise<boolean> {
  const d = docStore.get();
  if (!d?.dirty) return true;
  const { ask } = await import("@tauri-apps/plugin-dialog");
  return ask(`${d.name} has changes that aren't saved. Open another file and lose them?`, {
    title: "Unsaved changes",
    kind: "warning",
    okLabel: "Discard changes",
    cancelLabel: "Keep editing",
  });
}

export async function openPath(path: string): Promise<boolean> {
  try {
    if (!(await okToReplace())) return false;
    const bytes = await api.readFile(path);
    const name = fileName(path);
    const loaded = await loadWithPassword(bytes, name);
    if (!loaded) return false;
    { const old = docStore.get(); if (old) closePdf(old.pdf); }
    undoStack = [];
    docStore.set({
      path,
      name,
      bytes,
      pdf: loaded.pdf,
      pages: loaded.pdf.numPages,
      password: loaded.password,
      dirty: false,
      edits: [],
      rev: 1,
    });
    remember(path);
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}

export async function pickPdfs(multiple: boolean, title = "Open PDF"): Promise<string[]> {
  const r = await open({ multiple, title, filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (!r) return [];
  return Array.isArray(r) ? r : [r];
}

export async function openDialog(): Promise<boolean> {
  try {
    const [p] = await pickPdfs(false);
    return p ? openPath(p) : false;
  } catch (e) {
    toastError(e);
    return false;
  }
}

// ---------- editing ----------

/**
 * Replace the open document with edited bytes (from a tool). The previous
 * version goes on the undo stack.
 */
export async function applyEdit(bytes: Uint8Array, what: string): Promise<boolean> {
  const d = docStore.get();
  if (!d) return false;
  try {
    const pdf = await loadPdf(bytes, d.password);
    undoStack.push({ bytes: d.bytes, edits: d.edits, pages: d.pages });
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    closePdf(d.pdf);
    docStore.set({ ...d, bytes, pdf, pages: pdf.numPages, dirty: true, edits: [...d.edits, what], rev: d.rev + 1 });
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}

export const canUndo = () => undoStack.length > 0;

export async function undo(): Promise<void> {
  const d = docStore.get();
  const prev = undoStack.pop();
  if (!d || !prev) return;
  try {
    const pdf = await loadPdf(prev.bytes, d.password);
    closePdf(d.pdf);
    docStore.set({
      ...d,
      bytes: prev.bytes,
      pdf,
      pages: pdf.numPages,
      edits: prev.edits,
      dirty: undoStack.length > 0 || prev.edits.length > 0,
      rev: d.rev + 1,
    });
    toast("Undone");
  } catch (e) {
    toastError(e);
  }
}

// ---------- saving ----------

/** Ask where to save; defaults to "name (edited).pdf" next to the original. */
export async function pickSavePath(defaultPath: string, kind = "PDF", ext = "pdf"): Promise<string | null> {
  const p = await save({ defaultPath, filters: [{ name: kind, extensions: [ext] }] });
  return p ?? null;
}

export async function saveAs(): Promise<string | null> {
  const d = docStore.get();
  if (!d) return null;
  try {
    const target = await pickSavePath(siblingPath(d.path, "edited"));
    if (!target) return null;
    await api.writeFile(target, d.bytes);
    docStore.set({ ...d, path: target, name: fileName(target), dirty: false });
    remember(target);
    toast(`Saved ${fileName(target)}`);
    return target;
  } catch (e) {
    toastError(e);
    return null;
  }
}

/** Write over the file it came from (asks first). */
export async function saveOver(): Promise<boolean> {
  const d = docStore.get();
  if (!d) return false;
  try {
    const { ask } = await import("@tauri-apps/plugin-dialog");
    const ok = await ask(`Replace ${d.name} with the edited version? The original can't be brought back.`, {
      title: "Save over the original",
      kind: "warning",
      okLabel: "Replace",
      cancelLabel: "Cancel",
    });
    if (!ok) return false;
    await api.writeFile(d.path, d.bytes);
    docStore.set({ ...d, dirty: false });
    toast(`Saved ${d.name}`);
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}

/** Save output that isn't the open document (merge, split, convert...). */
export async function saveBytes(bytes: Uint8Array, defaultPath: string, kind = "PDF", ext = "pdf"): Promise<string | null> {
  try {
    const target = await pickSavePath(defaultPath, kind, ext);
    if (!target) return null;
    await api.writeFile(target, bytes);
    toast(`Saved ${fileName(target)}`);
    return target;
  } catch (e) {
    toastError(e);
    return null;
  }
}

export function closeDoc() {
  { const old = docStore.get(); if (old) closePdf(old.pdf); }
  undoStack = [];
  docStore.set(null);
}
