import { describe, expect, it } from "vitest";
import { findHits, luhn } from "./redactfind";

const run = (str: string, x = 100, y = 500, h = 10) => ({ str, x, y, w: str.length * 5, h });

describe("finding text to redact", () => {
  it("finds a phrase in any case, with a box over just those characters", () => {
    const hits = findHits([run("Salary: 85,000 CAD per year")], "85,000 cad", []);
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toBe("85,000 CAD");
    const [x0, y0, x1, y1] = hits[0].rect;
    // "Salary: " is 8 characters of 5 pt each.
    expect(x0).toBeCloseTo(140 - 3, 5);
    expect(x1).toBeCloseTo(190 + 3, 5);
    expect(y0).toBeLessThan(500);
    expect(y1).toBeGreaterThan(509);
  });

  it("finds emails, phone numbers, IPs and real card numbers only", () => {
    const runs = [run("Mail alex.morgan@example.com or call (250) 555-0142"), run("Server 10.0.4.17 and 999.1.1.1"), run("Card 4111 1111 1111 1111, ref 1234 5678 9012 3456")];
    const kinds = findHits(runs, "", ["email", "phone", "ip", "card"]).map((h) => `${h.kind}:${h.text}`);
    expect(kinds).toEqual(["email:alex.morgan@example.com", "phone:(250) 555-0142", "ip:10.0.4.17", "card:4111 1111 1111 1111"]);
    expect(luhn("4111111111111111")).toBe(true);
    expect(luhn("1234567890123456")).toBe(false);
  });

  it("uses measured widths when given", () => {
    // "ii" is narrow, "WW" wide: the box for WW starts after the narrow part.
    const widths: Record<string, number> = { i: 1, W: 3 };
    const measure = (t: string) => [...t].reduce((n, c) => n + (widths[c] ?? 2), 0);
    const [x0] = findHits([{ str: "iiWW", x: 0, y: 0, w: 80, h: 10 }], "WW", [], measure)[0].rect;
    // 2 of 8 width units before it: 20, minus 3 padding.
    expect(x0).toBeCloseTo(17, 5);
  });

  it("finds nothing when nothing is asked", () => {
    expect(findHits([run("anything at all")], "  ", [])).toEqual([]);
  });
});
