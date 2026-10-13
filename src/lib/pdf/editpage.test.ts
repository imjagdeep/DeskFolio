import { PDFDocument, rgb, StandardFonts } from "@cantoo/pdf-lib";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { CantEdit, closestFont, deleteImage, listImages, moveImage, replaceImage, replaceTextRun, type Run } from "./editpage";

const FONTS = fileURLToPath(new URL("../../../node_modules/pdfjs-dist/standard_fonts/", import.meta.url)).split("\\").join("/");
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

async function sample(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const font = await doc.embedFont(StandardFonts.TimesRomanBold);
  page.drawText("Total due: 900 CAD", { x: 40, y: 300, size: 14, font, color: rgb(0.8, 0, 0) });
  page.drawText("Thank you", { x: 40, y: 270, size: 14, font });
  const img = await doc.embedPng(PNG);
  page.drawImage(img, { x: 100, y: 50, width: 120, height: 80 });
  return doc.save();
}

/** Text runs as pdf.js sees them (user space). */
async function runs(bytes: Uint8Array) {
  const pdf = await getDocument({ data: bytes.slice(), standardFontDataUrl: FONTS }).promise;
  const tc = await (await pdf.getPage(1)).getTextContent();
  await pdf.loadingTask.destroy();
  return tc.items.flatMap((it) => ("str" in it && it.str.trim() ? [{ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height }] : []));
}

describe("editing text", () => {
  it("replaces one line, keeping its place, size, colour and a close font; other lines untouched", async () => {
    const before = await runs(await sample());
    const target = before.find((r) => r.str.startsWith("Total"));
    if (!target) throw new Error("no Total line");
    const run: Run = target;
    const out = await replaceTextRun(await sample(), 0, run, "Total due: 950 CAD");
    expect(out.font).toBe(StandardFonts.TimesRomanBold);
    const after = await runs(out.bytes);
    expect(after.map((r) => r.str)).toEqual(expect.arrayContaining(["Total due: 950 CAD", "Thank you"]));
    expect(after.some((r) => r.str.includes("900"))).toBe(false);
    const moved = after.find((r) => r.str.startsWith("Total"));
    if (!moved) throw new Error("line gone");
    expect(moved.x).toBeCloseTo(run.x, 3);
    expect(moved.y).toBeCloseTo(run.y, 3);
    expect(moved.h).toBeCloseTo(run.h, 3);
  });

  it("deletes a line when the new text is empty", async () => {
    const run = (await runs(await sample())).find((r) => r.str === "Thank you");
    if (!run) throw new Error("no Thank you line");
    const after = await runs((await replaceTextRun(await sample(), 0, run, "")).bytes);
    expect(after.map((r) => r.str)).toEqual(["Total due: 900 CAD"]);
  });

  it("refuses text it can't find instead of guessing", async () => {
    await expect(replaceTextRun(await sample(), 0, { x: 300, y: 20, w: 50, h: 10 }, "x")).rejects.toBeInstanceOf(CantEdit);
  });

  it("picks the closest standard font", () => {
    expect(closestFont("ABCDEF+Arial-BoldMT")).toBe(StandardFonts.HelveticaBold);
    expect(closestFont("TimesNewRomanPS-ItalicMT")).toBe(StandardFonts.TimesRomanItalic);
    expect(closestFont("CourierNewPSMT")).toBe(StandardFonts.Courier);
    expect(closestFont("OpenSans-Regular")).toBe(StandardFonts.Helvetica);
  });
});

describe("editing images", () => {
  it("finds, moves, resizes, replaces and deletes an image", async () => {
    const bytes = await sample();
    const [img] = await listImages(bytes, 0);
    expect(img.box.map(Math.round)).toEqual([100, 50, 220, 130]);

    const moved = await moveImage(bytes, 0, img.index, 30, -20, 0.5);
    const [m] = await listImages(moved, 0);
    // Half size around the same centre (160, 90), then moved by (30, -20): centre (190, 70).
    expect(m.box.map((v) => Math.round(v))).toEqual([160, 50, 220, 90]);

    const swapped = await replaceImage(bytes, 0, img.index, PNG, "image/png");
    const [s] = await listImages(swapped, 0);
    expect(s.name).not.toBe(img.name);
    expect(s.box.map(Math.round)).toEqual([100, 50, 220, 130]);

    const gone = await deleteImage(bytes, 0, img.index);
    expect(await listImages(gone, 0)).toEqual([]);
    // Text survives image edits.
    expect((await runs(gone)).map((r) => r.str)).toContain("Thank you");
  });
});
