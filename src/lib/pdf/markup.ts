// Comment and markup annotations that pdf.js's editor can't make: sticky
// notes, underline, strike-through, rectangles, ellipses, lines, arrows and
// rubber stamps. Each is a real PDF annotation with its own appearance
// stream, so Acrobat, Chrome, Preview and pdf.js all show it, and it can be
// selected, moved or deleted in any of them. Positions arrive in PDF user
// space (the UI converts from the screen with pdf.js).

import { PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, StandardFonts, type PDFDocument, type PDFObject } from "@cantoo/pdf-lib";
import { load, saveDoc, type LoadOpts } from "./ops";

export type RGB = [number, number, number];

/** Values pdf-lib turns into PDF objects (strings become names). */
type Lit = string | number | boolean | Lit[] | { [key: string]: Lit } | PDFObject;

interface Common {
  /** 0-based page. */
  page: number;
  color: RGB;
  /** Shown as the author in comment lists (Acrobat's "T"). */
  author?: string;
  /** The comment text attached to the mark. */
  note?: string;
}

export interface ShapeMark extends Common {
  kind: "square" | "circle";
  /** x1, y1, x2, y2 (any corner order). */
  rect: [number, number, number, number];
  width: number;
  opacity?: number;
}

export interface LineMark extends Common {
  kind: "line" | "arrow";
  from: [number, number];
  to: [number, number];
  width: number;
  opacity?: number;
}

export interface TextMarkupMark extends Common {
  kind: "underline" | "strikeout";
  /** One quad per line of text: 8 numbers, upper-left, upper-right, lower-left, lower-right (x, y each). */
  quads: number[][];
}

export interface NoteMark extends Common {
  kind: "note";
  /** Where the note icon's top-left corner goes. */
  at: [number, number];
  note: string;
}

export interface StampMark extends Common {
  kind: "stamp";
  /** The stamp's text, e.g. "APPROVED". */
  label: string;
  /** Optional second line, e.g. a date. */
  sub?: string;
  /** Centre of the stamp. */
  at: [number, number];
}

export type Mark = ShapeMark | LineMark | TextMarkupMark | NoteMark | StampMark;

const SUBTYPE: Record<Mark["kind"], string> = {
  square: "Square",
  circle: "Circle",
  line: "Line",
  arrow: "Line",
  underline: "Underline",
  strikeout: "StrikeOut",
  note: "Text",
  stamp: "Stamp",
};

const n = (v: number) => (Math.round(v * 1000) / 1000).toString();
const rgbOp = (c: RGB, stroke: boolean) => `${n(c[0])} ${n(c[1])} ${n(c[2])} ${stroke ? "RG" : "rg"}`;

/** A random id for /NM, like Acrobat's. */
function newId(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return `deskfolio-${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/** Bounding box of points, grown by `pad` on every side. */
function bounds(points: [number, number][], pad: number): [number, number, number, number] {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
}

/** Ellipse inside the box (x, y, w, h) as four Bézier curves. */
function ellipsePath(x: number, y: number, w: number, h: number): string {
  const k = 0.5523;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = w / 2;
  const ry = h / 2;
  return [
    `${n(cx + rx)} ${n(cy)} m`,
    `${n(cx + rx)} ${n(cy + ry * k)} ${n(cx + rx * k)} ${n(cy + ry)} ${n(cx)} ${n(cy + ry)} c`,
    `${n(cx - rx * k)} ${n(cy + ry)} ${n(cx - rx)} ${n(cy + ry * k)} ${n(cx - rx)} ${n(cy)} c`,
    `${n(cx - rx)} ${n(cy - ry * k)} ${n(cx - rx * k)} ${n(cy - ry)} ${n(cx)} ${n(cy - ry)} c`,
    `${n(cx + rx * k)} ${n(cy - ry)} ${n(cx + rx)} ${n(cy - ry * k)} ${n(cx + rx)} ${n(cy)} c`,
  ].join("\n");
}

interface Built {
  rect: [number, number, number, number];
  /** Appearance drawn in page coordinates (BBox = rect). */
  content: string;
  extra: { [key: string]: Lit };
  /** Uses the bold font as /F1. */
  font?: boolean;
  opacity?: number;
}

async function build(doc: PDFDocument, m: Mark, fontRef: () => Promise<PDFRef>): Promise<Built> {
  switch (m.kind) {
    case "square":
    case "circle": {
      const [x1, y1, x2, y2] = m.rect;
      const x = Math.min(x1, x2);
      const y = Math.min(y1, y2);
      const w = Math.abs(x2 - x1);
      const h = Math.abs(y2 - y1);
      const hw = m.width / 2;
      const path = m.kind === "square" ? `${n(x + hw)} ${n(y + hw)} ${n(Math.max(0, w - m.width))} ${n(Math.max(0, h - m.width))} re` : ellipsePath(x + hw, y + hw, Math.max(0, w - m.width), Math.max(0, h - m.width));
      return {
        rect: [x, y, x + w, y + h],
        content: `${rgbOp(m.color, true)} ${n(m.width)} w ${path} S`,
        extra: { BS: { W: m.width, S: "S" } },
        opacity: m.opacity,
      };
    }
    case "line":
    case "arrow": {
      const [x1, y1] = m.from;
      const [x2, y2] = m.to;
      let head = "";
      if (m.kind === "arrow") {
        // An open arrowhead at the end point, sized by the line width.
        const len = Math.max(9, m.width * 4.5);
        const ang = Math.atan2(y2 - y1, x2 - x1);
        const a1 = ang + Math.PI - 0.45;
        const a2 = ang + Math.PI + 0.45;
        head = ` ${n(x2 + len * Math.cos(a1))} ${n(y2 + len * Math.sin(a1))} m ${n(x2)} ${n(y2)} l ${n(x2 + len * Math.cos(a2))} ${n(y2 + len * Math.sin(a2))} l S`;
      }
      const pad = m.width + (m.kind === "arrow" ? Math.max(9, m.width * 4.5) : 2);
      return {
        rect: bounds([m.from, m.to], pad),
        content: `${rgbOp(m.color, true)} ${n(m.width)} w 1 J 1 j ${n(x1)} ${n(y1)} m ${n(x2)} ${n(y2)} l S${head}`,
        extra: { L: [x1, y1, x2, y2], LE: ["None", m.kind === "arrow" ? "OpenArrow" : "None"], BS: { W: m.width, S: "S" } },
        opacity: m.opacity,
      };
    }
    case "underline":
    case "strikeout": {
      const pts: [number, number][] = [];
      const ops: string[] = [rgbOp(m.color, true)];
      for (const q of m.quads) {
        const [ulx, uly, urx, ury, llx, lly, lrx, lry] = q;
        pts.push([ulx, uly], [urx, ury], [llx, lly], [lrx, lry]);
        const height = Math.hypot(ulx - llx, uly - lly);
        const t = Math.max(0.5, height / 14);
        // Underline sits just above the bottom edge; strike-out through the middle.
        const f = m.kind === "underline" ? 0.08 : 0.42;
        const sx = llx + (ulx - llx) * f;
        const sy = lly + (uly - lly) * f;
        const ex = lrx + (urx - lrx) * f;
        const ey = lry + (ury - lry) * f;
        ops.push(`${n(t)} w ${n(sx)} ${n(sy)} m ${n(ex)} ${n(ey)} l S`);
      }
      return { rect: bounds(pts, 1), content: ops.join("\n"), extra: { QuadPoints: m.quads.flat() } };
    }
    case "note": {
      // A 20 x 20 note icon in the chosen colour.
      const [x, top] = m.at;
      const s = 20;
      const y = top - s;
      const lines = [0.62, 0.45, 0.28].map((f) => `${n(x + 4.5)} ${n(y + s * f)} m ${n(x + s - 4.5)} ${n(y + s * f)} l`).join(" ");
      return {
        rect: [x, y, x + s, y + s],
        content: `${rgbOp(m.color, false)} 0.25 0.25 0.25 RG 0.8 w ${n(x + 0.5)} ${n(y + 0.5)} ${n(s - 1)} ${n(s - 1)} re B 0.15 0.15 0.15 RG 1.1 w ${lines} S`,
        extra: { Name: "Comment", Open: false },
      };
    }
    case "stamp": {
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      const size = 15;
      const subSize = 8;
      const tw = font.widthOfTextAtSize(m.label, size);
      const sw = m.sub ? font.widthOfTextAtSize(m.sub, subSize) : 0;
      const w = Math.max(tw, sw) + 24;
      const h = m.sub ? 38 : 28;
      const [cx, cy] = m.at;
      const x = cx - w / 2;
      const y = cy - h / 2;
      const label = font.encodeText(m.label).toString();
      const sub = m.sub ? font.encodeText(m.sub).toString() : "";
      const ty = m.sub ? y + h - 8 - size * 0.75 : y + (h - size * 0.7) / 2;
      const r = 4;
      const box = [
        `${n(x + r)} ${n(y)} m ${n(x + w - r)} ${n(y)} l ${n(x + w)} ${n(y)} ${n(x + w)} ${n(y + r)} v`,
        `${n(x + w)} ${n(y + h - r)} l ${n(x + w)} ${n(y + h)} ${n(x + w - r)} ${n(y + h)} v`,
        `${n(x + r)} ${n(y + h)} l ${n(x)} ${n(y + h)} ${n(x)} ${n(y + h - r)} v`,
        `${n(x)} ${n(y + r)} l ${n(x)} ${n(y)} ${n(x + r)} ${n(y)} v h`,
      ].join(" ");
      const text = [
        `BT /F1 ${size} Tf ${rgbOp(m.color, false)} ${n(cx - tw / 2)} ${n(ty)} Td ${label} Tj ET`,
        m.sub ? `BT /F1 ${subSize} Tf ${rgbOp(m.color, false)} ${n(cx - sw / 2)} ${n(y + 7)} Td ${sub} Tj ET` : "",
      ].join("\n");
      await fontRef();
      return {
        rect: [x, y, x + w, y + h],
        content: `${rgbOp(m.color, true)} 2 w ${box} S\n${text}`,
        extra: { Name: m.label.replace(/[^A-Za-z]/g, "") || "Draft" },
        font: true,
        opacity: 0.85,
      };
    }
  }
}

/** Add marks to a PDF; returns the new bytes. */
export async function addMarks(bytes: Uint8Array, marks: Mark[], opts: LoadOpts = {}): Promise<Uint8Array> {
  const doc = await load(bytes, opts);
  const ctx = doc.context;
  const pages = doc.getPages();
  let boldRef: PDFRef | null = null;
  const fontRef = async () => {
    if (!boldRef) boldRef = (await doc.embedFont(StandardFonts.HelveticaBold)).ref;
    return boldRef;
  };
  const now = PDFString.fromDate(new Date());
  for (const m of marks) {
    const page = pages[m.page];
    if (!page) throw new Error(`There is no page ${m.page + 1}.`);
    const b = await build(doc, m, fontRef);
    const [x1, y1, x2, y2] = b.rect;
    const resources: { [key: string]: Lit } = {};
    if (b.font) resources.Font = { F1: await fontRef() };
    if (b.opacity !== undefined && b.opacity < 1) resources.ExtGState = { G0: ctx.obj({ CA: b.opacity, ca: b.opacity }) };
    const gs = b.opacity !== undefined && b.opacity < 1 ? "/G0 gs " : "";
    const ap = ctx.stream(`q ${gs}${b.content} Q`, { Type: "XObject", Subtype: "Form", BBox: [x1, y1, x2, y2], Resources: resources });
    const annot = ctx.obj({
      Type: "Annot",
      Subtype: SUBTYPE[m.kind],
      Rect: [x1, y1, x2, y2],
      C: m.color,
      F: 4,
      P: page.ref,
      AP: { N: ctx.register(ap) },
      ...b.extra,
      ...(b.opacity !== undefined ? { CA: b.opacity } : {}),
    });
    annot.set(PDFName.of("NM"), PDFString.of(newId()));
    annot.set(PDFName.of("M"), now);
    annot.set(PDFName.of("CreationDate"), now);
    if (m.author) annot.set(PDFName.of("T"), PDFHexString.fromText(m.author));
    if (m.note) annot.set(PDFName.of("Contents"), PDFHexString.fromText(m.note));
    page.node.addAnnot(ctx.register(annot));
  }
  return saveDoc(doc);
}

/** The stamps offered in the ribbon. */
export const STAMPS: { label: string; color: RGB }[] = [
  { label: "APPROVED", color: [0.1, 0.5, 0.2] },
  { label: "NOT APPROVED", color: [0.8, 0.15, 0.1] },
  { label: "DRAFT", color: [0.15, 0.3, 0.7] },
  { label: "CONFIDENTIAL", color: [0.8, 0.15, 0.1] },
  { label: "RECEIVED", color: [0.15, 0.3, 0.7] },
  { label: "PAID", color: [0.1, 0.5, 0.2] },
  { label: "FINAL", color: [0.1, 0.5, 0.2] },
  { label: "FOR REVIEW", color: [0.75, 0.45, 0.05] },
];

/** Selection rectangles come per text run; join runs on the same line into one quad. */
export function mergeLines(quads: number[][]): number[][] {
  const out: number[][] = [];
  for (const q of quads) {
    const last = out[out.length - 1];
    // Same line: tops and bottoms within 2 pt, and the new run starts near the last one's end.
    if (last && Math.abs(last[1] - q[1]) < 2 && Math.abs(last[5] - q[5]) < 2 && q[0] <= last[2] + 6 && q[2] >= last[0] - 6) {
      const x0 = Math.min(last[0], q[0]);
      const x1 = Math.max(last[2], q[2]);
      out[out.length - 1] = [x0, last[1], x1, last[3], x0, last[5], x1, last[7]];
    } else out.push(q);
  }
  return out;
}

// ---------- links ----------

export type LinkTarget = { url: string } | { page: number };

/** Only web and mail links; anything else (file:, javascript:…) is refused. */
export function cleanUrl(text: string): string | null {
  const t = text.trim();
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(t)) return t;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

/** Add a clickable area that opens a web address or goes to a page. */
export async function addLink(bytes: Uint8Array, pageIndex: number, rect: [number, number, number, number], target: LinkTarget, opts: LoadOpts = {}): Promise<Uint8Array> {
  const doc = await load(bytes, opts);
  const pages = doc.getPages();
  const page = pages[pageIndex];
  if (!page) throw new Error(`There is no page ${pageIndex + 1}.`);
  const ctx = doc.context;
  const [x1, y1, x2, y2] = rect;
  let action: PDFObject;
  if ("url" in target) {
    const url = cleanUrl(target.url);
    if (!url) throw new Error("Use a web address (https://…) or an email (mailto:…).");
    action = ctx.obj({ S: "URI", URI: PDFString.of(url) });
  } else {
    const dest = pages[target.page];
    if (!dest) throw new Error(`There is no page ${target.page + 1}.`);
    action = ctx.obj({ S: "GoTo", D: [dest.ref, "XYZ", null, null, null] });
  }
  const annot = ctx.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)],
    Border: [0, 0, 0],
    F: 4,
    P: page.ref,
    A: action,
  });
  page.node.addAnnot(ctx.register(annot));
  return saveDoc(doc);
}

/** Remove every link whose area contains the point (PDF user space); returns how many. */
export async function removeLinksAt(bytes: Uint8Array, pageIndex: number, x: number, y: number, opts: LoadOpts = {}): Promise<{ bytes: Uint8Array; removed: number }> {
  const doc = await load(bytes, opts);
  const page = doc.getPages()[pageIndex];
  if (!page) throw new Error(`There is no page ${pageIndex + 1}.`);
  const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (!annots) return { bytes, removed: 0 };
  const keep: PDFObject[] = [];
  let removed = 0;
  for (const ref of annots.asArray()) {
    const a = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
    const isLink = a instanceof PDFDict && a.lookupMaybe(PDFName.of("Subtype"), PDFName)?.decodeText() === "Link";
    const r = a instanceof PDFDict ? a.lookupMaybe(PDFName.of("Rect"), PDFArray)?.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : NaN)) : undefined;
    const inside = !!r && r.length === 4 && x >= Math.min(r[0], r[2]) && x <= Math.max(r[0], r[2]) && y >= Math.min(r[1], r[3]) && y <= Math.max(r[1], r[3]);
    if (isLink && inside) removed++;
    else keep.push(ref);
  }
  if (!removed) return { bytes, removed: 0 };
  page.node.set(PDFName.of("Annots"), doc.context.obj(keep));
  return { bytes: await saveDoc(doc), removed };
}
