// Editing what's already on a page: a line of text (its instructions are
// removed and the new words drawn in their place, in a standard font close
// to the original, same size and colour) and images (delete, replace, move
// or resize). Positions in PDF user space. Callers check the result with
// pdf.js; anything the content reader can't place is refused, not guessed.

import { decodePDFRawStream, PDFArray, PDFDict, PDFName, PDFRawStream, PDFRef, PDFStream, rgb, StandardFonts, type PDFDocument, type PDFPage } from "@cantoo/pdf-lib";
import { invert, layout, mul, parseContent, replaceOp, withoutOps, type Matrix } from "./content";
import { load, saveDoc, type LoadOpts } from "./ops";
import { unsupportedChars } from "./stamp";

export class CantEdit extends Error {}

/** The page's content streams, decoded and joined. */
function readContent(doc: PDFDocument, page: PDFPage): Uint8Array {
  const contents = page.node.get(PDFName.of("Contents"));
  const refs: unknown[] = [];
  const target = contents instanceof PDFRef ? doc.context.lookup(contents) : contents;
  if (target instanceof PDFArray) refs.push(...target.asArray());
  else if (contents) refs.push(contents);
  const parts: Uint8Array[] = [];
  for (const r of refs) {
    const s = r instanceof PDFRef ? doc.context.lookup(r) : r;
    if (s instanceof PDFRawStream) parts.push(decodePDFRawStream(s).decode());
    else if (s instanceof PDFStream) parts.push(s.getContents());
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length + 1, 0));
  let k = 0;
  for (const p of parts) {
    out.set(p, k);
    k += p.length;
    out[k++] = 10;
  }
  return out;
}

function writeContent(doc: PDFDocument, page: PDFPage, bytes: Uint8Array) {
  page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream(bytes)));
}

/** The page's font resource → its PostScript name (e.g. "ABCDEF+Arial-BoldMT"). */
function baseFont(page: PDFPage, res: string): string {
  const fonts = page.node.Resources()?.lookupMaybe(PDFName.of("Font"), PDFDict);
  const f = fonts?.lookupMaybe(PDFName.of(res), PDFDict);
  return f?.lookupMaybe(PDFName.of("BaseFont"), PDFName)?.decodeText() ?? "";
}

/** The closest of the standard fonts to a font's name. */
export function closestFont(name: string): StandardFonts {
  const bold = /bold|black|heavy|semibold|demi/i.test(name);
  const italic = /italic|oblique/i.test(name);
  if (/times|serif|georgia|garamond|cambria|minion|book|palatino|roman/i.test(name) && !/sans/i.test(name)) {
    return bold && italic ? StandardFonts.TimesRomanBoldItalic : bold ? StandardFonts.TimesRomanBold : italic ? StandardFonts.TimesRomanItalic : StandardFonts.TimesRoman;
  }
  if (/courier|mono|consol|menlo/i.test(name)) {
    return bold && italic ? StandardFonts.CourierBoldOblique : bold ? StandardFonts.CourierBold : italic ? StandardFonts.CourierOblique : StandardFonts.Courier;
  }
  return bold && italic ? StandardFonts.HelveticaBoldOblique : bold ? StandardFonts.HelveticaBold : italic ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica;
}

export interface Run {
  /** Baseline start, width and font height in user space (from pdf.js). */
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Replace one line of text (a pdf.js text run) with `text` ("" deletes it).
 * Returns the new bytes and the font used.
 */
export async function replaceTextRun(bytes: Uint8Array, pageIndex: number, run: Run, text: string, opts: LoadOpts = {}): Promise<{ bytes: Uint8Array; font: string }> {
  const bad = unsupportedChars(text);
  if (bad.length) throw new CantEdit(`These characters can't be drawn with the built-in fonts yet: ${bad.join(" ")}`);
  const doc = await load(bytes, opts);
  const page = doc.getPages()[pageIndex];
  if (!page) throw new Error(`There is no page ${pageIndex + 1}.`);
  const src = readContent(doc, page);
  const ops = parseContent(src);
  const { texts } = layout(ops);
  const tolY = Math.max(1, run.h * 0.35);
  const hits = texts.filter((t) => t.upright && Math.abs(t.y - run.y) <= tolY && t.x >= run.x - run.h * 0.3 && t.x <= run.x + run.w - run.h * 0.2);
  if (!hits.length) {
    throw new CantEdit("This text is drawn in a way DeskFolio can't change (inside a graphic, rotated, or made of shapes). You can cover it with a text box, or redact it.");
  }
  const first = hits.reduce((a, b) => (b.x < a.x ? b : a));
  const fontName = closestFont(baseFont(page, first.font));
  writeContent(doc, page, withoutOps(src, ops, new Set(hits.map((h) => h.index))));
  if (text) {
    const font = await doc.embedFont(fontName);
    const size = first.size || run.h;
    const c = first.color ?? [0, 0, 0];
    page.drawText(text, { x: first.x, y: first.y, size, font, color: rgb(c[0], c[1], c[2]) });
  }
  return { bytes: await saveDoc(doc), font: fontName };
}

// ---------- images ----------

export interface PageImage {
  /** Instruction index (identifies the image for the other functions). */
  index: number;
  name: string;
  /** Bounding box in user space: x0, y0, x1, y1. */
  box: [number, number, number, number];
}

function isImage(page: PDFPage, name: string): boolean {
  const xo = page.node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  const s = xo?.lookup(PDFName.of(name));
  return s instanceof PDFStream && s.dict.lookupMaybe(PDFName.of("Subtype"), PDFName)?.decodeText() === "Image";
}

const boxOf = (ctm: Matrix): [number, number, number, number] => {
  const pts = [
    [ctm[4], ctm[5]],
    [ctm[0] + ctm[4], ctm[1] + ctm[5]],
    [ctm[2] + ctm[4], ctm[3] + ctm[5]],
    [ctm[0] + ctm[2] + ctm[4], ctm[1] + ctm[3] + ctm[5]],
  ];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

/** Images drawn directly on the page (not inside graphics groups). */
export async function listImages(bytes: Uint8Array, pageIndex: number, opts: LoadOpts = {}): Promise<PageImage[]> {
  const doc = await load(bytes, opts);
  const page = doc.getPages()[pageIndex];
  if (!page) throw new Error(`There is no page ${pageIndex + 1}.`);
  const { draws } = layout(parseContent(readContent(doc, page)));
  return draws.filter((d) => isImage(page, d.name)).map((d) => ({ index: d.index, name: d.name, box: boxOf(d.ctm) }));
}

async function withImageOp(
  bytes: Uint8Array,
  pageIndex: number,
  index: number,
  opts: LoadOpts,
  change: (doc: PDFDocument, page: PDFPage, src: Uint8Array, op: ReturnType<typeof parseContent>[number], ctm: Matrix) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  const doc = await load(bytes, opts);
  const page = doc.getPages()[pageIndex];
  if (!page) throw new Error(`There is no page ${pageIndex + 1}.`);
  const src = readContent(doc, page);
  const ops = parseContent(src);
  const draw = layout(ops).draws.find((d) => d.index === index);
  if (!draw || ops[index]?.op !== "Do") throw new CantEdit("That image has changed; select it again.");
  writeContent(doc, page, await change(doc, page, src, ops[index], draw.ctm));
  return saveDoc(doc);
}

export function deleteImage(bytes: Uint8Array, pageIndex: number, index: number, opts: LoadOpts = {}): Promise<Uint8Array> {
  return withImageOp(bytes, pageIndex, index, opts, async (_d, _p, src, op) => replaceOp(src, op, ""));
}

/** Swap the picture, keeping its place and size on the page. */
export function replaceImage(bytes: Uint8Array, pageIndex: number, index: number, image: Uint8Array, type: "image/png" | "image/jpeg", opts: LoadOpts = {}): Promise<Uint8Array> {
  return withImageOp(bytes, pageIndex, index, opts, async (doc, page, src, op) => {
    const img = type === "image/png" ? await doc.embedPng(image) : await doc.embedJpg(image);
    const name = page.node.newXObject("DFimg", img.ref);
    return replaceOp(src, op, `${name.asString()} Do`);
  });
}

/** Move by (dx, dy) and scale by `scale` around the image's centre, in user space. */
export function moveImage(bytes: Uint8Array, pageIndex: number, index: number, dx: number, dy: number, scale = 1, opts: LoadOpts = {}): Promise<Uint8Array> {
  return withImageOp(bytes, pageIndex, index, opts, async (_d, _p, src, op, ctm) => {
    const [x0, y0, x1, y1] = boxOf(ctm);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    // In user space: centre to origin, scale, back, then move.
    const t: Matrix = mul(mul(mul([1, 0, 0, 1, -cx, -cy], [scale, 0, 0, scale, 0, 0]), [1, 0, 0, 1, cx, cy]), [1, 0, 0, 1, dx, dy]);
    // The instruction runs under `ctm`; m × ctm must equal ctm × t.
    const m = mul(mul(ctm, t), invert(ctm));
    const name = op.args[0]?.t === "name" ? op.args[0].v : "";
    return replaceOp(src, op, `q ${m.map((v) => Math.round(v * 1e5) / 1e5).join(" ")} cm /${name} Do Q`);
  });
}
