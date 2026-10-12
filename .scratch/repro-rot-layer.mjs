// Reproduce the OCR overlay structure without tesseract:
// main doc: page 1 upright 612x792, page 2 same but /Rotate 90.
// layer doc: text-only pages sized as SHOWN (page2 layer = 792x612),
// embedded with the same math as src/lib/ocr.ts lines 73-83.
import { PDFDocument, degrees, StandardFonts, rgb } from "@cantoo/pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import fs from "node:fs";

const W = 612, H = 792;

// --- build the "scanned" doc: blank pages (image stand-in not needed) ---
const main = await PDFDocument.create();
const p1 = main.addPage([W, H]);
const p2 = main.addPage([W, H]);
p2.setRotation(degrees(90));

// --- build the fake tesseract text-only layers (as displayed) ---
const layer = await PDFDocument.create();
const font = await layer.embedFont(StandardFonts.Helvetica);
const lp1 = layer.addPage([W, H]);            // page1 shown upright
lp1.drawText("ALPHA PAGE ONE", { x: 72, y: 700, size: 24, font, color: rgb(1,1,1) });
const lp2 = layer.addPage([H, W]);            // page2 shown rotated: 792 wide, 612 tall
lp2.drawText("BRAVO PAGE TWO", { x: 72, y: 500, size: 24, font, color: rgb(1,1,1) });

// --- embed with ocr.ts's math ---
const layerBytes = await layer.save();
const layerDoc = await PDFDocument.load(layerBytes);
const embedded = await main.embedPdf(layerDoc, [0, 1]);
for (const [idx, page] of [[0, p1], [1, p2]]) {
  const box = page.getCropBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const shownW = rot % 180 ? box.height : box.width;
  const shownH = rot % 180 ? box.width : box.height;
  const at =
    rot === 90 ? { x: box.x + box.width, y: box.y }
    : rot === 180 ? { x: box.x + box.width, y: box.y + box.height }
    : rot === 270 ? { x: box.x, y: box.y + box.height }
    : { x: box.x, y: box.y };
  page.drawPage(embedded[idx], { ...at, width: shownW, height: shownH, rotate: degrees(rot) });
}
const bytes = await main.save();
fs.writeFileSync(".scratch/repro.pdf", bytes);

// --- extract with pdf.js like the viewer does ---
const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
for (let n = 1; n <= 2; n++) {
  const page = await pdf.getPage(n);
  console.log(`\n=== page ${n}: rotate=${page.rotate} ===`);
  const vp = page.getViewport({ scale: 1 }); // viewer uses this for the TextLayer
  console.log(`viewport ${vp.width}x${vp.height} rotation=${vp.rotation}`);
  const tc = await page.getTextContent();
  for (const it of tc.items) {
    if (!it.str.trim()) continue;
    // TextLayer math (text_layer.js): tx = viewport.transform x item.transform
    const t = it.transform;
    const v = vp.transform;
    const tx = [
      v[0]*t[0]+v[2]*t[1], v[1]*t[0]+v[3]*t[1],
      v[0]*t[2]+v[2]*t[3], v[1]*t[2]+v[3]*t[3],
      v[0]*t[4]+v[2]*t[5]+v[4], v[1]*t[4]+v[3]*t[5]+v[5],
    ];
    const angleDeg = Math.atan2(tx[1], tx[0]) * 180 / Math.PI;
    const fontH = Math.hypot(tx[2], tx[3]);
    console.log(`"${it.str}"  page-tm=[${t.map(x=>x.toFixed(1))}]  -> view origin=(${tx[4].toFixed(1)},${(vp.height - tx[5]).toFixed(1)}) angle=${angleDeg.toFixed(1)} fontH=${fontH.toFixed(1)}`);
  }
}
await pdf.destroy();
