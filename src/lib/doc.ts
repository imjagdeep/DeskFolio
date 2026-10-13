// The open PDFs (one per tab): their bytes (the source of truth for every
// edit), the pdf.js copy used for drawing, an undo stack each, recent files,
// and saving. Everything that says "the document" means the active tab.
//
// Edits never touch the file on disk until you save, and "Save as" (a new
// file next to the original) is the default.

import { open, save } from "@tauri-apps/plugin-dialog";
import { useSyncExternalStore } from "react";
import { api } from "./api";
import { fileName, siblingPath } from "./format";
import { decrypt, encrypt, type Protection } from "./pdf/protect";
import { closePdf, loadPdf, PasswordNeeded, type PDFDocumentProxy } from "./pdfjs";
import { createStore, toast, toastError } from "./store";

export interface OpenDoc {
  /** Stable for the life of the tab. */
  id: number;
  path: string;
  name: string;
  bytes: Uint8Array;
  pdf: PDFDocumentProxy;
  pages: number;
  /** Set when the bytes still need a password to open (only if they couldn't be decrypted on open). */
  password?: string;
  /**
   * The file's password and permissions. The bytes in memory are decrypted
   * on open; this protection is put back on whenever the file is saved.
   */
  protection: Protection | null;
  /** Changed since it was opened or last saved. */
  dirty: boolean;
  /** Short descriptions of the edits, newest last. */
  edits: string[];
  /** Bumped on every change, so views know to redraw. */
  rev: number;
}

interface Tabs {
  docs: OpenDoc[];
  /** The tab shown; null = the Home tab. */
  active: number | null;
}
const tabsStore = createStore<Tabs>({ docs: [], active: null });
const activeOf = (t: Tabs) => t.docs.find((d) => d.id === t.active) ?? null;

// The active document as its own store, so components that only care about
// it don't redraw when another tab changes.
const docStore = createStore<OpenDoc | null>(null);
tabsStore.subscribe(() => {
  const d = activeOf(tabsStore.get());
  if (d !== docStore.get()) docStore.set(d);
});
export const useDoc = () => useSyncExternalStore(docStore.subscribe, docStore.get);
export const currentDoc = () => docStore.get();
export const useTabs = () => useSyncExternalStore(tabsStore.subscribe, tabsStore.get);

/** Replace one document (by id) with a new version of it. */
function putDoc(next: OpenDoc) {
  const t = tabsStore.get();
  tabsStore.set({ ...t, docs: t.docs.map((d) => (d.id === next.id ? next : d)) });
}

/** Earlier versions of each open file, for Undo. */
type UndoEntry = { bytes: Uint8Array; edits: string[]; pages: number };
const undoStacks = new Map<number, UndoEntry[]>();
function stackOf(id: number): UndoEntry[] {
  let st = undoStacks.get(id);
  if (!st) {
    st = [];
    undoStacks.set(id, st);
  }
  return st;
}
const MAX_UNDO = 15;
let nextId = 1;

/** Show a tab (null = Home). */
export function activate(id: number | null) {
  const t = tabsStore.get();
  if (id !== null && !t.docs.some((d) => d.id === id)) return;
  if (t.active !== id) tabsStore.set({ ...t, active: id });
}

/** Ctrl+Tab / Ctrl+Shift+Tab: the next or previous tab, Home included. */
export function cycleTab(dir: 1 | -1) {
  const t = tabsStore.get();
  const order: (number | null)[] = [null, ...t.docs.map((d) => d.id)];
  const at = order.indexOf(t.active);
  activate(order[(at + dir + order.length) % order.length]);
}

/** Move a tab to another position (drag and drop in the tab strip). */
export function moveTab(id: number, to: number) {
  const t = tabsStore.get();
  const from = t.docs.findIndex((d) => d.id === id);
  if (from < 0) return;
  const docs = [...t.docs];
  const [d] = docs.splice(from, 1);
  docs.splice(Math.max(0, Math.min(to, docs.length)), 0, d);
  tabsStore.set({ ...t, docs });
}

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

// ---------- opening and closing ----------

/** True when it is fine to close this document (asks if unsaved). */
async function okToClose(d: OpenDoc): Promise<boolean> {
  if (!d.dirty) return true;
  const { ask } = await import("@tauri-apps/plugin-dialog");
  return ask(`${d.name} has changes that aren't saved. Close it and lose them?`, {
    title: "Unsaved changes",
    kind: "warning",
    okLabel: "Discard changes",
    cancelLabel: "Keep editing",
  });
}

/** Open a PDF in a new tab, or show its tab if it is already open. */
export async function openPath(path: string): Promise<boolean> {
  try {
    const same = tabsStore.get().docs.find((d) => d.path.toLowerCase() === path.toLowerCase());
    if (same) {
      activate(same.id);
      return true;
    }
    const raw = await api.readFile(path);
    const name = fileName(path);
    const loaded = await loadWithPassword(raw, name);
    if (!loaded) return false;
    // Decrypt once; every tool then works on plain bytes, and saving puts the protection back.
    let bytes: Uint8Array = raw;
    let pdf = loaded.pdf;
    let password = loaded.password;
    let protection: Protection | null = null;
    try {
      const plain = await decrypt(raw, loaded.password ?? "");
      if (plain.protection) {
        bytes = plain.bytes;
        protection = plain.protection;
        closePdf(pdf);
        pdf = await loadPdf(bytes);
        password = undefined;
      }
    } catch {
      // An encryption pdf-lib can't undo: the file still opens for reading,
      // tools that change it may refuse it.
      toast(`${name} uses a kind of protection DeskFolio can show but not change.`, true);
    }
    const doc: OpenDoc = {
      id: nextId++,
      path,
      name,
      bytes,
      pdf,
      pages: pdf.numPages,
      password,
      protection,
      dirty: false,
      edits: [],
      rev: 1,
    };
    const t = tabsStore.get();
    tabsStore.set({ docs: [...t.docs, doc], active: doc.id });
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

/** File › Open: one or more PDFs, each in its own tab. */
export async function openDialog(): Promise<boolean> {
  try {
    const paths = await pickPdfs(true);
    let any = false;
    for (const p of paths) any = (await openPath(p)) || any;
    return any;
  } catch (e) {
    toastError(e);
    return false;
  }
}

/**
 * Close a tab (the active one by default), asking first if it has unsaved
 * changes. The tab to its left (or Home) becomes active.
 */
export async function closeDoc(id: number | null = tabsStore.get().active): Promise<boolean> {
  if (id === tabsStore.get().active) await flushPending();
  const t = tabsStore.get();
  const at = t.docs.findIndex((d) => d.id === id);
  if (at < 0) return false;
  const d = t.docs[at];
  if (!(await okToClose(d))) return false;
  closePdf(d.pdf);
  undoStacks.delete(d.id);
  const now = tabsStore.get();
  const docs = now.docs.filter((x) => x.id !== d.id);
  let active = now.active;
  if (active === d.id) active = docs[Math.max(0, at - 1)]?.id ?? null;
  tabsStore.set({ docs, active });
  return true;
}

/** Before the app quits: asks when any tab has unsaved changes. */
export async function okToQuit(): Promise<boolean> {
  await flushPending();
  const dirty = tabsStore.get().docs.filter((d) => d.dirty);
  if (!dirty.length) return true;
  const { ask } = await import("@tauri-apps/plugin-dialog");
  const what = dirty.length === 1 ? `${dirty[0].name} has changes that aren't saved.` : `${dirty.length} documents have changes that aren't saved.`;
  return ask(`${what} Quit and lose them?`, {
    title: "Unsaved changes",
    kind: "warning",
    okLabel: "Quit without saving",
    cancelLabel: "Keep editing",
  });
}

// ---------- editing ----------

/**
 * Marks drawn in the viewer (highlights, notes, drawings...) live in pdf.js
 * until they are written into the file's bytes. The viewer registers how to
 * do that here, and saving, closing and quitting call it first.
 */
let pendingFlush: (() => Promise<void>) | null = null;
export function setPendingFlush(fn: (() => Promise<void>) | null) {
  pendingFlush = fn;
}
export async function flushPending(): Promise<void> {
  if (pendingFlush) await pendingFlush();
}

/**
 * Replace the active document with edited bytes (from a tool). The previous
 * version goes on its undo stack.
 */
export async function applyEdit(bytes: Uint8Array, what: string, id: number | null = tabsStore.get().active): Promise<boolean> {
  const d = tabsStore.get().docs.find((x) => x.id === id);
  if (!d) return false;
  try {
    const pdf = await loadPdf(bytes, d.password);
    const stack = stackOf(d.id);
    stack.push({ bytes: d.bytes, edits: d.edits, pages: d.pages });
    if (stack.length > MAX_UNDO) stack.shift();
    closePdf(d.pdf);
    putDoc({ ...d, bytes, pdf, pages: pdf.numPages, dirty: true, edits: [...d.edits, what], rev: d.rev + 1 });
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}

export function canUndo(): boolean {
  const d = docStore.get();
  return !!d && stackOf(d.id).length > 0;
}

export async function undo(): Promise<void> {
  const d = docStore.get();
  if (!d) return;
  const stack = stackOf(d.id);
  const prev = stack.pop();
  if (!prev) return;
  try {
    const pdf = await loadPdf(prev.bytes, d.password);
    closePdf(d.pdf);
    putDoc({
      ...d,
      bytes: prev.bytes,
      pdf,
      pages: pdf.numPages,
      edits: prev.edits,
      dirty: stack.length > 0 || prev.edits.length > 0,
      rev: d.rev + 1,
    });
    toast("Undone");
  } catch (e) {
    toastError(e);
  }
}

// ---------- saving ----------

/** What goes to disk: the document with its protection put back on. */
async function bytesToSave(d: OpenDoc): Promise<Uint8Array> {
  return d.protection ? encrypt(d.bytes, d.protection) : d.bytes;
}

/** Protect tool: set, change or remove (null) the document's protection. */
export function setProtection(p: Protection | null, what: string) {
  const d = docStore.get();
  if (!d) return;
  putDoc({ ...d, protection: p, dirty: true, edits: [...d.edits, what], rev: d.rev });
}

/** Ask where to save; defaults to "name (edited).pdf" next to the original. */
export async function pickSavePath(defaultPath: string, kind = "PDF", ext = "pdf"): Promise<string | null> {
  const p = await save({ defaultPath, filters: [{ name: kind, extensions: [ext] }] });
  return p ?? null;
}

export async function saveAs(): Promise<string | null> {
  await flushPending();
  const d = docStore.get();
  if (!d) return null;
  try {
    const target = await pickSavePath(siblingPath(d.path, "edited"));
    if (!target) return null;
    await api.writeFile(target, await bytesToSave(d));
    putDoc({ ...d, path: target, name: fileName(target), dirty: false });
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
  await flushPending();
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
    await api.writeFile(d.path, await bytesToSave(d));
    putDoc({ ...d, dirty: false });
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
