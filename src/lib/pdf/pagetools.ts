// Page tools: watermarks, headers and footers, page numbers and Bates
// numbers (all "overlays"), crop, blank pages, document properties and
// bookmarks. Positions are given as the page is seen (after its /Rotate and
// inside its crop box), so a footer is at the bottom of what you read on any
// page. Pure functions on bytes (no UI), tested in vitest.

import { PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFRef, StandardFonts, type PDFDocument, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
import { load, saveDoc, type LoadOpts } from "./ops";
import { unsupportedChars } from "./stamp";

export type RGB = [number, number, number];
/** Where on the page: top/middle/bottom × left/centre/right. */
export type Spot = "tl" | "tc" | "tr" | "ml" | "mc" | "mr" | "bl" | "bc" | "br";
export type FontName = "Helvetica" | "Helvetica-Bold" | "Times" | "Times-Bold" | "Courier";

const FONTS: Record<FontName, StandardFonts> = {
  Helvetica: StandardFonts.Helvetica,
  "Helvetica-Bold": StandardFonts.HelveticaBold,
  Times: StandardFonts.TimesRoman,
  "Times-Bold": StandardFonts.TimesRomanBold,
  Courier: StandardFonts.Courier,
};

export interface TextOverlay {
  kind: "text";
  /**
   * The text. Fills in {page} (number from `startAt`), {pages} (how many
   * pages get the overlay), {bates} (Bates number), {date}, {file}.
   */
  text: string;
  spot: Spot;
  font: FontName;
  size: number;
  color: RGB;
  /** 0–1. */
  opacity: number;
  /** Degrees, counter-clockwise as seen (watermarks use 45). */
  angle: number;
  /** Distance from the page edge, in points. */
  margin: number;
  /** Under the page content instead of over it. */
  behind: boolean;
}

export interface ImageOverlay {
  kind: "image";
  bytes: Uint8Array;
  type: "image/png" | "image/jpeg";
  spot: Spot;
  /** Width as a share of the page width (0–1). */
  scale: number;
  opacity: number;
  angle: number;
  margin: number;
  behind: boolean;
}

export type Overlay = TextOverlay | ImageOverlay;

export interface OverlayOptions {
  /** 0-based pages to mark; empty = every page. */
  pages?: number[];
  /** {page} of the first marked page. */
  startAt?: number;
  bates?: { prefix: string; digits: number; start: number; suffix?: string };
  /** For {file}. */
  fileName?: string;
  /** For {date}; defaults to today. */
  date?: Date;
}

const n = (v: number) => (Math.round(v * 1000) / 1000).toString();
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "12 Oct 2026": ASCII, so the standard fonts can always draw it. */
export const shortDate = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

/** Fill in the {placeholders} of an overlay text for one page. */
export function fillTemplate(text: string, page: number, pages: number, opts: OverlayOptions, index: number): string {
  const bates = opts.bates ? `${opts.bates.prefix}${String(opts.bates.start + index).padStart(opts.bates.digits, "0")}${opts.bates.suffix ?? ""}` : "";
  return text
    .replace(/\{page\}/g, String(page))
    .replace(/\{pages\}/g, String(pages))
    .replace(/\{bates\}/g, bates)
    .replace(/\{date\}/g, shortDate(opts.date ?? new Date()))
    .replace(/\{file\}/g, opts.fileName ?? "");
}

/** The page as seen: its visible box and rotation. */
interface Frame {
  x0: number;
  y0: number;
  /** Box size in user space. */
  w: number;
  h: number;
  /** Size as seen (swapped for 90/270). */
  vw: number;
  vh: number;
  rot: number;
}

function frameOf(page: PDFPage): Frame {
  const box = page.getCropBox();
  const rot = (((page.getRotation().angle % 360) + 360) % 360) as number;
  const side = rot === 90 || rot === 270;
  return { x0: box.x, y0: box.y, w: box.width, h: box.height, vw: side ? box.height : box.width, vh: side ? box.width : box.height, rot };
}

/** A point as seen (from the visible bottom-left) → PDF user space. */
export function toUser(f: Pick<Frame, "x0" | "y0" | "w" | "h" | "rot">, vx: number, vy: number): [number, number] {
  switch (f.rot) {
    case 90:
      return [f.x0 + f.w - vy, f.y0 + vx];
    case 180:
      return [f.x0 + f.w - vx, f.y0 + f.h - vy];
    case 270:
      return [f.x0 + vy, f.y0 + f.h - vx];
    default:
      return [f.x0 + vx, f.y0 + vy];
  }
}

/** Where a box of (bw, bh) goes for a spot, as seen: its bottom-left corner. */
function place(spot: Spot, f: Frame, bw: number, bh: number, margin: number): [number, number] {
  const col = spot[1];
  const row = spot[0];
  const x = col === "l" ? margin : col === "r" ? f.vw - margin - bw : (f.vw - bw) / 2;
  const y = row === "b" ? margin : row === "t" ? f.vh - margin - bh : (f.vh - bh) / 2;
  return [x, y];
}

/** Put content on a page, over or under what is there, leaving the original untouched. */
function addContent(doc: PDFDocument, page: PDFPage, ops: string, behind: boolean) {
  const ctx = doc.context;
  const ours = ctx.register(ctx.flateStream(`q\n${ops}\nQ`));
  const node = page.node;
  const existing = node.get(PDFName.of("Contents"));
  const list: PDFRef[] = [];
  if (existing instanceof PDFRef) {
    const target = ctx.lookup(existing);
    if (target instanceof PDFArray) target.asArray().forEach((r) => r instanceof PDFRef && list.push(r));
    else list.push(existing);
  } else if (existing instanceof PDFArray) {
    existing.asArray().forEach((r) => r instanceof PDFRef && list.push(r));
  }
  // The original content is wrapped in q/Q so whatever state it leaves can't
  // move or recolour an overlay drawn after it.
  const open = ctx.register(ctx.flateStream("q"));
  const close = ctx.register(ctx.flateStream("Q"));
  const next = behind ? [ours, open, ...list, close] : [open, ...list, close, ours];
  node.set(PDFName.of("Contents"), ctx.obj(next));
}

/** Add overlays (watermark, header/footer, numbers) to pages; returns new bytes. */
export async function addOverlays(bytes: Uint8Array, overlays: Overlay[], opts: OverlayOptions = {}, load_: LoadOpts = {}): Promise<Uint8Array> {
  const doc = await load(bytes, load_);
  const pages = doc.getPages();
  const chosen = opts.pages?.length ? opts.pages : pages.map((_, i) => i);
  for (const p of chosen) if (!pages[p]) throw new Error(`There is no page ${p + 1}.`);
  const fonts = new Map<FontName, PDFFont>();
  const fontFor = async (f: FontName) => {
    let font = fonts.get(f);
    if (!font) {
      font = await doc.embedFont(FONTS[f]);
      fonts.set(f, font);
    }
    return font;
  };
  const images = await Promise.all(overlays.map((o) => (o.kind === "image" ? (o.type === "image/png" ? doc.embedPng(o.bytes) : doc.embedJpg(o.bytes)) : null)));

  for (const [index, p] of chosen.entries()) {
    const page = pages[p];
    const f = frameOf(page);
    const ops: { behind: boolean; text: string }[] = [];
    for (const [oi, o] of overlays.entries()) {
      const a = (o.angle * Math.PI) / 180;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      // Text direction in user space: as seen, plus the page's own rotation.
      const total = a + (f.rot * Math.PI) / 180;
      const tc = Math.cos(total);
      const ts = Math.sin(total);
      const state = doc.context.obj({ Type: "ExtGState", ca: o.opacity, CA: o.opacity });
      const gsName = page.node.newExtGState("DFgs", doc.context.register(state));
      if (o.kind === "text") {
        const text = fillTemplate(o.text, (opts.startAt ?? 1) + index, chosen.length, opts, index);
        if (!text.trim()) continue;
        const bad = unsupportedChars(text);
        if (bad.length) throw new Error(`These characters can't be drawn with the built-in fonts: ${bad.join(" ")}`);
        const font = await fontFor(o.font);
        const fontName = page.node.newFontDictionary("DFf", font.ref);
        const lines = text.split("\n");
        const lh = o.size * 1.2;
        const widths = lines.map((l) => font.widthOfTextAtSize(l, o.size));
        const bw = Math.max(...widths);
        const bh = o.size * 0.72 + lh * (lines.length - 1);
        // The rotated text block's bounding box as seen, so it stays on the page.
        const ew = Math.abs(bw * cos) + Math.abs(bh * sin);
        const eh = Math.abs(bw * sin) + Math.abs(bh * cos);
        const [ex, ey] = place(o.spot, f, ew, eh, o.margin);
        const cx = ex + ew / 2;
        const cy = ey + eh / 2;
        const parts: string[] = [`${gsName.asString()} gs`, `${n(o.color[0])} ${n(o.color[1])} ${n(o.color[2])} rg`, "BT", `${fontName.asString()} ${n(o.size)} Tf`];
        lines.forEach((line, li) => {
          // Each line's start, relative to the block centre, along the text's own axes.
          const align = o.spot[1] === "l" ? -bw / 2 : o.spot[1] === "r" ? bw / 2 - widths[li] : -widths[li] / 2;
          const up = bh / 2 - o.size * 0.72 - li * lh;
          const vx = cx + align * cos - up * sin;
          const vy = cy + align * sin + up * cos;
          const [ux, uy] = toUser(f, vx, vy);
          parts.push(`${n(tc)} ${n(ts)} ${n(-ts)} ${n(tc)} ${n(ux)} ${n(uy)} Tm ${font.encodeText(line).toString()} Tj`);
        });
        parts.push("ET");
        ops.push({ behind: o.behind, text: parts.join("\n") });
      } else {
        const img = images[oi];
        if (!img) continue;
        const iw = f.vw * Math.max(0.02, Math.min(1, o.scale));
        const ih = (iw * img.height) / img.width;
        const ew = Math.abs(iw * cos) + Math.abs(ih * sin);
        const eh = Math.abs(iw * sin) + Math.abs(ih * cos);
        const [ex, ey] = place(o.spot, f, ew, eh, o.margin);
        const cx = ex + ew / 2;
        const cy = ey + eh / 2;
        // Bottom-left corner of the image, rotated about the centre.
        const vx = cx - (iw / 2) * cos + (ih / 2) * sin;
        const vy = cy - (iw / 2) * sin - (ih / 2) * cos;
        const [ux, uy] = toUser(f, vx, vy);
        const name = page.node.newXObject("DFi", img.ref);
        ops.push({
          behind: o.behind,
          text: `${gsName.asString()} gs ${n(iw * tc)} ${n(iw * ts)} ${n(-ih * ts)} ${n(ih * tc)} ${n(ux)} ${n(uy)} cm ${name.asString()} Do`,
        });
      }
    }
    const under = ops.filter((o) => o.behind).map((o) => o.text);
    const over = ops.filter((o) => !o.behind).map((o) => o.text);
    if (under.length) addContent(doc, page, under.join("\n"), true);
    if (over.length) addContent(doc, page, over.join("\n"), false);
  }
  return saveDoc(doc);
}

// ---------- crop ----------

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Margins as seen → the same margins on the page's own (unrotated) edges. */
export function marginsToUser(m: Margins, rot: number): Margins {
  switch (((rot % 360) + 360) % 360) {
    case 90:
      return { top: m.right, right: m.bottom, bottom: m.left, left: m.top };
    case 180:
      return { top: m.bottom, right: m.left, bottom: m.top, left: m.right };
    case 270:
      return { top: m.left, right: m.top, bottom: m.right, left: m.bottom };
    default:
      return m;
  }
}

/**
 * Trim pages by margins (in points, as seen). Only the visible area changes:
 * the content outside stays in the file, like Acrobat's crop.
 */
export async function cropPages(bytes: Uint8Array, pages: number[], margins: Margins, opts: LoadOpts = {}): Promise<Uint8Array> {
  const doc = await load(bytes, opts);
  const all = doc.getPages();
  const chosen = pages.length ? pages : all.map((_, i) => i);
  for (const p of chosen) {
    const page = all[p];
    if (!page) throw new Error(`There is no page ${p + 1}.`);
    const box = page.getCropBox();
    const m = marginsToUser(margins, page.getRotation().angle);
    const w = box.width - m.left - m.right;
    const h = box.height - m.top - m.bottom;
    if (w < 36 || h < 36) throw new Error(`Those margins leave almost nothing of page ${p + 1}.`);
    page.setCropBox(box.x + m.left, box.y + m.bottom, w, h);
  }
  return saveDoc(doc);
}

// ---------- blank pages ----------

/** Insert `count` blank pages before page `at` (0-based; = page count to append), sized like their neighbour. */
export async function insertBlank(bytes: Uint8Array, at: number, count: number, opts: LoadOpts = {}): Promise<Uint8Array> {
  const doc = await load(bytes, opts);
  const total = doc.getPageCount();
  if (at < 0 || at > total) throw new Error("That position is outside the document.");
  const ref = doc.getPage(Math.min(at, total - 1));
  const { width, height } = ref.getSize();
  for (let i = 0; i < Math.max(1, Math.min(500, count)); i++) doc.insertPage(at + i, [width, height]);
  return saveDoc(doc);
}

// ---------- document properties ----------

export interface Properties {
  title: string;
  author: string;
  subject: string;
  keywords: string;
}

export async function readProperties(bytes: Uint8Array, opts: LoadOpts = {}): Promise<Properties> {
  const doc = await load(bytes, opts);
  return { title: doc.getTitle() ?? "", author: doc.getAuthor() ?? "", subject: doc.getSubject() ?? "", keywords: doc.getKeywords() ?? "" };
}

export async function writeProperties(bytes: Uint8Array, p: Properties, opts: LoadOpts = {}): Promise<Uint8Array> {
  const doc = await load(bytes, opts);
  doc.setTitle(p.title, { showInWindowTitleBar: !!p.title });
  doc.setAuthor(p.author);
  doc.setSubject(p.subject);
  doc.setKeywords(p.keywords.split(/[,;]\s*/).filter(Boolean));
  doc.setModificationDate(new Date());
  return saveDoc(doc);
}

// ---------- bookmarks ----------

export interface Bookmark {
  title: string;
  /** 0-based page. */
  page: number;
  children: Bookmark[];
}

/** Replace the document's bookmarks (outline) with `items`. */
export async function writeBookmarks(bytes: Uint8Array, items: Bookmark[], opts: LoadOpts = {}): Promise<Uint8Array> {
  const doc = await load(bytes, opts);
  const ctx = doc.context;
  const pages = doc.getPages();
  const root = ctx.obj({ Type: "Outlines" });
  const rootRef = ctx.register(root);

  // Builds the children of `parent`; returns how many visible descendants.
  const build = (list: Bookmark[], parentRef: PDFRef, parent: PDFDict): number => {
    const refs = list.map(() => ctx.nextRef());
    let count = 0;
    list.forEach((b, i) => {
      const page = pages[Math.max(0, Math.min(pages.length - 1, b.page))];
      const dict = ctx.obj({ Parent: parentRef, Dest: [page.ref, "XYZ", null, null, null] });
      dict.set(PDFName.of("Title"), PDFHexString.fromText(b.title || "Untitled"));
      if (i > 0) dict.set(PDFName.of("Prev"), refs[i - 1]);
      if (i < list.length - 1) dict.set(PDFName.of("Next"), refs[i + 1]);
      if (b.children.length) {
        const sub = build(b.children, refs[i], dict);
        dict.set(PDFName.of("Count"), PDFNumber.of(sub));
        count += sub;
      }
      ctx.assign(refs[i], dict);
      count++;
    });
    if (refs.length) {
      parent.set(PDFName.of("First"), refs[0]);
      parent.set(PDFName.of("Last"), refs[refs.length - 1]);
    }
    return count;
  };
  const total = build(items, rootRef, root);
  root.set(PDFName.of("Count"), PDFNumber.of(total));
  if (items.length) doc.catalog.set(PDFName.of("Outlines"), rootRef);
  else doc.catalog.delete(PDFName.of("Outlines"));
  return saveDoc(doc);
}
