// Page-level PDF operations on raw bytes: reorder, rotate, delete, extract,
// insert, merge, split, images to PDF. Pure functions (no UI, no Tauri), so
// they run in the app, in a browser and in vitest alike.

import { degrees, PDFDocument, type PDFPage } from "@cantoo/pdf-lib";

export interface LoadOpts {
  password?: string;
}

export async function load(bytes: Uint8Array, opts: LoadOpts = {}): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { password: opts.password, updateMetadata: false });
}

/** Save with object streams: smaller files, read by every current viewer. */
export async function saveDoc(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save({ useObjectStreams: true });
}

export async function pageCount(bytes: Uint8Array, opts: LoadOpts = {}): Promise<number> {
  return (await load(bytes, opts)).getPageCount();
}

/** One page of the result: which source page (0-based) and extra rotation. */
export interface PagePick {
  index: number;
  /** Added to the page's own rotation; multiple of 90. */
  rotate?: number;
}

function addRotation(page: PDFPage, extra: number) {
  if (!extra) return;
  const now = page.getRotation().angle;
  page.setRotation(degrees((((now + extra) % 360) + 360) % 360));
}

/**
 * Build a new PDF from `picks` (any order, repeats allowed): covers
 * reorder, delete (leave a page out), extract and rotate in one step.
 * Form fields, links and outlines that point at dropped pages go with them.
 */
export async function rebuild(bytes: Uint8Array, picks: PagePick[], opts: LoadOpts = {}): Promise<Uint8Array> {
  if (picks.length === 0) throw new Error("A PDF needs at least one page.");
  const src = await load(bytes, opts);
  const n = src.getPageCount();
  for (const p of picks) {
    if (!Number.isInteger(p.index) || p.index < 0 || p.index >= n) throw new Error(`There is no page ${p.index + 1}.`);
    if ((p.rotate ?? 0) % 90 !== 0) throw new Error("Pages turn in steps of 90°.");
  }
  const out = await PDFDocument.create({ updateMetadata: false });
  copyInfo(src, out);
  const copied = await out.copyPages(src, picks.map((p) => p.index));
  copied.forEach((page, i) => {
    addRotation(page, picks[i].rotate ?? 0);
    out.addPage(page);
  });
  return saveDoc(out);
}

/** Rotate some pages (0-based) in place, keeping everything else. */
export async function rotatePages(bytes: Uint8Array, pages: number[], by: number, opts: LoadOpts = {}): Promise<Uint8Array> {
  if (by % 90 !== 0) throw new Error("Pages turn in steps of 90°.");
  const doc = await load(bytes, opts);
  const all = doc.getPages();
  for (const i of pages) {
    if (i < 0 || i >= all.length) throw new Error(`There is no page ${i + 1}.`);
    addRotation(all[i], by);
  }
  return saveDoc(doc);
}

/** Insert all pages of `other` before page `at` (0-based; = count to append). */
export async function insertPdf(
  bytes: Uint8Array,
  other: Uint8Array,
  at: number,
  opts: LoadOpts = {},
  otherOpts: LoadOpts = {},
): Promise<Uint8Array> {
  const doc = await load(bytes, opts);
  const src = await load(other, otherOpts);
  if (at < 0 || at > doc.getPageCount()) throw new Error("That position is outside the document.");
  const pages = await doc.copyPages(src, src.getPageIndices());
  pages.forEach((p, i) => doc.insertPage(at + i, p));
  return saveDoc(doc);
}

export interface MergeInput {
  bytes: Uint8Array;
  password?: string;
  /** 0-based pages to take; all when missing. */
  pages?: number[];
}

/** Join PDFs in the given order into one. */
export async function merge(inputs: MergeInput[]): Promise<Uint8Array> {
  if (inputs.length === 0) throw new Error("Add at least one PDF.");
  const out = await PDFDocument.create({ updateMetadata: false });
  for (const input of inputs) {
    const src = await load(input.bytes, { password: input.password });
    const idx = input.pages ?? src.getPageIndices();
    const pages = await out.copyPages(src, idx);
    pages.forEach((p) => out.addPage(p));
  }
  return saveDoc(out);
}

/**
 * Parse page ranges as people type them: "1-3, 5, 8-" (1-based, inclusive;
 * an open end runs to the last page). Returns 0-based page lists, one per
 * comma-separated part.
 */
export function parseRanges(text: string, pageCount: number): number[][] {
  const parts = text
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new Error("Type pages like 1-3, 5, 8-.");
  return parts.map((part) => {
    const m = /^(\d*)\s*(?:[-–]\s*(\d*))?$/.exec(part);
    if (!m || (m[1] === "" && (m[2] === undefined || m[2] === ""))) throw new Error(`"${part}" isn't a page or range.`);
    const isRange = part.includes("-") || part.includes("–");
    const from = m[1] === "" ? 1 : Number(m[1]);
    const to = isRange ? (m[2] === undefined || m[2] === "" ? pageCount : Number(m[2])) : from;
    if (from < 1 || to < 1 || from > pageCount || to > pageCount) {
      throw new Error(`"${part}" goes past the last page (${pageCount}).`);
    }
    if (from > to) throw new Error(`"${part}" runs backwards.`);
    return Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i);
  });
}

/** Group pages into chunks of `size` (split every N pages). */
export function everyN(pageCount: number, size: number): number[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error("Split every 1 page or more.");
  const out: number[][] = [];
  for (let i = 0; i < pageCount; i += size) out.push(Array.from({ length: Math.min(size, pageCount - i) }, (_, k) => i + k));
  return out;
}

/** One PDF per group of pages. */
export async function split(bytes: Uint8Array, groups: number[][], opts: LoadOpts = {}): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for (const g of groups) out.push(await rebuild(bytes, g.map((index) => ({ index })), opts));
  return out;
}

export type PageSizeChoice = "fit" | "a4" | "letter";
const SIZES = { a4: [595.28, 841.89], letter: [612, 792] } as const;

export interface ImageInput {
  bytes: Uint8Array;
  /** "image/png" or "image/jpeg" (others are converted before this). */
  type: "image/png" | "image/jpeg";
}

/**
 * One page per image. "fit" makes each page the image's size; A4/Letter
 * centre the image with a margin, turning the page to match the image.
 */
export async function imagesToPdf(images: ImageInput[], size: PageSizeChoice = "fit", marginPt = 24): Promise<Uint8Array> {
  if (images.length === 0) throw new Error("Add at least one image.");
  const out = await PDFDocument.create();
  for (const img of images) {
    const embedded = img.type === "image/png" ? await out.embedPng(img.bytes) : await out.embedJpg(img.bytes);
    const { width: iw, height: ih } = embedded;
    if (size === "fit") {
      const page = out.addPage([iw, ih]);
      page.drawImage(embedded, { x: 0, y: 0, width: iw, height: ih });
      continue;
    }
    const [sw, sh] = SIZES[size];
    const landscape = iw > ih;
    const pw = landscape ? sh : sw;
    const ph = landscape ? sw : sh;
    const page = out.addPage([pw, ph]);
    const scale = Math.min((pw - 2 * marginPt) / iw, (ph - 2 * marginPt) / ih, 1);
    const w = iw * scale;
    const h = ih * scale;
    page.drawImage(embedded, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }
  return saveDoc(out);
}

function copyInfo(from: PDFDocument, to: PDFDocument) {
  const title = from.getTitle();
  const author = from.getAuthor();
  if (title) to.setTitle(title);
  if (author) to.setAuthor(author);
}
