// Reading a page's content stream: the drawing instructions, where each
// piece of text and each image is drawn, and removing chosen instructions.
// Enough of PDF's content syntax (ISO 32000-1, 7.8 and 9) to edit text and
// images in place; anything unusual is left untouched.

export type Operand =
  | { t: "num"; v: number }
  | { t: "name"; v: string }
  | { t: "str"; raw: string }
  | { t: "hex"; raw: string }
  | { t: "arr"; v: Operand[] }
  | { t: "dict"; raw: string }
  | { t: "kw"; v: string };

export interface Op {
  op: string;
  args: Operand[];
  /** Byte offsets of the whole instruction (operands + operator) in the stream. */
  start: number;
  end: number;
}

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);

/** Split content bytes into instructions. */
export function parseContent(src: Uint8Array): Op[] {
  const ops: Op[] = [];
  let i = 0;
  let args: Operand[] = [];
  let argStart = -1;
  const n = src.length;
  const isWs = (c: number) => WS.has(c);

  const readOperand = (): Operand | null => {
    const c = src[i];
    if (c === 47) {
      // /Name
      let j = i + 1;
      while (j < n && !isWs(src[j]) && !DELIM.has(src[j])) j++;
      const v = latin1(src, i + 1, j);
      i = j;
      return { t: "name", v };
    }
    if (c === 40) {
      // (literal string), nested parentheses and backslash escapes
      let depth = 0;
      let j = i;
      for (; j < n; j++) {
        const d = src[j];
        if (d === 92) {
          j++;
          continue;
        }
        if (d === 40) depth++;
        else if (d === 41 && --depth === 0) break;
      }
      const raw = latin1(src, i, j + 1);
      i = j + 1;
      return { t: "str", raw };
    }
    if (c === 60 && src[i + 1] === 60) {
      // << dict >> (kept raw; only inline in marked content / BDC)
      let depth = 0;
      let j = i;
      for (; j < n - 1; j++) {
        if (src[j] === 60 && src[j + 1] === 60) {
          depth++;
          j++;
        } else if (src[j] === 62 && src[j + 1] === 62) {
          depth--;
          j++;
          if (depth === 0) break;
        }
      }
      const raw = latin1(src, i, j + 1);
      i = j + 1;
      return { t: "dict", raw };
    }
    if (c === 60) {
      let j = i + 1;
      while (j < n && src[j] !== 62) j++;
      const raw = latin1(src, i, j + 1);
      i = j + 1;
      return { t: "hex", raw };
    }
    if (c === 91) {
      i++;
      const v: Operand[] = [];
      for (;;) {
        skipWs();
        if (i >= n || src[i] === 93) break;
        const o = readOperand();
        if (o) v.push(o);
        else i++;
      }
      i++;
      return { t: "arr", v };
    }
    // number or keyword
    let j = i;
    while (j < n && !isWs(src[j]) && !DELIM.has(src[j])) j++;
    if (j === i) return null;
    const word = latin1(src, i, j);
    i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { t: "num", v: Number(word) };
    return { t: "kw", v: word };
  };

  const skipWs = () => {
    for (;;) {
      while (i < n && isWs(src[i])) i++;
      if (src[i] === 37) {
        while (i < n && src[i] !== 10 && src[i] !== 13) i++;
        continue;
      }
      break;
    }
  };

  for (;;) {
    skipWs();
    if (i >= n) break;
    const at = i;
    const o = readOperand();
    if (!o) {
      i++;
      continue;
    }
    if (argStart < 0) argStart = at;
    if (o.t === "kw" && o.v !== "true" && o.v !== "false" && o.v !== "null") {
      if (o.v === "BI") {
        // Inline image: skip to "EI" on its own.
        const id = indexOf(src, "ID", i);
        let k = id + 3;
        while (k < n - 2 && !(isWs(src[k - 1]) && src[k] === 69 && src[k + 1] === 73 && (k + 2 >= n || isWs(src[k + 2])))) k++;
        i = Math.min(n, k + 2);
        ops.push({ op: "BI", args: [], start: argStart, end: i });
      } else {
        ops.push({ op: o.v, args, start: argStart, end: i });
      }
      args = [];
      argStart = -1;
    } else {
      args.push(o);
    }
  }
  return ops;
}

function latin1(b: Uint8Array, from: number, to: number): string {
  let s = "";
  for (let k = from; k < to; k++) s += String.fromCharCode(b[k]);
  return s;
}

function indexOf(b: Uint8Array, word: string, from: number): number {
  outer: for (let k = from; k < b.length - word.length; k++) {
    for (let m = 0; m < word.length; m++) if (b[k + m] !== word.charCodeAt(m)) continue outer;
    return k;
  }
  return b.length;
}

// ---------- where things are drawn ----------

export type Matrix = [number, number, number, number, number, number];
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m1 × m2 in PDF's row-vector convention (apply m1 first). */
export function mul(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return IDENTITY;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

export const apply = (m: Matrix, x: number, y: number): [number, number] => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];

export interface TextShow {
  /** Index into the instruction list. */
  index: number;
  /** Where the text starts (baseline), PDF user space. */
  x: number;
  y: number;
  /** Font size as drawn, in user space. */
  size: number;
  /** Font resource name (e.g. "F1"). */
  font: string;
  /** Fill colour at that point, if set by rg/g/k. */
  color: [number, number, number] | null;
  /** Horizontal text (no rotation or skew). */
  upright: boolean;
}

export interface ImageDraw {
  index: number;
  /** XObject resource name. */
  name: string;
  /** The current transform when it was drawn: the image fills the unit square under it. */
  ctm: Matrix;
}

const num = (o: Operand | undefined) => (o && o.t === "num" ? o.v : 0);

/**
 * Follow the graphics and text state through the instructions and report
 * where each text-showing instruction starts and where each XObject (image
 * or form) is drawn.
 */
export function layout(ops: Op[]): { texts: TextShow[]; draws: ImageDraw[] } {
  const texts: TextShow[] = [];
  const draws: ImageDraw[] = [];
  let ctm: Matrix = IDENTITY;
  type Fill = [number, number, number] | null;
  const black: Fill = [0, 0, 0];
  let color: Fill = black;
  const stack: { ctm: Matrix; color: Fill; font: string; size: number; tl: number; rise: number; hscale: number }[] = [];
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  let font = "";
  let size = 0;
  let tl = 0;
  let rise = 0;
  let hscale = 1;

  // Without the font's widths, the pen position after a show is estimated
  // (half an em per character); only the next show's start depends on it.
  const advance = (o: Operand | undefined) => {
    let chars = 0;
    let adjust = 0;
    const count = (s: Operand) => {
      if (s.t === "str") chars += Math.max(0, s.raw.length - 2);
      else if (s.t === "hex") chars += Math.max(0, (s.raw.length - 2) / 2);
    };
    if (o?.t === "arr") {
      for (const e of o.v) {
        if (e.t === "num") adjust += e.v;
        else count(e);
      }
    } else if (o) count(o);
    const dx = (chars * 0.5 * size - (adjust / 1000) * size) * hscale;
    tm = mul([1, 0, 0, 1, dx, 0], tm);
  };

  const show = (index: number) => {
    const m = mul(mul([1, 0, 0, 1, 0, rise], tm), ctm);
    const [x, y] = apply(m, 0, 0);
    const sx = Math.hypot(m[0], m[1]);
    const upright = Math.abs(m[1]) < 1e-3 * sx && Math.abs(m[2]) < 1e-3 * Math.hypot(m[2], m[3]) && m[0] > 0 && m[3] > 0;
    texts.push({ index, x, y, size: size * Math.hypot(m[2], m[3]), font, color, upright });
  };
  const newLine = (dx: number, dy: number) => {
    tlm = mul([1, 0, 0, 1, dx, dy], tlm);
    tm = tlm;
  };

  ops.forEach((o, index) => {
    const a = o.args;
    switch (o.op) {
      case "q":
        stack.push({ ctm, color, font, size, tl, rise, hscale });
        break;
      case "Q": {
        const s = stack.pop();
        if (s) ({ ctm, color, font, size, tl, rise, hscale } = s);
        break;
      }
      case "cm":
        ctm = mul([num(a[0]), num(a[1]), num(a[2]), num(a[3]), num(a[4]), num(a[5])], ctm);
        break;
      case "rg":
        color = [num(a[0]), num(a[1]), num(a[2])];
        break;
      case "g":
        color = [num(a[0]), num(a[0]), num(a[0])];
        break;
      case "k": {
        const [c, m, y, k] = [num(a[0]), num(a[1]), num(a[2]), num(a[3])];
        color = [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
        break;
      }
      case "sc":
      case "scn":
        color = null;
        break;
      case "BT":
        tm = IDENTITY;
        tlm = IDENTITY;
        break;
      case "Tf":
        font = a[0]?.t === "name" ? a[0].v : font;
        size = num(a[1]);
        break;
      case "TL":
        tl = num(a[0]);
        break;
      case "Ts":
        rise = num(a[0]);
        break;
      case "Tz":
        hscale = num(a[0]) / 100;
        break;
      case "Td":
        newLine(num(a[0]), num(a[1]));
        break;
      case "TD":
        tl = -num(a[1]);
        newLine(num(a[0]), num(a[1]));
        break;
      case "Tm":
        tlm = [num(a[0]), num(a[1]), num(a[2]), num(a[3]), num(a[4]), num(a[5])];
        tm = tlm;
        break;
      case "T*":
        newLine(0, -tl);
        break;
      case "Tj":
      case "TJ":
        show(index);
        advance(a[0]);
        break;
      case "'":
        newLine(0, -tl);
        show(index);
        advance(a[0]);
        break;
      case '"':
        newLine(0, -tl);
        show(index);
        advance(a[2]);
        break;
      case "Do":
        if (a[0]?.t === "name") draws.push({ index, name: a[0].v, ctm });
        break;
    }
  });
  return { texts, draws };
}

/** The content with the given instructions taken out. */
export function withoutOps(src: Uint8Array, ops: Op[], remove: Set<number>): Uint8Array {
  const parts: Uint8Array[] = [];
  let at = 0;
  ops.forEach((o, i) => {
    if (!remove.has(i)) return;
    parts.push(src.subarray(at, o.start));
    at = o.end;
  });
  parts.push(src.subarray(at));
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length + 1, 0));
  let k = 0;
  for (const p of parts) {
    out.set(p, k);
    k += p.length;
    out[k++] = 10;
  }
  return out;
}

/** The content with one instruction replaced by other content. */
export function replaceOp(src: Uint8Array, op: Op, replacement: string): Uint8Array {
  const rep = Uint8Array.from(replacement, (c) => c.charCodeAt(0) & 0xff);
  const out = new Uint8Array(op.start + rep.length + (src.length - op.end) + 2);
  out.set(src.subarray(0, op.start), 0);
  out[op.start] = 10;
  out.set(rep, op.start + 1);
  out[op.start + 1 + rep.length] = 10;
  out.set(src.subarray(op.end), op.start + 2 + rep.length);
  return out;
}
