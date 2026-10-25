import { PDFDocument } from "@cantoo/pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import type { Field, ValuesFile } from "./envelope";
import { buildProgress } from "./finalize";

async function textOf(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocument({ data: bytes.slice() }).promise;
  const out: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) out.push((await (await pdf.getPage(i)).getTextContent()).items.map((x) => ("str" in x ? x.str : "")).join(" "));
  await pdf.loadingTask.destroy();
  return out;
}

describe("signed so far", () => {
  it("draws the values of those who signed and marks every page as not final", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([400, 400]);
    doc.addPage([400, 400]);
    const fields: Field[] = [
      { id: "f1", recipient: "a", kind: "name", page: 0, rect: [40, 40, 200, 60], required: true },
      { id: "f2", recipient: "b", kind: "name", page: 1, rect: [40, 40, 200, 60], required: true },
    ];
    const values: ValuesFile[] = [{ v: 1, recipient: "a", values: { f1: { kind: "text", text: "Jagdeep" } }, at: "2026-10-23T09:59:00Z", consent: "I agree" }];
    const out = await buildProgress(await doc.save(), fields, values, "NOT THE FINAL COPY - signed so far by Jagdeep (1 of 2)");
    const pages = await textOf(out);
    expect(pages).toHaveLength(2); // no certificate page while it's open
    expect(pages[0]).toContain("Jagdeep");
    expect(pages.every((p) => p.includes("NOT THE FINAL COPY"))).toBe(true);
  }, 30_000);
});
