// Comparing two versions of a document's text, word by word (longest common
// subsequence), page against page.

export type Piece = { kind: "same" | "added" | "removed"; text: string };

export const words = (s: string) => s.split(/\s+/).filter(Boolean);

/**
 * Word differences from `a` (old) to `b` (new). The common start and end are
 * trimmed first (most real edits are small); a very large changed stretch is
 * shown as replaced rather than lined up word by word, so it stays quick.
 */
export function diffWords(a: string[], b: string[]): Piece[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const out: Piece[] = [];
  const push = (kind: Piece["kind"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += ` ${text}`;
    else out.push({ kind, text });
  };
  for (const w of a.slice(0, start)) push("same", w);

  if (midA.length * midB.length > 4_000_000) {
    // Too big to line up word by word: show it as replaced.
    midA.forEach((w) => push("removed", w));
    midB.forEach((w) => push("added", w));
  } else {
    // LCS table, then walk it.
    const n = midA.length;
    const m = midB.length;
    const t = new Uint32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        t[i * (m + 1) + j] = midA[i] === midB[j] ? t[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(t[(i + 1) * (m + 1) + j], t[i * (m + 1) + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        push("same", midA[i]);
        i++;
        j++;
      } else if (t[(i + 1) * (m + 1) + j] >= t[i * (m + 1) + j + 1]) push("removed", midA[i++]);
      else push("added", midB[j++]);
    }
    while (i < n) push("removed", midA[i++]);
    while (j < m) push("added", midB[j++]);
  }
  for (const w of a.slice(endA)) push("same", w);
  return out;
}

export interface PageDiff {
  /** 1-based. */
  page: number;
  pieces: Piece[];
  changes: number;
  /** Only in the old or only in the new document. */
  onlyIn?: "old" | "new";
}

/** Page-by-page differences between two lists of page texts. */
export function comparePages(oldPages: string[], newPages: string[]): PageDiff[] {
  const out: PageDiff[] = [];
  for (let i = 0; i < Math.max(oldPages.length, newPages.length); i++) {
    const a = oldPages[i];
    const b = newPages[i];
    if (a === undefined || b === undefined) {
      const text = (a ?? b ?? "").trim();
      out.push({ page: i + 1, pieces: text ? [{ kind: a === undefined ? "added" : "removed", text }] : [], changes: 1, onlyIn: a === undefined ? "new" : "old" });
      continue;
    }
    const pieces = diffWords(words(a), words(b));
    out.push({ page: i + 1, pieces, changes: pieces.filter((p) => p.kind !== "same").length });
  }
  return out;
}
