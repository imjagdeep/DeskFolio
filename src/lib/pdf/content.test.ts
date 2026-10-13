import { describe, expect, it } from "vitest";
import { apply, invert, layout, mul, parseContent, replaceOp, withoutOps, type Matrix } from "./content";

const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const dec = (b: Uint8Array) => String.fromCharCode(...b);

describe("content streams", () => {
  it("splits instructions, including strings with parentheses, hex, arrays and comments", () => {
    const ops = parseContent(enc("q 1 0 0 1 10 20 cm % a comment\nBT /F1 12 Tf 72 700 Td (Hello \\(world\\)) Tj [(A) -120 <4243>] TJ ET Q"));
    expect(ops.map((o) => o.op)).toEqual(["q", "cm", "BT", "Tf", "Td", "Tj", "TJ", "ET", "Q"]);
    const tj = ops[5];
    expect(tj.args[0]).toEqual({ t: "str", raw: "(Hello \\(world\\))" });
    expect(ops[6].args[0].t).toBe("arr");
  });

  it("skips inline images whole", () => {
    const ops = parseContent(enc("q BI /W 2 /H 1 /BPC 8 /CS /G ID \u0001EI\u0002 EI Q BT (after) Tj ET"));
    expect(ops.map((o) => o.op)).toEqual(["q", "BI", "Q", "BT", "Tj", "ET"]);
  });

  it("knows where text starts, at what size and colour, through cm, Td, TL and T*", () => {
    const { texts } = layout(parseContent(enc("q 2 0 0 2 0 0 cm 0 0 1 rg BT /F1 10 Tf 14 TL 30 300 Td (one) Tj T* (two) Tj ET Q BT /F2 8 Tf 1 0 0 1 100 50 Tm (three) Tj ET")));
    expect(texts.map((t) => [t.x, t.y, t.size, t.font])).toEqual([
      [60, 600, 20, "F1"],
      [60, 572, 20, "F1"],
      [100, 50, 8, "F2"],
    ]);
    expect(texts[0].color).toEqual([0, 0, 1]);
    expect(texts.every((t) => t.upright)).toBe(true);
  });

  it("marks rotated text as not upright", () => {
    const { texts } = layout(parseContent(enc("BT /F1 10 Tf 0 1 -1 0 200 200 Tm (up) Tj ET")));
    expect(texts[0].upright).toBe(false);
  });

  it("knows where images are drawn", () => {
    const { draws } = layout(parseContent(enc("q 200 0 0 100 50 60 cm /Im1 Do Q")));
    expect(draws).toEqual([{ index: 2, name: "Im1", ctm: [200, 0, 0, 100, 50, 60] }]);
  });

  it("removes and replaces instructions without touching the rest", () => {
    const src = enc("BT /F1 12 Tf 72 700 Td (keep) Tj 0 -14 Td (drop) Tj ET");
    const ops = parseContent(src);
    const out = dec(withoutOps(src, ops, new Set([5])));
    expect(out).toContain("(keep) Tj");
    expect(out).not.toContain("drop");
    expect(parseContent(enc(out)).map((o) => o.op)).toEqual(["BT", "Tf", "Td", "Tj", "Td", "ET"]);
    const swapped = dec(replaceOp(src, ops[3], "(other) Tj"));
    expect(swapped).toContain("(other) Tj");
    expect(swapped).not.toContain("(keep)");
  });

  it("does matrix arithmetic the PDF way", () => {
    const m: Matrix = [2, 0, 0, 3, 10, 20];
    expect(apply(m, 1, 1)).toEqual([12, 23]);
    const back = mul(m, invert(m));
    back.forEach((v, i) => expect(v).toBeCloseTo([1, 0, 0, 1, 0, 0][i], 9));
  });
});
