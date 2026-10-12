// Reading comments and marks out of pdf.js annotation records (which pdf.js
// types as "any"; every field is checked here before use).

/** Annotation types that are comments or marks (not links, form fields...). */
const KINDS: Record<string, string> = {
  Text: "Note",
  FreeText: "Text box",
  Highlight: "Highlight",
  Underline: "Underline",
  StrikeOut: "Strike-out",
  Squiggly: "Squiggly",
  Square: "Rectangle",
  Circle: "Ellipse",
  Line: "Line",
  Polygon: "Polygon",
  PolyLine: "Polyline",
  Ink: "Drawing",
  Stamp: "Stamp",
  Caret: "Insert text",
  FileAttachment: "Attachment",
};

export interface CommentItem {
  page: number;
  kind: string;
  author: string;
  text: string;
  date: Date | null;
  color: string | null;
}

const field = (o: object, k: string): unknown => (k in o ? Object.getOwnPropertyDescriptor(o, k)?.value : undefined);
/** pdf.js puts strings as { str } objects for titles and contents. */
const strOf = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const s = field(v, "str");
    return typeof s === "string" ? s : "";
  }
  return "";
};

/** PDF date "D:20261012153000-07'00'" → Date. */
export function parsePdfDate(s: string): Date | null {
  const m = /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +(m[2] ?? 1) - 1, +(m[3] ?? 1), +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A line with an arrowhead at either end. */
const isArrow = (v: unknown) => Array.isArray(v) && v.some((e) => typeof e === "string" && /Arrow/.test(e));

/** Read one pdf.js annotation record (untyped) into a comment, or null. */
export function toComment(a: unknown, page: number): CommentItem | null {
  if (!a || typeof a !== "object") return null;
  const subtype = field(a, "subtype");
  if (typeof subtype !== "string" || !(subtype in KINDS)) return null;
  // Popups belong to their parent annotation; skip anything pdf.js marks hidden.
  const color = field(a, "color");
  const rgb = color instanceof Uint8ClampedArray || Array.isArray(color) ? Array.from(color, Number) : null;
  const date = field(a, "modificationDate") ?? field(a, "creationDate");
  return {
    page,
    kind: subtype === "Line" && isArrow(field(a, "lineEndings")) ? "Arrow" : KINDS[subtype],
    author: strOf(field(a, "titleObj")) || strOf(field(a, "title")),
    text: strOf(field(a, "contentsObj")) || strOf(field(a, "contents")),
    date: typeof date === "string" ? parsePdfDate(date) : null,
    color: rgb && rgb.length >= 3 ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : null,
  };
}
