import { describe, expect, it } from "vitest";
import { addAfter, flatten, indent, move, outdent, removeAt, rename } from "./bookmarks";
import type { Bookmark } from "./pagetools";

const b = (title: string, page: number, children: Bookmark[] = []): Bookmark => ({ title, page, children });
const titles = (t: Bookmark[]) => flatten(t).map((x) => `${"-".repeat(x.depth)}${x.item.title}`);

describe("bookmark tree", () => {
  const tree = [b("A", 0), b("B", 1, [b("B1", 2), b("B2", 3)]), b("C", 4)];

  it("adds, renames and removes without touching the original", () => {
    const added = addAfter(tree, [1, 0], b("New", 2));
    expect(titles(added.tree)).toEqual(["A", "B", "-B1", "-New", "-B2", "C"]);
    expect(added.path).toEqual([1, 1]);
    expect(titles(rename(tree, [2], "See also"))).toEqual(["A", "B", "-B1", "-B2", "See also"]);
    expect(titles(removeAt(tree, [1]))).toEqual(["A", "C"]);
    expect(titles(tree)).toEqual(["A", "B", "-B1", "-B2", "C"]);
    expect(addAfter(tree, null, b("End", 0)).path).toEqual([3]);
  });

  it("moves among siblings and stops at the ends", () => {
    expect(titles(move(tree, [2], -1).tree)).toEqual(["A", "C", "B", "-B1", "-B2"]);
    expect(move(tree, [0], -1).path).toEqual([0]);
    expect(move(tree, [1, 0], 1).path).toEqual([1, 1]);
  });

  it("nests under the bookmark above and back out", () => {
    const inn = indent(tree, [2]);
    expect(titles(inn.tree)).toEqual(["A", "B", "-B1", "-B2", "-C"]);
    expect(inn.path).toEqual([1, 2]);
    const out = outdent(inn.tree, inn.path);
    expect(titles(out.tree)).toEqual(["A", "B", "-B1", "-B2", "C"]);
    expect(out.path).toEqual([2]);
    // The first item has nothing above it to go under; a top-level item can't go further out.
    expect(indent(tree, [0]).path).toEqual([0]);
    expect(outdent(tree, [0]).path).toEqual([0]);
  });
});
