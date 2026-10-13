import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { createSelfSigned, importPrivateKey } from "./cms";
import { hasSignatures, readSignatures, signPdf, stampDate } from "./pades";

async function sample(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]).drawText("Agreement text", { x: 40, y: 340, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
  doc.addPage([400, 400]);
  return doc.save();
}

async function signer(name: string, kind: "RSA" | "ECDSA" = "ECDSA") {
  const id = await createSelfSigned({ name, email: `${name.split(" ")[0].toLowerCase()}@example.com`, kind });
  return { cert: id.cert, chain: [], key: await importPrivateKey(id.pkcs8) };
}

describe("PDF signatures", () => {
  it("signs a PDF that pdf.js still opens, and reads the signature back as intact", async () => {
    const original = await sample();
    const signed = await signPdf(original, { page: 1, rect: [40, 40, 240, 100], name: "Alex Morgan", reason: "I agree", location: "Revelstoke" }, await signer("Alex Morgan"));
    // An incremental update: the original bytes are untouched at the start.
    expect(signed.subarray(0, original.length)).toEqual(original);
    expect(hasSignatures(signed)).toBe(true);
    expect(hasSignatures(original)).toBe(false);

    const [s] = await readSignatures(signed);
    expect(s).toMatchObject({ field: "Signature1", intact: true, wholeFile: true, reason: "I agree", location: "Revelstoke", page: 2 });
    expect(s.signer?.name).toBe("Alex Morgan");
    expect(s.signer?.selfSigned).toBe(true);

    const pdf = await getDocument({ data: signed.slice() }).promise;
    const annots = await (await pdf.getPage(2)).getAnnotations();
    await pdf.loadingTask.destroy();
    expect(annots.some((a) => a.fieldType === "Sig")).toBe(true);
  }, 60_000);

  it("keeps the first signature valid when a second person signs", async () => {
    const once = await signPdf(await sample(), { page: 0, rect: [40, 40, 200, 90], name: "First Signer" }, await signer("First Signer", "RSA"));
    const twice = await signPdf(once, { page: 0, rect: [210, 40, 370, 90], name: "Second Signer" }, await signer("Second Signer"));
    const sigs = await readSignatures(twice);
    expect(sigs.map((s) => [s.field, s.signer?.name, s.intact, s.wholeFile])).toEqual([
      ["Signature1", "First Signer", true, false],
      ["Signature2", "Second Signer", true, true],
    ]);
  }, 60_000);

  it("notices a change to the signed bytes", async () => {
    const signed = await signPdf(await sample(), { page: 0, rect: [40, 40, 200, 90], name: "Alex" }, await signer("Alex"));
    const text = new TextDecoder("latin1").decode(signed);
    const at = text.indexOf("Agreement text") >= 0 ? text.indexOf("Agreement text") : 200;
    const changed = signed.slice();
    changed[Math.max(20, at)] ^= 1;
    const [s] = await readSignatures(changed);
    expect(s.intact).toBe(false);
  }, 60_000);

  it("formats dates like Acrobat's signature box", () => {
    expect(stampDate(new Date(2026, 9, 12, 7, 5, 3))).toMatch(/^2026\.10\.12 07:05:03 [+-]\d\d'\d\d'$/);
  });
});
