import { degrees, PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { addOverlays, cropPages, fillTemplate, insertBlank, marginsToUser, readProperties, toUser, writeBookmarks, writeProperties, type TextOverlay } from "./pagetools";

/** Pages 1–3: A4 portrait, the second turned 90°, the third with body text. */
async function sample(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  doc.addPage([595, 842]).setRotation(degrees(90));
  const p3 = doc.addPage([595, 842]);
  p3.drawText("Body text", { x: 72, y: 700, size: 12, font: await doc.embedFont(StandardFonts.Helvetica) });
  return doc.save();
}

/** Text items on a page as seen (pdf.js viewport at scale 1, origin top-left). */
async function seen(bytes: Uint8Array, pageNo: number) {
  const pdf = await getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false, standardFontDataUrl: FONTS }).promise;
  const page = await pdf.getPage(pageNo);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const out: { str: string; x: number; y: number; w: number; h: number }[] = [];
  for (const it of tc.items) {
    if (!("str" in it) || !it.str.trim()) continue;
    const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
    out.push({ str: it.str, x, y, w: vp.width, h: vp.height });
  }
  await pdf.loadingTask.destroy();
  return out;
}

/** pdf.js's standard fonts, as a folder path with a trailing slash (Node). */
const FONTS = fileURLToPath(new URL("../../../node_modules/pdfjs-dist/standard_fonts/", import.meta.url)).split("\\").join("/");

const footer: TextOverlay = { kind: "text", text: "Page {page} of {pages}", spot: "bc", font: "Helvetica", size: 10, color: [0, 0, 0], opacity: 1, angle: 0, margin: 24, behind: false };

describe("overlays", () => {
  it("fills in page numbers, Bates numbers, file and date", () => {
    const o = { bates: { prefix: "ABC-", digits: 6, start: 41 }, fileName: "lease.pdf", date: new Date(2026, 9, 12) };
    expect(fillTemplate("{bates} · {page}/{pages} · {file} · {date}", 3, 9, o, 2)).toBe("ABC-000043 · 3/9 · lease.pdf · 12 Oct 2026");
  });

  it("maps 'as seen' points to the page's own space for every rotation", () => {
    const f = { x0: 0, y0: 0, w: 595, h: 842 };
    // The visible bottom-left corner of a page turned 90° clockwise is its top-left in its own space... at (w, 0).
    expect(toUser({ ...f, rot: 0 }, 10, 20)).toEqual([10, 20]);
    expect(toUser({ ...f, rot: 90 }, 0, 0)).toEqual([595, 0]);
    expect(toUser({ ...f, rot: 180 }, 0, 0)).toEqual([595, 842]);
    expect(toUser({ ...f, rot: 270 }, 0, 0)).toEqual([0, 842]);
  });

  it("puts a footer at the bottom centre of every page as seen, rotated pages too", async () => {
    const out = await addOverlays(await sample(), [footer]);
    for (const [no, label] of [[1, "Page 1 of 3"], [2, "Page 2 of 3"], [3, "Page 3 of 3"]] as const) {
      const items = await seen(out, no);
      const f = items.find((i) => i.str === label);
      expect(f, `page ${no}`).toBeTruthy();
      // Near the bottom edge, roughly centred, upright (left of centre where it starts).
      expect(f!.y).toBeGreaterThan(f!.h - 40);
      expect(f!.y).toBeLessThan(f!.h - 15);
      expect(f!.x).toBeGreaterThan(f!.w / 2 - 60);
      expect(f!.x).toBeLessThan(f!.w / 2);
    }
    // The rotated page is seen landscape.
    expect((await seen(out, 2))[0].w).toBe(842);
  });

  it("only marks the chosen pages and numbers them from startAt", async () => {
    const out = await addOverlays(await sample(), [footer], { pages: [1, 2], startAt: 5 });
    expect((await seen(out, 1)).some((i) => i.str.startsWith("Page"))).toBe(false);
    expect((await seen(out, 2)).map((i) => i.str)).toContain("Page 5 of 2");
    expect((await seen(out, 3)).map((i) => i.str)).toContain("Page 6 of 2");
  });

  it("keeps the original content and can draw a watermark behind it", async () => {
    const wm: TextOverlay = { ...footer, text: "CONFIDENTIAL", spot: "mc", size: 60, angle: 45, opacity: 0.2, behind: true, margin: 0 };
    const out = await addOverlays(await sample(), [wm], { pages: [2] });
    const items = (await seen(out, 3)).map((i) => i.str);
    expect(items).toContain("Body text");
    expect(items).toContain("CONFIDENTIAL");
    // Behind = drawn first.
    expect(items.indexOf("CONFIDENTIAL")).toBeLessThan(items.indexOf("Body text"));
  });

  it("refuses characters the built-in fonts can't draw", async () => {
    await expect(addOverlays(await sample(), [{ ...footer, text: "ਪੰਨਾ {page}" }])).rejects.toThrow("can't be drawn");
  });
});

describe("crop, blank pages, properties, bookmarks", () => {
  it("maps margins as seen onto the page's own edges", () => {
    const m = { top: 1, right: 2, bottom: 3, left: 4 };
    expect(marginsToUser(m, 0)).toEqual(m);
    expect(marginsToUser(m, 90)).toEqual({ top: 2, right: 3, bottom: 4, left: 1 });
    expect(marginsToUser(m, 180)).toEqual({ top: 3, right: 4, bottom: 1, left: 2 });
  });

  it("crops the visible area and refuses to crop a page away", async () => {
    const out = await cropPages(await sample(), [0], { top: 72, right: 36, bottom: 72, left: 36 });
    const doc = await PDFDocument.load(out);
    const box = doc.getPage(0).getCropBox();
    expect([box.x, box.y, box.width, box.height]).toEqual([36, 72, 523, 698]);
    expect(doc.getPage(1).getCropBox().width).toBe(595);
    await expect(cropPages(await sample(), [0], { top: 400, right: 0, bottom: 420, left: 0 })).rejects.toThrow("almost nothing");
  });

  it("inserts blank pages sized like their neighbour", async () => {
    const out = await insertBlank(await sample(), 1, 2);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(5);
    expect(doc.getPage(1).getSize()).toEqual({ width: 595, height: 842 });
  });

  it("writes and reads document properties", async () => {
    const out = await writeProperties(await sample(), { title: "Lease", author: "Alex", subject: "Flat 3", keywords: "lease, 2026" });
    expect(await readProperties(out)).toEqual({ title: "Lease", author: "Alex", subject: "Flat 3", keywords: "lease 2026" });
  });

  it("writes nested bookmarks that pdf.js reads back with their pages", async () => {
    const out = await writeBookmarks(await sample(), [
      { title: "Intro", page: 0, children: [] },
      { title: "Terms — ਸ਼ਰਤਾਂ", page: 1, children: [{ title: "Rent", page: 2, children: [] }] },
    ]);
    const pdf = await getDocument({ data: out.slice() }).promise;
    const outline = await pdf.getOutline();
    expect(outline.map((o) => o.title)).toEqual(["Intro", "Terms — ਸ਼ਰਤਾਂ"]);
    expect(outline[1].items.map((o) => o.title)).toEqual(["Rent"]);
    const dest = outline[1].items[0].dest;
    expect(Array.isArray(dest)).toBe(true);
    if (Array.isArray(dest)) expect(await pdf.getPageIndex(dest[0])).toBe(2);
    await pdf.loadingTask.destroy();
    // An empty list removes them.
    const none = await writeBookmarks(out, []);
    const pdf2 = await getDocument({ data: none.slice() }).promise;
    expect(await pdf2.getOutline()).toBeNull();
    await pdf2.loadingTask.destroy();
  });
});
