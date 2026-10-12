// pdf.js set up for offline use: the worker and every asset (character maps,
// standard fonts, image decoders) come from the app itself, never a CDN.

import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const ASSETS = "/pdfjs/";

export type { PDFDocumentProxy };

export class PasswordNeeded extends Error {
  constructor(public readonly wrong: boolean) {
    super(wrong ? "That password is not right." : "This PDF is password-protected.");
  }
}

/**
 * Open PDF bytes for viewing. pdf.js takes ownership of the buffer it is
 * given, so it gets a copy: the caller keeps its bytes for editing.
 */
export async function loadPdf(bytes: Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    password,
    cMapUrl: `${ASSETS}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSETS}standard_fonts/`,
    wasmUrl: `${ASSETS}wasm/`,
    iccUrl: `${ASSETS}iccs/`,
  });
  try {
    return await task.promise;
  } catch (e) {
    if (e && typeof e === "object" && "name" in e && (e as { name: string }).name === "PasswordException") {
      const code = (e as { code?: number }).code;
      // 1 = needs a password, 2 = wrong password.
      throw new PasswordNeeded(code === 2);
    }
    throw e;
  }
}

/** Free a document and its worker resources. */
export function closePdf(doc: PDFDocumentProxy) {
  void doc.loadingTask.destroy();
}

/** Render one page (1-based) to a canvas at `scale` (CSS px per PDF pt). */
export async function renderPage(
  doc: PDFDocumentProxy,
  pageNo: number,
  canvas: HTMLCanvasElement,
  scale: number,
  rotation = 0,
): Promise<void> {
  const page = await doc.getPage(pageNo);
  const ratio = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: scale * ratio, rotation: (page.rotate + rotation) % 360 });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  canvas.style.width = `${Math.ceil(viewport.width / ratio)}px`;
  canvas.style.height = `${Math.ceil(viewport.height / ratio)}px`;
  await page.render({ canvas, viewport }).promise;
}

/** Page size in PDF points, after the page's own rotation. */
export async function pageSize(doc: PDFDocumentProxy, pageNo: number) {
  const page = await doc.getPage(pageNo);
  const v = page.getViewport({ scale: 1 });
  return { width: v.width, height: v.height };
}
