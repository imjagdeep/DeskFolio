import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFStream } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { addMarks, mergeLines, type Mark } from "./markup";

async function blank(pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]);
  return doc.save();
}

/** Every annotation on a page as a plain object. */
async function annots(bytes: Uint8Array, page: number) {
  const doc = await PDFDocument.load(bytes);
  const p = doc.getPages()[page];
  const arr = p.node.Annots();
  if (!arr) return [];
  const out = [];
  for (let i = 0; i < arr.size(); i++) {
    const d = doc.context.lookup(arr.get(i), PDFDict);
    const nums = (k: string) => {
      const a = d.lookupMaybe(PDFName.of(k), PDFArray);
      return a ? a.asArray().map((x) => (x instanceof PDFNumber ? x.asNumber() : NaN)) : null;
    };
    const ap = d.lookupMaybe(PDFName.of("AP"), PDFDict);
    const normal = ap?.get(PDFName.of("N"));
    const text = (k: string) => {
      const v = d.lookup(PDFName.of(k));
      return v instanceof PDFHexString ? v.decodeText() : null;
    };
    out.push({
      subtype: d.lookup(PDFName.of("Subtype"), PDFName).decodeText(),
      rect: nums("Rect"),
      color: nums("C"),
      quads: nums("QuadPoints"),
      line: nums("L"),
      author: text("T"),
      note: text("Contents"),
      hasAppearance: normal instanceof PDFRef && doc.context.lookup(normal) instanceof PDFStream,
      pageRef: d.get(PDFName.of("P")) === p.ref,
    });
  }
  return out;
}

describe("markup annotations", () => {
  it("adds shapes, lines and arrows with appearances on the right page", async () => {
    const marks: Mark[] = [
      { kind: "square", page: 0, rect: [300, 500, 100, 400], color: [1, 0, 0], width: 2, author: "Alex" },
      { kind: "circle", page: 0, rect: [50, 50, 150, 120], color: [0, 0, 1], width: 1.5 },
      { kind: "line", page: 1, from: [10, 10], to: [200, 300], color: [0, 0, 0], width: 1 },
      { kind: "arrow", page: 1, from: [100, 100], to: [300, 100], color: [0, 0.5, 0], width: 2, note: "Look here" },
    ];
    const out = await addMarks(await blank(), marks);
    const p1 = await annots(out, 0);
    const p2 = await annots(out, 1);
    expect(p1.map((a) => a.subtype)).toEqual(["Square", "Circle"]);
    expect(p1[0].rect).toEqual([100, 400, 300, 500]);
    expect(p1[0].color).toEqual([1, 0, 0]);
    expect(p1[0].author).toBe("Alex");
    expect(p2.map((a) => a.subtype)).toEqual(["Line", "Line"]);
    expect(p2[1].line).toEqual([100, 100, 300, 100]);
    expect(p2[1].note).toBe("Look here");
    // The arrowhead needs room around the end point.
    expect(p2[1].rect![2]).toBeGreaterThan(300);
    for (const a of [...p1, ...p2]) {
      expect(a.hasAppearance).toBe(true);
      expect(a.pageRef).toBe(true);
    }
  });

  it("adds underline and strike-out over text quads", async () => {
    const quad = [100, 720, 300, 720, 100, 706, 300, 706];
    const out = await addMarks(await blank(1), [
      { kind: "underline", page: 0, quads: [quad], color: [0, 0.4, 1] },
      { kind: "strikeout", page: 0, quads: [quad, [100, 700, 200, 700, 100, 686, 200, 686]], color: [1, 0, 0] },
    ]);
    const a = await annots(out, 0);
    expect(a.map((x) => x.subtype)).toEqual(["Underline", "StrikeOut"]);
    expect(a[0].quads).toEqual(quad);
    expect(a[1].quads).toHaveLength(16);
    expect(a[1].rect).toEqual([99, 685, 301, 721]);
  });

  it("adds a sticky note and a stamp, keeping text in any language", async () => {
    const out = await addMarks(await blank(1), [
      { kind: "note", page: 0, at: [500, 800], note: "Check the total — ਧੰਨਵਾਦ", color: [1, 0.85, 0.3], author: "Jagdeep" },
      { kind: "stamp", page: 0, at: [300, 400], label: "APPROVED", sub: "12 Oct 2026", color: [0.1, 0.5, 0.2] },
    ]);
    const a = await annots(out, 0);
    expect(a.map((x) => x.subtype)).toEqual(["Text", "Stamp"]);
    expect(a[0].note).toBe("Check the total — ਧੰਨਵਾਦ");
    expect(a[0].rect).toEqual([500, 780, 520, 800]);
    const [x1, y1, x2, y2] = a[1].rect!;
    expect((x1 + x2) / 2).toBeCloseTo(300, 5);
    expect((y1 + y2) / 2).toBeCloseTo(400, 5);
    expect(a.every((x) => x.hasAppearance)).toBe(true);
  });

  it("refuses a page that isn't there", async () => {
    await expect(addMarks(await blank(1), [{ kind: "note", page: 3, at: [1, 1], note: "x", color: [1, 1, 0] }])).rejects.toThrow("no page 4");
  });
});

describe("mergeLines", () => {
  it("joins runs on one line and keeps separate lines apart", () => {
    const run = (x0: number, x1: number, top: number, bottom: number) => [x0, top, x1, top, x0, bottom, x1, bottom];
    const merged = mergeLines([run(100, 150, 720, 706), run(152, 220, 720.5, 706.4), run(100, 180, 700, 686)]);
    expect(merged).toEqual([run(100, 220, 720, 706), run(100, 180, 700, 686)]);
  });
});
