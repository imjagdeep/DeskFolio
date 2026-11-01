import { describe, expect, it } from "vitest";
import { PIXEL_TOLERANCE, pixelDiff } from "./check";

const page = (w: number, h: number, rgb = 255) => new Uint8ClampedArray(w * h * 4).fill(rgb);

describe("page comparison", () => {
  it("same pixels: no difference", () => {
    expect(pixelDiff(page(10, 10), page(10, 10))).toBe(0);
  });

  it("anti-aliasing noise below the threshold is ignored", () => {
    const b = page(10, 10);
    b[0] = 250; // a 5-level shift on one channel
    expect(pixelDiff(page(10, 10), b)).toBe(0);
  });

  it("changed content counts, and a few pixels already exceed the tolerance", () => {
    const b = page(100, 100);
    for (let i = 0; i < 4 * 30; i += 4) b[i] = b[i + 1] = b[i + 2] = 0; // 30 black pixels
    const d = pixelDiff(page(100, 100), b);
    expect(d).toBeCloseTo(30 / 10000);
    expect(d).toBeGreaterThan(PIXEL_TOLERANCE);
  });

  it("different page sizes, or nothing drawn, never match", () => {
    expect(pixelDiff(page(10, 10), page(10, 11))).toBe(1);
    expect(pixelDiff(new Uint8ClampedArray(0), new Uint8ClampedArray(0))).toBe(1);
  });
});
