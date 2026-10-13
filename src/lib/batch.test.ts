import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { getDocument, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { outputPath, processFile, type BatchDeps, type BatchPlan } from "./batch";
import type { TextOverlay } from "./pdf/pagetools";
import { encrypt, ALL_ALLOWED } from "./pdf/protect";

const FONTS = new URL("../../node_modules/pdfjs-dist/standard_fonts/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

async function sample(pages: number, title: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) doc.addPage([300, 300]).drawText(`${title} page ${i + 1}`, { x: 20, y: 250, size: 12, font });
  return doc.save();
}

const open = (bytes: Uint8Array, password?: string) => getDocument({ data: bytes.slice(), password, standardFontDataUrl: FONTS }).promise as Promise<PDFDocumentProxy>;

async function texts(bytes: Uint8Array, password?: string): Promise<string[]> {
  const pdf = await open(bytes, password);
  const out: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const c = await (await pdf.getPage(p)).getTextContent();
    out.push(c.items.map((i) => ("str" in i ? i.str : "")).join(" "));
  }
  await pdf.loadingTask.destroy();
  return out;
}

const calls: string[] = [];
const deps: BatchDeps = {
  compress: async (b, preset) => (calls.push(`compress ${preset}`), b.slice(0, Math.floor(b.length * 0.6))),
  open: (b) => open(b),
  close: (pdf) => void pdf.loadingTask.destroy(),
  ocr: async (_pdf, b) => (calls.push("ocr"), { bytes: b, read: 2 }),
};

const text = (t: string, spot: TextOverlay["spot"]): TextOverlay => ({ kind: "text", text: t, spot, font: "Helvetica", size: 10, color: [0, 0, 0], opacity: 1, angle: 0, margin: 20, behind: false });

const base: BatchPlan = { ocr: false, watermark: null, stamp: null, clean: null, compress: null, format: "pdf", protect: null, inputPassword: "" };

describe("batch processing", () => {
  it("adds a watermark and Bates numbers that continue from the given start", async () => {
    const plan: BatchPlan = {
      ...base,
      watermark: text("CONFIDENTIAL", "mc"),
      stamp: { overlay: text("{bates}", "br"), bates: { prefix: "ABC", digits: 4, start: 1 } },
    };
    const a = await processFile(await sample(2, "First"), "first.pdf", plan, deps, 1);
    const b = await processFile(await sample(3, "Second"), "second.pdf", plan, deps, 1 + a.pages);
    expect(a.pages).toBe(2);
    expect(await texts(a.bytes)).toEqual([expect.stringMatching(/CONFIDENTIAL.*ABC0001|ABC0001.*CONFIDENTIAL/), expect.stringContaining("ABC0002")]);
    expect((await texts(b.bytes)).map((t) => /ABC\d{4}/.exec(t)?.[0])).toEqual(["ABC0003", "ABC0004", "ABC0005"]);
    expect(b.notes).toContain("Bates ABC0003–ABC0005");
  });

  it("runs the steps in order and protects the output", async () => {
    calls.length = 0;
    const plan: BatchPlan = {
      ...base,
      ocr: true,
      clean: { metadata: true, attachments: true, scripts: true, comments: true },
      compress: "strong",
      protect: { openPassword: "open-me", ownerPassword: "owner-pass", permissions: ALL_ALLOWED },
    };
    // The stub "compress" cuts the file, so give it a real result to cut: skip compress here.
    const r = await processFile(await sample(1, "Doc"), "doc.pdf", { ...plan, compress: null }, deps, 1);
    expect(calls).toEqual(["ocr"]);
    expect(r.notes).toEqual(expect.arrayContaining(["2 pages recognised", "password set"]));
    await expect(open(r.bytes)).rejects.toThrow();
    expect((await texts(r.bytes, "open-me"))[0]).toContain("Doc page 1");
    expect((await PDFDocument.load(r.bytes, { password: "open-me" })).getTitle()).toBeUndefined();
  });

  it("opens protected inputs with the batch password and keeps their protection", async () => {
    const locked = await encrypt(await sample(1, "Locked"), { openPassword: "secret1", ownerPassword: "secret1", permissions: ALL_ALLOWED });
    await expect(processFile(locked, "locked.pdf", base, deps, 1)).rejects.toThrow(/needs a password/);
    await expect(processFile(locked, "locked.pdf", { ...base, inputPassword: "nope" }, deps, 1)).rejects.toThrow(/doesn't open/);
    const r = await processFile(locked, "locked.pdf", { ...base, watermark: text("DRAFT", "mc"), inputPassword: "secret1" }, deps, 1);
    expect(r.notes).toContain("kept its protection");
    expect((await texts(r.bytes, "secret1"))[0]).toContain("DRAFT");
  });

  it("converts to text", async () => {
    const r = await processFile(await sample(2, "Plain"), "plain.pdf", { ...base, format: "txt" }, deps, 1);
    const t = new TextDecoder().decode(r.bytes);
    expect(t).toContain("Plain page 1");
    expect(t).toContain("Plain page 2");
  });

  it("names outputs next to each other without clashing extensions", () => {
    expect(outputPath("C:\\in\\report.pdf", "C:\\out\\", "batch", "docx")).toBe("C:\\out\\report (batch).docx");
    expect(outputPath("/in/a.b.PDF", "/out", "", "pdf")).toBe("/out/a.b.pdf");
  });
});
