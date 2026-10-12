// Turn positioned text (what pdf.js gives per page) into reading order:
// lines, paragraphs, headings and simple tables. Pure, so it can be tested
// with made-up input. Everything here is a heuristic: PDFs store glyphs
// and positions, not paragraphs, so complex layouts won't come out perfect.

export interface TextBit {
  str: string;
  /** Left edge, page units, from the left. */
  x: number;
  /** Baseline, page units, from the TOP of the page. */
  top: number;
  width: number;
  /** Font size (glyph height) in page units. */
  size: number;
  bold?: boolean;
}

export interface Line {
  top: number;
  left: number;
  right: number;
  size: number;
  bold: boolean;
  text: string;
  /** Pieces separated by wide gaps (likely table columns). */
  cells: { x: number; text: string }[];
}

export type Block =
  | { kind: "para"; text: string; size: number; heading: boolean; bold: boolean }
  | { kind: "table"; rows: string[][] };

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function toLines(bits: TextBit[]): Line[] {
  const clean = bits.filter((b) => b.str.length > 0 && b.size > 0);
  clean.sort((a, b) => a.top - b.top || a.x - b.x);
  const groups: TextBit[][] = [];
  for (const b of clean) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(g[0].top - b.top) <= Math.max(g[0].size, b.size) * 0.45) g.push(b);
    else groups.push([b]);
  }
  return groups.map((g) => {
    g.sort((a, b) => a.x - b.x);
    const size = median(g.map((b) => b.size));
    const cells: { x: number; text: string }[] = [];
    let end = -Infinity;
    for (const b of g) {
      const gap = b.x - end;
      const cell = cells[cells.length - 1];
      if (!cell || gap > size * 1.8) {
        cells.push({ x: b.x, text: b.str });
      } else {
        // A visible gap between pieces is a space, unless one is already there.
        const sep = gap > size * 0.2 && !/\s$/.test(cell.text) && !/^\s/.test(b.str) ? " " : "";
        cell.text += sep + b.str;
      }
      end = Math.max(end, b.x + b.width);
    }
    for (const c of cells) c.text = c.text.replace(/\s+/g, " ").trim();
    const text = cells.map((c) => c.text).filter(Boolean).join(" ");
    const boldLen = g.filter((b) => b.bold).reduce((n, b) => n + b.str.length, 0);
    const allLen = g.reduce((n, b) => n + b.str.length, 0);
    return {
      top: median(g.map((b) => b.top)),
      left: g[0].x,
      right: end,
      size,
      bold: boldLen > allLen / 2,
      text,
      cells: cells.filter((c) => c.text),
    };
  }).filter((l) => l.text);
}

/** Column starts shared by a run of lines (x positions within tolerance). */
function columnsOf(lines: Line[]): number[] {
  const xs = lines.flatMap((l) => l.cells.map((c) => c.x)).sort((a, b) => a - b);
  const tol = median(lines.map((l) => l.size)) * 1.5;
  const cols: number[][] = [];
  for (const x of xs) {
    const c = cols[cols.length - 1];
    if (c && x - c[c.length - 1] <= tol) c.push(x);
    else cols.push([x]);
  }
  return cols.map((c) => c[0]);
}

function toRows(lines: Line[]): string[][] {
  const cols = columnsOf(lines);
  return lines.map((l) => {
    const row = cols.map(() => "");
    for (const c of l.cells) {
      let best = 0;
      cols.forEach((x, i) => {
        if (Math.abs(x - c.x) < Math.abs(cols[best] - c.x)) best = i;
      });
      row[best] = row[best] ? `${row[best]} ${c.text}` : c.text;
    }
    return row;
  });
}

/** Group lines into paragraphs, headings and tables. */
export function toBlocks(lines: Line[]): Block[] {
  const body = median(lines.map((l) => l.size)) || 10;
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    // Two or more lines in a row with 2+ columns each: a table.
    let j = i;
    while (j < lines.length && lines[j].cells.length >= 2) j++;
    if (j - i >= 2) {
      blocks.push({ kind: "table", rows: toRows(lines.slice(i, j)) });
      i = j;
      continue;
    }
    const first = lines[i];
    const heading = first.size >= body * 1.2;
    let text = first.cells.length >= 2 ? first.cells.map((c) => c.text).join("\t") : first.text;
    let prev = first;
    i++;
    while (i < lines.length) {
      const l = lines[i];
      const gap = l.top - prev.top;
      const sameStyle = Math.abs(l.size - prev.size) < prev.size * 0.15 && l.bold === prev.bold;
      const close = gap > 0 && gap <= prev.size * 1.7;
      const aligned = Math.abs(l.left - first.left) <= prev.size * 2.5;
      if (!sameStyle || !close || !aligned || l.cells.length >= 2 || heading) break;
      // Join, mending words hyphenated across the line break.
      text = /[A-Za-z]-$/.test(text) && /^[a-z]/.test(l.text) ? text.slice(0, -1) + l.text : `${text} ${l.text}`;
      prev = l;
      i++;
    }
    blocks.push({ kind: "para", text, size: first.size, heading, bold: first.bold });
  }
  return blocks;
}

/** A cell value as a number when it clearly is one ("1,234.50", "-3", "12%"). */
export function asNumber(s: string): number | null {
  const t = s.trim();
  if (!/^[-+(]?\$?€?£?\d{1,3}(,\d{3})*(\.\d+)?%?\)?$|^[-+]?\d+(\.\d+)?%?$/.test(t)) return null;
  const neg = t.startsWith("(") && t.endsWith(")");
  const n = Number(t.replace(/[,$€£()%+]/g, ""));
  if (!Number.isFinite(n)) return null;
  const v = t.endsWith("%") || t.endsWith("%)") ? n / 100 : n;
  return neg ? -v : v;
}

export function blocksToText(pages: Block[][]): string {
  return pages
    .map((blocks) =>
      blocks
        .map((b) => (b.kind === "para" ? b.text : b.rows.map((r) => r.join("\t")).join("\n")))
        .join("\n\n"),
    )
    .join("\n\n\f\n\n")
    .trim();
}
