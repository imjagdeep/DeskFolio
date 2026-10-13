// Redaction: areas marked for removal (per open document), finding text and
// private details to mark, and applying. Applying redraws each affected page
// as a flat picture with black boxes burnt in, so the text, drawings and
// pictures underneath are gone from the file, not just covered. Optionally
// OCR then makes the rest of those pages searchable again.

import { AnnotationMode } from "pdfjs-dist";
import { useSyncExternalStore } from "react";
import { applyEdit, currentDoc, flushPending, type OpenDoc } from "../lib/doc";
import { ocrPdf } from "../lib/ocr";
import { burnPages, type BurntPage } from "../lib/pdf/protect";
import { findHits, type Kind, type TextRun } from "../lib/pdf/redactfind";
import { closePdf, loadPdf } from "../lib/pdfjs";
import { createStore } from "../lib/store";

export interface RedactBox {
  id: number;
  /** 0-based page. */
  page: number;
  /** PDF user space. */
  rect: [number, number, number, number];
  /** What it covers, when known ("alex@example.com", "Area"). */
  label: string;
}

const store = createStore<Record<number, RedactBox[]>>({});
let nextId = 1;
const NONE: RedactBox[] = [];

export function useRedactions(docId: number | null): RedactBox[] {
  return useSyncExternalStore(store.subscribe, () => (docId === null ? NONE : (store.get()[docId] ?? NONE)));
}

export function addRedactions(docId: number, boxes: Omit<RedactBox, "id">[]) {
  const cur = store.get()[docId] ?? [];
  store.set({ ...store.get(), [docId]: [...cur, ...boxes.map((b) => ({ ...b, id: nextId++ }))] });
}

export function removeRedaction(docId: number, id: number) {
  store.set({ ...store.get(), [docId]: (store.get()[docId] ?? []).filter((b) => b.id !== id) });
}

export function clearRedactions(docId: number) {
  const next = { ...store.get() };
  delete next[docId];
  store.set(next);
}

/** Text runs of a page in PDF user space (horizontal text only), with their font family. */
async function runsOf(doc: OpenDoc, pageNo: number): Promise<(TextRun & { family: string })[]> {
  const page = await doc.pdf.getPage(pageNo);
  const tc = await page.getTextContent();
  const out: (TextRun & { family: string })[] = [];
  for (const it of tc.items) {
    if (!("str" in it) || !it.str) continue;
    const [a, b, c, d, e, f] = it.transform;
    // Rotated or skewed runs can't be boxed by proportion; draw those by hand.
    if (Math.abs(b) > 0.01 * Math.abs(a) || Math.abs(c) > 0.01 * Math.abs(d)) continue;
    const family = tc.styles[it.fontName]?.fontFamily ?? "sans-serif";
    out.push({ str: it.str, x: e, y: f, w: it.width, h: it.height || Math.hypot(c, d), family });
  }
  return out;
}

/** Find a phrase and/or private details on every page; returns boxes (not yet added). */
export async function findInDocument(doc: OpenDoc, query: string, kinds: Kind[]): Promise<Omit<RedactBox, "id">[]> {
  const out: Omit<RedactBox, "id">[] = [];
  // Character positions come from measuring the text in its font family on a canvas.
  const ctx = document.createElement("canvas").getContext("2d");
  for (let p = 1; p <= doc.pages; p++) {
    for (const run of await runsOf(doc, p)) {
      const measure = ctx
        ? (t: string) => {
            ctx.font = `40px ${run.family}`;
            return ctx.measureText(t).width;
          }
        : undefined;
      for (const h of findHits([run], query, kinds, measure)) out.push({ page: p - 1, rect: h.rect, label: h.text });
    }
  }
  return out;
}

const DPI = 300;

/** Draw one page as seen at 300 dpi with the boxes painted black. */
async function burnt(doc: OpenDoc, index: number, boxes: RedactBox[]): Promise<BurntPage> {
  const page = await doc.pdf.getPage(index + 1);
  const seen = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: DPI / 72 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't prepare a drawing surface for the page.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport, annotationMode: AnnotationMode.ENABLE }).promise;
  ctx.fillStyle = "#000";
  for (const b of boxes) {
    const [x1, y1]: number[] = viewport.convertToViewportPoint(b.rect[0], b.rect[1]);
    const [x2, y2]: number[] = viewport.convertToViewportPoint(b.rect[2], b.rect[3]);
    ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  }
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.92));
  if (!blob) throw new Error(`Page ${index + 1} couldn't be drawn.`);
  return { index, image: new Uint8Array(await blob.arrayBuffer()), type: "image/jpeg", width: seen.width, height: seen.height };
}

/**
 * Apply the active document's redactions. Returns how many pages were
 * redrawn; the result replaces the document (Undo takes it back).
 */
export async function applyRedactions(opts: { ocr: boolean; onStage?: (s: string) => void }): Promise<number> {
  await flushPending();
  const doc = currentDoc();
  if (!doc) return 0;
  const boxes = store.get()[doc.id] ?? [];
  const pages = [...new Set(boxes.map((b) => b.page))].sort((a, b) => a - b);
  if (!pages.length) return 0;
  const drawn: BurntPage[] = [];
  for (const [i, p] of pages.entries()) {
    opts.onStage?.(`Redrawing page ${p + 1} (${i + 1} of ${pages.length})…`);
    drawn.push(await burnt(doc, p, boxes.filter((b) => b.page === p)));
  }
  opts.onStage?.("Removing the original content…");
  let bytes = await burnPages(doc.bytes, drawn);
  if (opts.ocr) {
    const pdf = await loadPdf(bytes);
    try {
      const r = await ocrPdf(pdf, bytes, { onlyWithoutText: true, onProgress: (n, t, stage) => opts.onStage?.(stage === "loading" ? "Starting text recognition…" : `Recognising text: page ${n + 1} of ${t}…`) });
      bytes = r.bytes;
    } finally {
      closePdf(pdf);
    }
  }
  if (await applyEdit(bytes, `Redacted ${boxes.length} area${boxes.length === 1 ? "" : "s"} on ${pages.length} page${pages.length === 1 ? "" : "s"}`, doc.id)) {
    clearRedactions(doc.id);
    return pages.length;
  }
  return 0;
}
