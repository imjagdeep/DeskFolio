import { describe, expect, it } from "vitest";
import { comparePages, diffWords, words } from "./compare";

describe("compare", () => {
  it("finds changed, added and removed words", () => {
    const d = diffWords(words("The rent is 900 CAD due on the 1st"), words("The rent is 950 CAD due on the 1st of each month"));
    expect(d).toEqual([
      { kind: "same", text: "The rent is" },
      { kind: "removed", text: "900" },
      { kind: "added", text: "950" },
      { kind: "same", text: "CAD due on the 1st" },
      { kind: "added", text: "of each month" },
    ]);
  });

  it("reports identical text as one unchanged piece", () => {
    expect(diffWords(words("a b c"), words("a  b\nc"))).toEqual([{ kind: "same", text: "a b c" }]);
  });

  it("compares page by page, including pages only one side has", () => {
    const r = comparePages(["one two", "three"], ["one too", "three", "four"]);
    expect(r.map((p) => p.changes)).toEqual([2, 0, 1]);
    expect(r[2]).toMatchObject({ page: 3, onlyIn: "new", pieces: [{ kind: "added", text: "four" }] });
  });
});
