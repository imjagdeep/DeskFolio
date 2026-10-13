// Batch processing: run the same steps over many PDFs, one at a time.
// Steps always run in one order, so they can't undo each other:
// open (password if needed) → recognise text → watermark → header & footer
// (page numbers, Bates numbers continuing across files) → remove hidden
// info → compress → save as PDF (optionally protected) or convert.
// Originals are never changed; outputs never overwrite an existing file.

import { api } from "./api";
import { toDocx, toText, toXlsx } from "./convert/fromPdf";
import { fileName, parentDir } from "./format";
import { ocrPdf } from "./ocr";
import { addOverlays, type TextOverlay } from "./pdf/pagetools";
import { decrypt, encrypt, sanitize, type Protection, type SanitizeOptions } from "./pdf/protect";
import { closePdf, loadPdf, type PDFDocumentProxy } from "./pdfjs";

export type OutputFormat = "pdf" | "docx" | "xlsx" | "txt";

export interface BatesNumbers {
  prefix: string;
  digits: number;
  start: number;
  suffix?: string;
}

export interface BatchPlan {
  /** Make scanned pages searchable (pages that already have text are left alone). */
  ocr: boolean;
  watermark: TextOverlay | null;
  /** Header/footer text ({page}, {pages}, {bates}, {date}, {file}). */
  stamp: { overlay: TextOverlay; bates: BatesNumbers | null } | null;
  clean: SanitizeOptions | null;
  compress: "light" | "balanced" | "strong" | null;
  format: OutputFormat;
  /** PDF output only. null = keep whatever protection the file had. */
  protect: Protection | null;
  /** Tried on password-protected files ("" opens permission-only files). */
  inputPassword: string;
}

export const EXT: Record<OutputFormat, string> = { pdf: "pdf", docx: "docx", xlsx: "xlsx", txt: "txt" };

/** What a batch run needs from the outside world (swapped in tests). */
export interface BatchDeps {
  compress: (bytes: Uint8Array, preset: "light" | "balanced" | "strong") => Promise<Uint8Array>;
  open: (bytes: Uint8Array) => Promise<PDFDocumentProxy>;
  close: (pdf: PDFDocumentProxy) => void;
  ocr: (pdf: PDFDocumentProxy, bytes: Uint8Array, signal?: AbortSignal) => Promise<{ bytes: Uint8Array; read: number }>;
}

export const realDeps: BatchDeps = {
  compress: (bytes, preset) => api.compressPdf(bytes, preset),
  open: (bytes) => loadPdf(bytes),
  close: closePdf,
  ocr: (pdf, bytes, signal) => ocrPdf(pdf, bytes, { onlyWithoutText: true, signal }),
};

export interface FileResult {
  bytes: Uint8Array;
  /** Pages in the file (for the next file's Bates numbers). */
  pages: number;
  /** Short notes for the log: "3 pages recognised", "smaller by 40%"... */
  notes: string[];
}

export class Stopped extends Error {
  constructor() {
    super("Stopped");
  }
}

async function withPdf<T>(deps: BatchDeps, bytes: Uint8Array, fn: (pdf: PDFDocumentProxy) => Promise<T>): Promise<T> {
  const pdf = await deps.open(bytes);
  try {
    return await fn(pdf);
  } finally {
    deps.close(pdf);
  }
}

/**
 * Run the plan on one file's bytes. `batesStart` is the first Bates number
 * this file gets (the runner carries it from file to file).
 */
export async function processFile(input: Uint8Array, name: string, plan: BatchPlan, deps: BatchDeps, batesStart: number, signal?: AbortSignal): Promise<FileResult> {
  const check = () => {
    if (signal?.aborted) throw new Stopped();
  };
  const notes: string[] = [];
  let opened: { bytes: Uint8Array; protection: Protection | null };
  try {
    opened = await decrypt(input, plan.inputPassword);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/password/i.test(msg)) throw new Error(plan.inputPassword ? "The password doesn't open this file." : "This file needs a password to open (set one under Files).");
    throw e;
  }
  let bytes = opened.bytes;
  const pages = await withPdf(deps, bytes, async (pdf) => pdf.numPages);
  check();

  if (plan.ocr) {
    const r = await withPdf(deps, bytes, (pdf) => deps.ocr(pdf, bytes, signal));
    bytes = r.bytes;
    notes.push(r.read ? `${r.read} page${r.read === 1 ? "" : "s"} recognised` : "already had text");
    check();
  }
  if (plan.watermark) {
    bytes = await addOverlays(bytes, [plan.watermark], { fileName: name });
    check();
  }
  if (plan.stamp) {
    const b = plan.stamp.bates;
    bytes = await addOverlays(bytes, [plan.stamp.overlay], { fileName: name, bates: b ? { ...b, start: batesStart } : undefined });
    if (b) {
      const pad = (n: number) => String(n).padStart(b.digits, "0");
      notes.push(pages > 1 ? `Bates ${b.prefix}${pad(batesStart)}–${b.prefix}${pad(batesStart + pages - 1)}` : `Bates ${b.prefix}${pad(batesStart)}`);
    }
    check();
  }
  if (plan.clean) {
    const r = await sanitize(bytes, plan.clean);
    bytes = r.bytes;
    if (r.removed.length) notes.push("hidden info removed");
    check();
  }
  if (plan.compress) {
    const before = bytes.length;
    bytes = await deps.compress(bytes, plan.compress);
    const saved = before ? Math.round((1 - bytes.length / before) * 100) : 0;
    notes.push(saved > 0 ? `smaller by ${saved}%` : "couldn't be made smaller");
    check();
  }

  switch (plan.format) {
    case "pdf": {
      const protection = plan.protect ?? opened.protection;
      if (protection) {
        bytes = await encrypt(bytes, protection);
        notes.push(plan.protect ? "password set" : "kept its protection");
      }
      return { bytes, pages, notes };
    }
    case "docx":
      return { bytes: (await withPdf(deps, bytes, (pdf) => toDocx(pdf))).bytes, pages, notes };
    case "xlsx": {
      const r = await withPdf(deps, bytes, (pdf) => toXlsx(pdf));
      if (!r.tables) notes.push("no tables found");
      return { bytes: r.bytes, pages, notes };
    }
    case "txt": {
      const r = await withPdf(deps, bytes, (pdf) => toText(pdf));
      return { bytes: new TextEncoder().encode(r.text), pages, notes };
    }
  }
}

/** "report.pdf" → "report (suffix).docx" in `outDir`. */
export function outputPath(input: string, outDir: string, suffix: string, format: OutputFormat): string {
  const name = fileName(input);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const sep = outDir.includes("\\") ? "\\" : "/";
  const tail = suffix.trim() ? ` (${suffix.trim()})` : "";
  return `${outDir.replace(/[\\/]+$/, "")}${sep}${stem}${tail}.${EXT[format]}`;
}

export type FileState =
  | { state: "waiting" }
  | { state: "working" }
  | { state: "done"; output: string; before: number; after: number; notes: string[] }
  | { state: "failed"; error: string }
  | { state: "skipped" };

/** Run the plan over every file, one at a time; a failing file doesn't stop the rest. */
export async function runBatch(
  files: string[],
  plan: BatchPlan,
  /** dir null = next to each original. */
  out: { dir: string | null; suffix: string },
  onFile: (index: number, s: FileState) => void,
  signal: AbortSignal,
  deps: BatchDeps = realDeps,
): Promise<{ done: number; failed: number }> {
  let bates = plan.stamp?.bates?.start ?? 1;
  let done = 0;
  let failed = 0;
  for (let i = 0; i < files.length; i++) {
    if (signal.aborted) {
      for (let j = i; j < files.length; j++) onFile(j, { state: "skipped" });
      break;
    }
    onFile(i, { state: "working" });
    try {
      const input = await api.readFile(files[i]);
      const r = await processFile(input, fileName(files[i]), plan, deps, bates, signal);
      bates += r.pages;
      const target = await api.batchFreePath(outputPath(files[i], out.dir ?? parentDir(files[i]), out.suffix, plan.format));
      await api.writeFile(target, r.bytes);
      done++;
      onFile(i, { state: "done", output: target, before: input.length, after: r.bytes.length, notes: r.notes });
    } catch (e) {
      if (e instanceof Stopped) {
        for (let j = i; j < files.length; j++) onFile(j, { state: "skipped" });
        break;
      }
      failed++;
      onFile(i, { state: "failed", error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { done, failed };
}
