// PDF → Text, Word, Excel and images, in the app (pdf.js does the reading).
// Word and the zip writer are loaded only when used, so the app starts fast.

import { Util } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import type { PDFDocumentProxy } from "../pdfjs";
import { asNumber, blocksToText, toBlocks, toLines, type Block, type TextBit } from "./layout";
import { buildXlsx } from "./xlsx";

export type Progress = (done: number, total: number) => void;

export interface PageContent {
  blocks: Block[];
  /** Characters of text on the page; near zero means a scan or a picture. */
  chars: number;
  width: number;
  height: number;
}

/** Text of one page in reading order, grouped into blocks. */
export async function readPage(pdf: PDFDocumentProxy, pageNo: number): Promise<PageContent> {
  const page = await pdf.getPage(pageNo);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const bits: TextBit[] = [];
  for (const item of content.items) {
    if (!("str" in item)) continue;
    const it = item as TextItem;
    if (!it.str) continue;
    // Position in the (rotated) page as it is shown, y from the top.
    const m = Util.transform(viewport.transform, it.transform) as number[];
    const size = Math.hypot(m[2], m[3]);
    // Skip sideways text (stamps, margins): it would scramble the lines.
    if (Math.abs(m[1]) > size * 0.2 || size <= 0) continue;
    bits.push({ str: it.str, x: m[4], top: m[5], width: it.width, size });
  }
  const blocks = toBlocks(toLines(bits));
  const chars = bits.reduce((n, b) => n + b.str.trim().length, 0);
  return { blocks, chars, width: viewport.width, height: viewport.height };
}

async function readAll(pdf: PDFDocumentProxy, onProgress?: Progress): Promise<PageContent[]> {
  const out: PageContent[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    out.push(await readPage(pdf, p));
    onProgress?.(p, pdf.numPages);
  }
  return out;
}

export async function toText(pdf: PDFDocumentProxy, onProgress?: Progress): Promise<{ text: string; emptyPages: number }> {
  const pages = await readAll(pdf, onProgress);
  return { text: blocksToText(pages.map((p) => p.blocks)), emptyPages: pages.filter((p) => p.chars < 20).length };
}

/** One sheet per page: paragraphs as single cells, tables as columns, numbers as numbers. */
export async function toXlsx(pdf: PDFDocumentProxy, onProgress?: Progress): Promise<{ bytes: Uint8Array; tables: number }> {
  const pages = await readAll(pdf, onProgress);
  let tables = 0;
  const sheets = pages.map((p, i) => {
    const rows: (string | number)[][] = [];
    for (const b of p.blocks) {
      if (b.kind === "para") rows.push([b.text]);
      else {
        tables++;
        for (const r of b.rows) rows.push(r.map((c) => asNumber(c) ?? c));
      }
    }
    return { name: `Page ${i + 1}`, rows };
  });
  return { bytes: buildXlsx(sheets), tables };
}

/** Render a page to PNG or JPEG bytes at the given resolution. */
export async function pageImage(
  pdf: PDFDocumentProxy,
  pageNo: number,
  dpi: number,
  type: "image/png" | "image/jpeg",
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const page = await pdf.getPage(pageNo);
  const viewport = page.getViewport({ scale: dpi / 72 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Can't draw the page (no canvas).");
  // JPEG has no transparency: paint the page white first.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport }).promise;
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.9));
  canvas.width = canvas.height = 0; // free the memory now, not at GC time
  if (!blob) throw new Error(`Can't save page ${pageNo} as an image.`);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: viewport.width, height: viewport.height };
}

/**
 * A Word document: headings, paragraphs and simple tables from the text;
 * pages without text (scans) become pictures so nothing is lost.
 */
export async function toDocx(pdf: PDFDocumentProxy, onProgress?: Progress): Promise<{ bytes: Uint8Array; picturePages: number }> {
  const d = await import("docx");
  const pages = await readAll(pdf, (n, t) => onProgress?.(n, t * 2));
  const sizes = pages.flatMap((p) => p.blocks.flatMap((b) => (b.kind === "para" ? [b.size] : [])));
  const body = sizes.length ? [...sizes].sort((a, b) => a - b)[Math.floor(sizes.length / 2)] : 11;
  // Bigger than body text → heading; the biggest sizes get the top levels.
  const headingSizes = [...new Set(sizes.filter((s) => s >= body * 1.2).map((s) => Math.round(s)))].sort((a, b) => b - a);
  const levels = [d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_2, d.HeadingLevel.HEADING_3];

  const children: (InstanceType<typeof d.Paragraph> | InstanceType<typeof d.Table>)[] = [];
  let picturePages = 0;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const pageBreak = i > 0;
    if (p.chars < 20) {
      // A scan or picture page: keep it as an image, fitted to 6.5 inches wide.
      picturePages++;
      const img = await pageImage(pdf, i + 1, 150, "image/jpeg");
      const w = 624; // 6.5 in at 96 px/in
      const h = Math.min(864, Math.round((w * img.height) / img.width));
      children.push(
        new d.Paragraph({
          pageBreakBefore: pageBreak,
          children: [new d.ImageRun({ type: "jpg", data: img.bytes, transformation: { width: Math.round((h * img.width) / img.height), height: h } })],
        }),
      );
      onProgress?.(pages.length + i + 1, pages.length * 2);
      continue;
    }
    p.blocks.forEach((b, bi) => {
      const first = pageBreak && bi === 0;
      if (b.kind === "para") {
        const lvl = b.heading ? headingSizes.indexOf(Math.round(b.size)) : -1;
        children.push(
          new d.Paragraph({
            pageBreakBefore: first,
            heading: lvl >= 0 ? levels[Math.min(lvl, levels.length - 1)] : undefined,
            children: b.text.split("\t").flatMap((t, ti) => [
              ...(ti > 0 ? [new d.TextRun({ text: "\t" })] : []),
              new d.TextRun({ text: t, bold: b.bold || undefined }),
            ]),
          }),
        );
      } else {
        if (first) children.push(new d.Paragraph({ pageBreakBefore: true, children: [] }));
        const cols = Math.max(...b.rows.map((r) => r.length));
        children.push(
          new d.Table({
            width: { size: 100, type: d.WidthType.PERCENTAGE },
            rows: b.rows.map(
              (r) =>
                new d.TableRow({
                  children: Array.from({ length: cols }, (_, ci) => new d.TableCell({ children: [new d.Paragraph(r[ci] ?? "")] })),
                }),
            ),
          }),
        );
        children.push(new d.Paragraph(""));
      }
    });
    onProgress?.(pages.length + i + 1, pages.length * 2);
  }
  const doc = new d.Document({ creator: "DeskFolio", sections: [{ children }] });
  const blob = await d.Packer.toBlob(doc);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), picturePages };
}
