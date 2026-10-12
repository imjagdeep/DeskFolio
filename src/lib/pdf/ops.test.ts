import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { everyN, imagesToPdf, insertPdf, merge, pageCount, parseRanges, rebuild, rotatePages, split } from "./ops";

/** A PDF whose page i (0-based) is (101 + i) points wide: order is visible. */
async function sample(pages: number, offset = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([101 + offset + i, 200]);
  return doc.save();
}

async function widths(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => Math.round(p.getWidth()));
}

async function rotations(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => p.getRotation().angle);
}

// A 1x1 PNG (red) and JPEG, for images to PDF.
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

describe("rebuild", () => {
  it("reorders, drops and rotates in one go", async () => {
    const out = await rebuild(await sample(4), [{ index: 3 }, { index: 0, rotate: 90 }, { index: 2, rotate: -90 }]);
    expect(await widths(out)).toEqual([104, 101, 103]);
    expect(await rotations(out)).toEqual([0, 90, 270]);
  });

  it("refuses empty results, missing pages and odd angles", async () => {
    const s = await sample(2);
    await expect(rebuild(s, [])).rejects.toThrow("at least one page");
    await expect(rebuild(s, [{ index: 5 }])).rejects.toThrow("no page 6");
    await expect(rebuild(s, [{ index: 0, rotate: 45 }])).rejects.toThrow("90");
  });
});

describe("rotatePages", () => {
  it("adds to the existing rotation and wraps around", async () => {
    let b = await rotatePages(await sample(3), [0, 2], 90);
    b = await rotatePages(b, [0], 270);
    expect(await rotations(b)).toEqual([0, 0, 90]);
  });
});

describe("insertPdf", () => {
  it("inserts at the start, middle and end", async () => {
    const base = await sample(2);
    const other = await sample(1, 50);
    expect(await widths(await insertPdf(base, other, 0))).toEqual([151, 101, 102]);
    expect(await widths(await insertPdf(base, other, 1))).toEqual([101, 151, 102]);
    expect(await widths(await insertPdf(base, other, 2))).toEqual([101, 102, 151]);
    await expect(insertPdf(base, other, 3)).rejects.toThrow("outside");
  });
});

describe("merge", () => {
  it("keeps the order and can take some pages only", async () => {
    const out = await merge([{ bytes: await sample(2) }, { bytes: await sample(3, 10), pages: [2, 0] }]);
    expect(await widths(out)).toEqual([101, 102, 113, 111]);
  });
});

describe("parseRanges", () => {
  it("reads what people type", () => {
    expect(parseRanges("1-3, 5, 8-", 9)).toEqual([[0, 1, 2], [4], [7, 8]]);
    expect(parseRanges("-2; 4–4", 5)).toEqual([[0, 1], [3]]);
  });
  it("says what's wrong", () => {
    expect(() => parseRanges("", 5)).toThrow("Type pages");
    expect(() => parseRanges("7", 5)).toThrow("past the last page");
    expect(() => parseRanges("4-2", 5)).toThrow("backwards");
    expect(() => parseRanges("abc", 5)).toThrow("isn't a page");
  });
});

describe("split", () => {
  it("splits every N pages, last part shorter", async () => {
    expect(everyN(5, 2)).toEqual([[0, 1], [2, 3], [4]]);
    const parts = await split(await sample(5), everyN(5, 2));
    expect(await Promise.all(parts.map(widths))).toEqual([[101, 102], [103, 104], [105]]);
    expect(() => everyN(5, 0)).toThrow();
  });
});

describe("imagesToPdf", () => {
  it("one page per image, sized to the image or to A4", async () => {
    const fit = await imagesToPdf([{ bytes: PNG, type: "image/png" }, { bytes: PNG, type: "image/png" }]);
    expect(await pageCount(fit)).toBe(2);
    expect(await widths(fit)).toEqual([1, 1]);
    const a4 = await imagesToPdf([{ bytes: PNG, type: "image/png" }], "a4");
    expect(await widths(a4)).toEqual([595]);
  });
});
