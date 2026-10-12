// Put things on pages: text, dates, check marks and signature or other
// images. Positions arrive already in PDF user space (the UI converts from
// screen with pdf.js), plus the page's rotation so the result looks upright
// on rotated pages too.

import { degrees, rgb, StandardFonts } from "@cantoo/pdf-lib";
import { load, saveDoc, type LoadOpts } from "./ops";

interface StampBase {
  /** 0-based page. */
  page: number;
  /** PDF point of the stamp's visual bottom-left corner. */
  x: number;
  y: number;
  /** Size as seen on the page, in points. */
  width: number;
  height: number;
  /** The page's /Rotate (0, 90, 180, 270): drawn counter-rotated so it reads upright. */
  pageRotation: number;
}

export interface TextStamp extends StampBase {
  kind: "text";
  text: string;
  /** Points. */
  fontSize: number;
}

export interface ImageStamp extends StampBase {
  kind: "image";
  /** PNG or JPEG bytes. */
  bytes: Uint8Array;
  type: "image/png" | "image/jpeg";
}

export interface MarkStamp extends StampBase {
  kind: "check" | "cross";
}

export type Stamp = TextStamp | ImageStamp | MarkStamp;

/** Characters the built-in Helvetica can't show (outside Windows-1252). */
export function unsupportedChars(text: string): string[] {
  const bad = new Set<string>();
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    const ok = (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ\n".includes(ch);
    if (!ok) bad.add(ch);
  }
  return [...bad];
}

/** Draw all stamps; returns new PDF bytes. */
export async function applyStamps(bytes: Uint8Array, stamps: Stamp[], opts: LoadOpts = {}): Promise<Uint8Array> {
  const doc = await load(bytes, opts);
  const pages = doc.getPages();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.08, 0.08, 0.1);
  for (const s of stamps) {
    const page = pages[s.page];
    if (!page) throw new Error(`There is no page ${s.page + 1}.`);
    const rotate = degrees(((s.pageRotation % 360) + 360) % 360);
    if (s.kind === "text") {
      const bad = unsupportedChars(s.text);
      if (bad.length) throw new Error(`These characters can't be added yet: ${bad.join(" ")}`);
      const lines = s.text.split("\n");
      // First baseline sits one line below the top of the box.
      lines.forEach((line, i) => {
        const down = s.fontSize * (i + 0.85);
        const [dx, dy] = along(s.pageRotation, 0, s.height - down);
        page.drawText(line, { x: s.x + dx, y: s.y + dy, size: s.fontSize, font, color: ink, rotate });
      });
    } else if (s.kind === "image") {
      const img = s.type === "image/png" ? await doc.embedPng(s.bytes) : await doc.embedJpg(s.bytes);
      page.drawImage(img, { x: s.x, y: s.y, width: s.width, height: s.height, rotate });
    } else {
      // Check mark or cross, drawn with lines so no font is needed.
      const t = Math.max(1.2, Math.min(s.width, s.height) / 8);
      const pts: [number, number][][] =
        s.kind === "check"
          ? [[[0.08, 0.5], [0.38, 0.18], [0.92, 0.85]]]
          : [
              [[0.15, 0.15], [0.85, 0.85]],
              [[0.15, 0.85], [0.85, 0.15]],
            ];
      for (const path of pts) {
        for (let i = 0; i < path.length - 1; i++) {
          const [a, b] = [path[i], path[i + 1]];
          const [ax, ay] = along(s.pageRotation, a[0] * s.width, a[1] * s.height);
          const [bx, by] = along(s.pageRotation, b[0] * s.width, b[1] * s.height);
          page.drawLine({ start: { x: s.x + ax, y: s.y + ay }, end: { x: s.x + bx, y: s.y + by }, thickness: t, color: ink });
        }
      }
    }
  }
  return saveDoc(doc);
}

/**
 * A step of (right, up) as seen on a page rotated by `rotation` degrees
 * clockwise, expressed in PDF user space.
 */
export function along(rotation: number, right: number, up: number): [number, number] {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return [-up, right];
    case 180:
      return [-right, -up];
    case 270:
      return [up, -right];
    default:
      return [right, up];
  }
}
