// Print: the pages (with their comments and marks) are drawn as pictures
// into a print-only area and the system print dialog opens over it. Works
// the same on Windows, macOS and Linux (window.print in the webview).

import { flushPending, type OpenDoc } from "../lib/doc";
import { renderPage } from "../lib/pdfjs";
import { toast, toastError } from "../lib/store";

/** About 150 dpi: sharp on paper without huge memory use. */
const DPI_SCALE = 150 / 72;
let printing = false;

export async function printDocument(doc: OpenDoc, pages?: number[]): Promise<void> {
  if (printing) return;
  printing = true;
  const root = document.createElement("div");
  root.id = "print-root";
  const urls: string[] = [];
  try {
    await flushPending();
    const list = pages?.length ? pages : Array.from({ length: doc.pages }, (_, i) => i);
    if (list.length > 20) toast(`Preparing ${list.length} pages to print…`);
    const canvas = document.createElement("canvas");
    for (const i of list) {
      // renderPage scales by the screen's pixel ratio; undo that so print size is the same on every screen.
      await renderPage(doc.pdf, i + 1, canvas, DPI_SCALE / (window.devicePixelRatio || 1));
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.92));
      if (!blob) throw new Error(`Page ${i + 1} couldn't be prepared for printing.`);
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      img.className = canvas.width > canvas.height ? "print-page landscape" : "print-page";
      root.appendChild(img);
    }
    document.body.appendChild(root);
    await Promise.all([...root.querySelectorAll("img")].map((img) => img.decode().catch(() => undefined)));
    document.body.classList.add("printing");
    // The dialog blocks until it closes on Windows; afterprint covers the others.
    await new Promise<void>((resolve) => {
      const done = () => {
        window.removeEventListener("afterprint", done);
        resolve();
      };
      window.addEventListener("afterprint", done);
      window.print();
      window.setTimeout(done, 120_000);
    });
  } catch (e) {
    toastError(e);
  } finally {
    document.body.classList.remove("printing");
    root.remove();
    urls.forEach((u) => URL.revokeObjectURL(u));
    printing = false;
  }
}
