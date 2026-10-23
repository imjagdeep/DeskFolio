// OCR: make scanned pages searchable. Each page without text is rendered
// at 300 dpi, tesseract (bundled, offline) reads it and writes a text-only
// PDF page (invisible text at the right positions), and that page is laid
// over the original, so the scan looks the same but its words can be
// selected, searched and copied.

import { degrees, PDFDocument } from "@cantoo/pdf-lib";
import { useSyncExternalStore } from "react";
import { createWorker, OEM, PSM } from "tesseract.js";
import { api } from "./api";
import { pageImage, readPage } from "./convert/fromPdf";
import { load, saveDoc, type LoadOpts } from "./pdf/ops";
import type { PDFDocumentProxy } from "./pdfjs";
import { createStore } from "./store";

const DPI = 300;

/* Which languages OCR reads. English is built in; others are downloaded packs
   (see src-tauri/src/ocrlang.rs). The choice is remembered and used by every OCR
   run - the OCR page, batch processing and redaction. */
export const MAX_OCR_LANGS = 3;
const LANGS_KEY = "deskfolio-ocr-langs";
const langsStore = createStore<string[]>(readLangs());
function readLangs(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(LANGS_KEY) ?? "null");
    if (Array.isArray(v) && v.length && v.every((c) => typeof c === "string" && /^[a-z_]{3,8}$/.test(c))) {
      return (v as string[]).slice(0, MAX_OCR_LANGS);
    }
  } catch {
    // Unreadable or no storage: fall back to English.
  }
  return ["eng"];
}
export const useOcrLangs = () => useSyncExternalStore(langsStore.subscribe, langsStore.get);
export const ocrLangs = () => langsStore.get();
export function setOcrLangs(codes: string[]) {
  const next = codes.length ? codes.slice(0, MAX_OCR_LANGS) : ["eng"];
  langsStore.set(next);
  try {
    localStorage.setItem(LANGS_KEY, JSON.stringify(next));
  } catch {
    // Not remembered next time; it still applies now.
  }
}

/** The models tesseract gets: English from the app, the rest from downloaded packs. */
async function modelData(codes: string[]): Promise<{ code: string; data: Uint8Array }[]> {
  return Promise.all(
    codes.map(async (code) => {
      if (code === "eng") {
        const r = await fetch("/tesseract/lang/eng.traineddata.gz");
        if (!r.ok) throw new Error("The built-in English text model is missing - reinstall DeskFolio.");
        return { code, data: new Uint8Array(await r.arrayBuffer()) };
      }
      return { code, data: await api.ocrLangData(code) };
    }),
  );
}

export interface OcrResult {
  bytes: Uint8Array;
  /** Pages that were read. */
  read: number;
  /** Pages left alone because they already had text. */
  skipped: number;
  /** Words found across the pages that were read. */
  words: number;
}

export type OcrProgress = (page: number, total: number, stage: "loading" | "reading") => void;

export async function ocrPdf(
  pdf: PDFDocumentProxy,
  bytes: Uint8Array,
  opts: { onlyWithoutText: boolean; onProgress?: OcrProgress; signal?: AbortSignal; langs?: string[] } & LoadOpts,
): Promise<OcrResult> {
  const total = pdf.numPages;
  // Which pages need reading.
  const todo: number[] = [];
  for (let p = 1; p <= total; p++) {
    if (!opts.onlyWithoutText || (await readPage(pdf, p)).chars < 20) todo.push(p);
  }
  if (!todo.length) return { bytes, read: 0, skipped: total, words: 0 };

  opts.onProgress?.(0, todo.length, "loading");
  const worker = await createWorker(await modelData(opts.langs ?? ocrLangs()), OEM.LSTM_ONLY, {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract/core",
    langPath: "/tesseract/lang",
    workerBlobURL: false,
    gzip: true,
    cacheMethod: "none",
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, user_defined_dpi: String(DPI) });
    const out = await load(bytes, opts);
    const pages = out.getPages();
    let words = 0;
    for (let i = 0; i < todo.length; i++) {
      if (opts.signal?.aborted) throw new Error("OCR stopped.");
      opts.onProgress?.(i, todo.length, "reading");
      const pageNo = todo[i];
      const img = await pageImage(pdf, pageNo, DPI, "image/png");
      const { data } = await worker.recognize(
        new Blob([img.bytes as BlobPart], { type: "image/png" }),
        { pdfTitle: "", pdfTextOnly: true },
        { pdf: true, text: true },
      );
      if (!data.pdf) continue;
      words += (data.text.match(/\S+/g) ?? []).length;
      const layer = await PDFDocument.load(Uint8Array.from(data.pdf));
      const [embedded] = await out.embedPdf(layer, [0]);
      const page = pages[pageNo - 1];
      const box = page.getCropBox();
      const rot = ((page.getRotation().angle % 360) + 360) % 360;
      // The layer was made from the page as shown (rotation applied); turn
      // it back so it lines up with the page's own coordinates.
      const shownW = rot % 180 ? box.height : box.width;
      const shownH = rot % 180 ? box.width : box.height;
      const at =
        rot === 90
          ? { x: box.x + box.width, y: box.y }
          : rot === 180
            ? { x: box.x + box.width, y: box.y + box.height }
            : rot === 270
              ? { x: box.x, y: box.y + box.height }
              : { x: box.x, y: box.y };
      page.drawPage(embedded, { ...at, width: shownW, height: shownH, rotate: degrees(rot) });
    }
    opts.onProgress?.(todo.length, todo.length, "reading");
    return { bytes: await saveDoc(out), read: todo.length, skipped: total - todo.length, words };
  } finally {
    await worker.terminate();
  }
}
