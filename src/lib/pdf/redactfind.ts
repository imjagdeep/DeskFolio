// Finding what to redact in a page's text: words or phrases you type, and
// private details (emails, phone numbers, IP addresses, card numbers; the
// same patterns as DeskShot). Works on pdf.js text runs placed in PDF user
// space; each hit becomes a box in user space.

export type Kind = "email" | "phone" | "ip" | "card";

export interface TextRun {
  str: string;
  /** Baseline start, PDF user space. */
  x: number;
  y: number;
  /** Run width and font height, user space. */
  w: number;
  h: number;
}

export interface Hit {
  text: string;
  kind: Kind | "text";
  rect: [number, number, number, number];
}

const PATTERNS: { kind: Kind; re: RegExp; ok?: (m: string) => boolean }[] = [
  { kind: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: "card", re: /\b\d(?:[ -]?\d){12,18}\b/g, ok: (m) => luhn(m.replace(/\D/g, "")) },
  { kind: "ip", re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, ok: (m) => m.split(".").every((p) => Number(p) <= 255) },
  { kind: "phone", re: /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\b\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g },
];

/** The card-number checksum. */
export function luhn(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Width of some text in any unit; only ratios are used. Default: every character equal. */
export type Measure = (text: string) => number;
const byCount: Measure = (t) => t.length;

/**
 * Box for characters [from, to) of a run, from measured text widths scaled to
 * the run's real width, padded so a slightly wrong font guess still covers.
 */
function boxOf(run: TextRun, from: number, to: number, measure: Measure): [number, number, number, number] {
  const full = measure(run.str) || 1;
  const x0 = run.x + (run.w * measure(run.str.slice(0, from))) / full;
  const x1 = run.x + (run.w * measure(run.str.slice(0, to))) / full;
  const pad = run.h * 0.3;
  // Descenders below the baseline, ascenders above.
  return [x0 - pad, run.y - run.h * 0.28, x1 + pad, run.y + run.h * 0.95];
}

/** Every place the query (case-insensitive) or a chosen pattern appears. */
export function findHits(runs: TextRun[], query: string, kinds: Kind[], measure: Measure = byCount): Hit[] {
  const hits: Hit[] = [];
  const q = query.trim().toLowerCase();
  for (const run of runs) {
    if (!run.str) continue;
    if (q) {
      const hay = run.str.toLowerCase();
      for (let at = hay.indexOf(q); at >= 0; at = hay.indexOf(q, at + q.length)) {
        hits.push({ text: run.str.slice(at, at + q.length), kind: "text", rect: boxOf(run, at, at + q.length, measure) });
      }
    }
    for (const p of PATTERNS) {
      if (!kinds.includes(p.kind)) continue;
      for (const m of run.str.matchAll(p.re)) {
        if (p.ok && !p.ok(m[0])) continue;
        const at = m.index ?? 0;
        hits.push({ text: m[0], kind: p.kind, rect: boxOf(run, at, at + m[0].length, measure) });
      }
    }
  }
  return hits;
}
