import { PDFDocument, PDFName, StandardFonts } from "@cantoo/pdf-lib";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { addMarks } from "./markup";
import { ALL_ALLOWED, burnPages, decrypt, encrypt, fromP, sanitize } from "./protect";

const FONTS = fileURLToPath(new URL("../../../node_modules/pdfjs-dist/standard_fonts/", import.meta.url)).split("\\").join("/");

async function sample(text = "Account 12345678 secret"): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 400]).drawText(text, { x: 20, y: 300, size: 12, font });
  doc.addPage([300, 400]).drawText("Page two stays", { x: 20, y: 300, size: 12, font });
  doc.setTitle("Private title");
  doc.setAuthor("Someone");
  return doc.save();
}

/** All text pdf.js finds on a page (null when it asks for a password). */
async function textOf(bytes: Uint8Array, page = 1, password?: string): Promise<string | null> {
  try {
    const pdf = await getDocument({ data: bytes.slice(), password, standardFontDataUrl: FONTS }).promise;
    const t = await (await pdf.getPage(page)).getTextContent();
    await pdf.loadingTask.destroy();
    return t.items.map((i) => ("str" in i ? i.str : "")).join(" ");
  } catch (e) {
    if (e instanceof Error && e.name === "PasswordException") return null;
    throw e;
  }
}

describe("passwords", () => {
  it("reads permission bits", () => {
    expect(fromP(-4)).toEqual(ALL_ALLOWED);
    // Print only (bit 3), nothing else.
    expect(fromP(4 - 4096 * 1024)).toMatchObject({ print: true, printHigh: false, copy: false, edit: false, comment: false });
  });

  it("protects with an open password, opens it again, and keeps it after editing", async () => {
    const enc = await encrypt(await sample(), { openPassword: "open123", ownerPassword: "", permissions: ALL_ALLOWED });
    expect(await textOf(enc)).toBeNull();
    expect(await textOf(enc, 1, "open123")).toContain("secret");

    const { bytes: plain, protection } = await decrypt(enc, "open123");
    if (!protection) throw new Error("protection not found");
    expect(protection?.openPassword).toBe("open123");
    expect(await textOf(plain)).toContain("secret");
    // An edit on the plain bytes, then the protection goes back on.
    const edited = await addMarks(plain, [{ kind: "note", page: 0, at: [10, 390], note: "hi", color: [1, 1, 0] }]);
    const again = await encrypt(edited, protection);
    expect(await textOf(again)).toBeNull();
    expect(await textOf(again, 1, "open123")).toContain("secret");
  });

  it("opens files that only restrict permissions, and keeps the restrictions", async () => {
    const doc = await PDFDocument.load(await sample());
    doc.encrypt({ userPassword: "", ownerPassword: "bank-owner", permissions: { copying: false, modifying: false, printing: "highResolution" } });
    const restricted = await doc.save();
    const { bytes: plain, protection } = await decrypt(restricted);
    if (!protection) throw new Error("protection not found");
    expect(protection).toMatchObject({ openPassword: "", permissions: { copy: false, edit: false, print: true } });
    // A new owner password we don't know the old one of, so the restrictions stay locked.
    expect(protection.ownerPassword).not.toBe("");
    const again = await encrypt(plain, protection);
    expect(await textOf(again)).toContain("secret");
    const pdf = await getDocument({ data: again.slice(), standardFontDataUrl: FONTS }).promise;
    const perms = await pdf.getPermissions();
    await pdf.loadingTask.destroy();
    // pdf.js lists what's allowed: printing yes, copying (16) no.
    expect(perms).not.toBeNull();
    expect(perms).not.toContain(16);
  });

  it("leaves unprotected files alone", async () => {
    const s = await sample();
    const r = await decrypt(s);
    expect(r.protection).toBeNull();
    expect(r.bytes).toBe(s);
  });
});

describe("hidden information", () => {
  it("removes metadata, scripts, attachments and comments as chosen", async () => {
    const withNote = await addMarks(await sample(), [{ kind: "note", page: 0, at: [10, 390], note: "internal remark", color: [1, 1, 0] }]);
    const doc = await PDFDocument.load(withNote);
    doc.catalog.set(PDFName.of("OpenAction"), doc.context.obj({ S: "JavaScript", JS: "app.alert(1)" }));
    await doc.attach(new TextEncoder().encode("payroll"), "payroll.csv", { mimeType: "text/csv" });
    const dirty = await doc.save();

    const { bytes, removed } = await sanitize(dirty, { metadata: true, attachments: true, scripts: true, comments: true });
    const clean = await PDFDocument.load(bytes);
    expect(clean.getTitle()).toBeUndefined();
    expect(clean.getAuthor()).toBeUndefined();
    expect(clean.catalog.has(PDFName.of("OpenAction"))).toBe(false);
    expect(clean.getAttachments?.() ?? []).toHaveLength(0);
    expect(clean.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
    expect(removed.join(", ")).toMatch(/document information.*attached files.*scripts.*1 comment/);
    // Text stays.
    expect(await textOf(bytes)).toContain("secret");
  });

  it("keeps what wasn't chosen", async () => {
    const { bytes } = await sanitize(await sample(), { metadata: false, attachments: true, scripts: true, comments: true });
    expect((await PDFDocument.load(bytes)).getTitle()).toBe("Private title");
  });
});

describe("burning pages", () => {
  it("replaces a page with its picture: no text left on it, other pages untouched", async () => {
    // A tiny white PNG stands in for the rendered page.
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const out = await burnPages(await sample(), [{ index: 0, image: png, type: "image/png", width: 300, height: 400 }]);
    expect((await textOf(out, 1))?.trim()).toBe("");
    expect(await textOf(out, 2)).toContain("Page two stays");
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getSize()).toEqual({ width: 300, height: 400 });
  });
});
