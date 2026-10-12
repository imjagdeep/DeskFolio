// Real tesseract layer -> ocr.ts embedding math -> pdf.js extraction check.
import { PDFDocument, degrees } from "@cantoo/pdf-lib";
import { createWorker, OEM, PSM } from "tesseract.js";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import fs from "node:fs";

const W = 612, H = 792; // main doc page size (points)
const DPI = 300;

const worker = await createWorker("eng", OEM.LSTM_ONLY, {
  langPath: "public/tesseract/lang",
  gzip: true,
  cacheMethod: "none",
});
await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, user_defined_dpi: String(DPI) });

const layers = [];
for (const name of ["page1", "page2"]) {
  const png = fs.readFileSync(`.scratch/${name}.png`);
  const { data } = await worker.recognize(png, { pdfTitle: "", pdfTextOnly: true }, { pdf: true, text: true });
  console.log(`${name}: text=${JSON.stringify(data.text.trim().slice(0,60))} pdfBytes=${data.pdf?.length}`);
  layers.push(await PDFDocument.load(Uint8Array.from(data.pdf)));
  fs.writeFileSync(`.scratch/${name}-tess.pdf`, data.pdf);
}
await worker.terminate();

// dump tesseract's page 2 content stream to see how it places text
{
  const lp = layers[1].getPages()[0];
  const s = lp.getSize();
  console.log(`\ntesseract layer page2 size: ${s.width.toFixed(1)}x${s.height.toFixed(1)}`);
  const { PDFName, PDFArray, PDFRawStream } = await import("@cantoo/pdf-lib");
  let contents = lp.node.get(PDFName.of("Contents"));
  contents = layers[1].context.lookup(contents);
  contents = layers[1].context.lookup(contents);
  const streams = contents instanceof PDFArray ? contents.asArray().map(r => layers[1].context.lookup(r)) : [contents];
  const raw = streams.map(s => Buffer.from(s.getContents()).toString("latin1")).join("\n");
  console.log("--- content stream head ---");
  console.log(raw.slice(0, 1200));
}

// --- embed with ocr.ts's exact math ---
const main = await PDFDocument.create();
const p1 = main.addPage([W, H]);
const p2 = main.addPage([W, H]);
p2.setRotation(degrees(90));
for (const [idx, page] of [[0, p1], [1, p2]]) {
  const [embedded] = await main.embedPdf(layers[idx], [0]);
  const box = page.getCropBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const shownW = rot % 180 ? box.height : box.width;
  const shownH = rot % 180 ? box.width : box.height;
  const at =
    rot === 90 ? { x: box.x + box.width, y: box.y }
    : rot === 180 ? { x: box.x + box.width, y: box.y + box.height }
    : rot === 270 ? { x: box.x, y: box.y + box.height }
    : { x: box.x, y: box.y };
  page.drawPage(embedded, { ...at, width: shownW, height: shownH, rotate: degrees(rot) });
}
const bytes = await main.save();
fs.writeFileSync(".scratch/repro-tess.pdf", bytes);

const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
for (let n = 1; n <= 2; n++) {
  const page = await pdf.getPage(n);
  const vp = page.getViewport({ scale: 1 });
  console.log(`\n=== page ${n}: rotate=${page.rotate}, viewport ${vp.width}x${vp.height} ===`);
  const tc = await page.getTextContent();
  let shown = 0;
  for (const it of tc.items) {
    if (!it.str.trim()) continue;
    const t = it.transform, v = vp.transform;
    const tx = [
      v[0]*t[0]+v[2]*t[1], v[1]*t[0]+v[3]*t[1],
      v[0]*t[2]+v[2]*t[3], v[1]*t[2]+v[3]*t[3],
      v[0]*t[4]+v[2]*t[5]+v[4], v[1]*t[4]+v[3]*t[5]+v[5],
    ];
    const angle = Math.atan2(tx[1], tx[0]) * 180 / Math.PI;
    if (shown++ < 4)
      console.log(`"${it.str}" -> view=(${tx[4].toFixed(1)},${(vp.height - tx[5]).toFixed(1)}) angle=${angle.toFixed(1)}`);
  }
}
await pdf.loadingTask.destroy();
