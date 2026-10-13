// Editing a bookmark tree (the PDF outline) by path: a path is the list of
// child indexes from the top, e.g. [2, 0] = first child of the third
// bookmark. Every function returns a new tree; nothing is changed in place.

import type { Bookmark } from "./pagetools";

export type Path = number[];

function clone(list: Bookmark[]): Bookmark[] {
  return list.map((b) => ({ ...b, children: clone(b.children) }));
}

/** The sibling list a path lives in, and its index there. */
function locate(tree: Bookmark[], path: Path): { list: Bookmark[]; i: number } | null {
  let list = tree;
  for (let d = 0; d < path.length - 1; d++) {
    const node = list[path[d]];
    if (!node) return null;
    list = node.children;
  }
  const i = path[path.length - 1];
  return i >= 0 && i < list.length ? { list, i } : null;
}

export function getAt(tree: Bookmark[], path: Path): Bookmark | null {
  const at = locate(tree, path);
  return at ? at.list[at.i] : null;
}

export function rename(tree: Bookmark[], path: Path, title: string): Bookmark[] {
  const t = clone(tree);
  const at = locate(t, path);
  if (at) at.list[at.i].title = title;
  return t;
}

export function removeAt(tree: Bookmark[], path: Path): Bookmark[] {
  const t = clone(tree);
  const at = locate(t, path);
  if (at) at.list.splice(at.i, 1);
  return t;
}

/** Add after `path` (or at the end of the top level when `path` is null); returns the tree and the new item's path. */
export function addAfter(tree: Bookmark[], path: Path | null, item: Bookmark): { tree: Bookmark[]; path: Path } {
  const t = clone(tree);
  const at = path ? locate(t, path) : null;
  if (!at || !path) {
    t.push(item);
    return { tree: t, path: [t.length - 1] };
  }
  at.list.splice(at.i + 1, 0, item);
  return { tree: t, path: [...path.slice(0, -1), at.i + 1] };
}

/** Move up or down among its siblings; returns the new path too. */
export function move(tree: Bookmark[], path: Path, dir: -1 | 1): { tree: Bookmark[]; path: Path } {
  const t = clone(tree);
  const at = locate(t, path);
  if (!at) return { tree: t, path };
  const j = at.i + dir;
  if (j < 0 || j >= at.list.length) return { tree: t, path };
  [at.list[at.i], at.list[j]] = [at.list[j], at.list[at.i]];
  return { tree: t, path: [...path.slice(0, -1), j] };
}

/** Make it the last child of the bookmark above it. */
export function indent(tree: Bookmark[], path: Path): { tree: Bookmark[]; path: Path } {
  const t = clone(tree);
  const at = locate(t, path);
  if (!at || at.i === 0) return { tree: t, path };
  const [item] = at.list.splice(at.i, 1);
  const parent = at.list[at.i - 1];
  parent.children.push(item);
  return { tree: t, path: [...path.slice(0, -1), at.i - 1, parent.children.length - 1] };
}

/** Move it out of its parent, to just after the parent. */
export function outdent(tree: Bookmark[], path: Path): { tree: Bookmark[]; path: Path } {
  if (path.length < 2) return { tree: clone(tree), path };
  const t = clone(tree);
  const at = locate(t, path);
  const parentPath = path.slice(0, -1);
  const up = locate(t, parentPath);
  if (!at || !up) return { tree: t, path };
  const [item] = at.list.splice(at.i, 1);
  up.list.splice(up.i + 1, 0, item);
  return { tree: t, path: [...parentPath.slice(0, -1), up.i + 1] };
}

/** Every bookmark with its path and depth, in reading order. */
export function flatten(tree: Bookmark[], base: Path = []): { item: Bookmark; path: Path; depth: number }[] {
  return tree.flatMap((b, i) => {
    const p = [...base, i];
    return [{ item: b, path: p, depth: base.length }, ...flatten(b.children, p)];
  });
}

export const samePath = (a: Path | null, b: Path | null) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);
