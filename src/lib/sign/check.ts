// Before DeskFolio keeps a signed copy, it checks the copy's pages against
// what was really signed: it rebuilds the document from the original and each
// signer's entries (the same finalize.ts the signing page uses) and compares
// every original page as a picture. The certificate pages at the end carry
// dates and are not compared. A copy someone altered is not kept.

import type { PDFDocumentProxy } from "../pdfjs";

/**
 * Share of pixels allowed to differ on a page. The same content renders
 * identically, and one changed digit is only a few dozen pixels, so none may.
 */
export const PIXEL_TOLERANCE = 0;

/** Share of pixels that differ between two RGBA buffers of a page (1 when their sizes differ). */
export function pixelDiff(a: Uint8ClampedArray, b: Uint8ClampedArray, threshold = 24): number {
  if (a.length !== b.length || !a.length) return 1;
  let diff = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.abs((a[i] ?? 0) - (b[i] ?? 0)) + Math.abs((a[i + 1] ?? 0) - (b[i + 1] ?? 0)) + Math.abs((a[i + 2] ?? 0) - (b[i + 2] ?? 0));
    if (d > threshold) diff++;
  }
  return diff / (a.length / 4);
}

async function pixels(doc: PDFDocumentProxy, pageNo: number): Promise<Uint8ClampedArray> {
  const { renderPage } = await import("../pdfjs");
  const canvas = document.createElement("canvas");
  await renderPage(doc, pageNo, canvas, 1);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Can't compare pages here (no drawing surface).");
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}

/**
 * Compare the first `pages` pages of the signed copy with the rebuilt document.
 * Returns the first page that differs (1-based), or null when they all match.
 */
export async function firstDifferentPage(signed: Uint8Array, rebuilt: Uint8Array, pages: number): Promise<number | null> {
  // pdf.js loads only here, so the comparison above can be tested without it.
  const { closePdf, loadPdf } = await import("../pdfjs");
  const a = await loadPdf(signed.slice());
  const b = await loadPdf(rebuilt.slice());
  try {
    // The signed copy is the original's pages plus the certificate.
    if (a.numPages <= pages || b.numPages < pages) return Math.min(a.numPages, pages) + 1;
    for (let p = 1; p <= pages; p++) {
      if (pixelDiff(await pixels(a, p), await pixels(b, p)) > PIXEL_TOLERANCE) return p;
    }
    return null;
  } finally {
    closePdf(a);
    closePdf(b);
  }
}
