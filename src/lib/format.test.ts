import { describe, expect, it } from "vitest";
import { fileName, humanSize, parentDir, plural, siblingPath } from "./format";

describe("format", () => {
  it("names files next to the original", () => {
    expect(siblingPath("C:\\Docs\\Report.pdf", "edited")).toBe("C:\\Docs\\Report (edited).pdf");
    expect(siblingPath("C:\\Docs\\Report.pdf", "", "docx")).toBe("C:\\Docs\\Report.docx");
    expect(siblingPath("/home/a/scan.final.PDF", "compressed")).toBe("/home/a/scan.final (compressed).PDF");
    expect(siblingPath("/home/a/photo.jpg", "", "pdf")).toBe("/home/a/photo.pdf");
  });

  it("splits paths on both separators", () => {
    expect(fileName("C:\\a\\b.pdf")).toBe("b.pdf");
    expect(fileName("/a/b.pdf")).toBe("b.pdf");
    expect(parentDir("C:\\a\\b.pdf")).toBe("C:\\a");
  });

  it("says sizes and counts in plain words", () => {
    expect(plural(1, "page")).toBe("1 page");
    expect(plural(3, "page")).toBe("3 pages");
    expect(humanSize(0)).toMatch(/^0/);
    expect(humanSize(1536)).toMatch(/KB$/);
  });
});
