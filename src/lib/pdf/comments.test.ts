import { describe, expect, it } from "vitest";
import { parsePdfDate, toComment } from "./comments";

describe("comments list", () => {
  it("reads pdf.js annotation records into comments", () => {
    const c = toComment(
      { subtype: "Text", titleObj: { str: "Alex" }, contentsObj: { str: "Check this" }, modificationDate: "D:20261012153000Z", color: new Uint8ClampedArray([255, 217, 77]) },
      3,
    );
    expect(c).toEqual({ page: 3, kind: "Note", author: "Alex", text: "Check this", date: new Date(Date.UTC(2026, 9, 12, 15, 30, 0)), color: "rgb(255, 217, 77)" });
  });

  it("calls a line with an arrowhead an arrow", () => {
    expect(toComment({ subtype: "Line", lineEndings: ["None", "OpenArrow"] }, 1)?.kind).toBe("Arrow");
    expect(toComment({ subtype: "Line", lineEndings: ["None", "None"] }, 1)?.kind).toBe("Line");
  });

  it("skips links, form fields and junk", () => {
    expect(toComment({ subtype: "Link" }, 1)).toBeNull();
    expect(toComment({ subtype: "Widget" }, 1)).toBeNull();
    expect(toComment(null, 1)).toBeNull();
    expect(toComment("Text", 1)).toBeNull();
  });

  it("parses short and odd PDF dates", () => {
    expect(parsePdfDate("D:2026")?.getUTCFullYear()).toBe(2026);
    expect(parsePdfDate("nonsense")).toBeNull();
  });
});
