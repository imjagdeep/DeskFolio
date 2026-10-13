// Protection: passwords and permissions, removing hidden information, and
// the page side of redaction.
//
// A protected PDF is decrypted once when it is opened (all tools then work
// on plain bytes) and its protection is put back when it is saved, the way
// Acrobat does it. Saving a decrypted document with pdf-lib without that
// step would leave an /Encrypt entry over plain content: some readers then
// open it without the password, others refuse it.

import { EncryptedPDFError, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef } from "@cantoo/pdf-lib";
import { saveDoc } from "./ops";

export interface Permissions {
  print: boolean;
  /** Full-quality printing (off = low resolution only). */
  printHigh: boolean;
  copy: boolean;
  edit: boolean;
  comment: boolean;
  fillForms: boolean;
  assemble: boolean;
}

export const ALL_ALLOWED: Permissions = { print: true, printHigh: true, copy: true, edit: true, comment: true, fillForms: true, assemble: true };

export interface Protection {
  /** Needed to open the file; "" = opens without a password. */
  openPassword: string;
  /** Needed to change permissions; random when unknown (we can't keep one we never saw). */
  ownerPassword: string;
  permissions: Permissions;
}

/** /P bits (PDF 32000-1, table 22) → permissions. */
export function fromP(p: number): Permissions {
  const on = (bit: number) => (p & (1 << (bit - 1))) !== 0;
  return { print: on(3), printHigh: on(3) && on(12), copy: on(5), edit: on(4), comment: on(6), fillForms: on(9) || on(6), assemble: on(11) || on(4) };
}

export const allAllowed = (p: Permissions) => Object.values(p).every(Boolean);

function randomPassword(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Open bytes that may be encrypted. Returns plain bytes and the protection
 * the file had (null when it had none). `password` is what the user typed;
 * files that only restrict permissions open with "".
 */
export async function decrypt(bytes: Uint8Array, password = ""): Promise<{ bytes: Uint8Array; protection: Protection | null }> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
    return { bytes, protection: null };
  } catch (e) {
    if (!(e instanceof EncryptedPDFError)) throw e;
  }
  // pdf-lib drops the /Encrypt entry as it decrypts, so the permission bits
  // are read from a copy loaded without decrypting.
  const raw = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const enc = raw.context.trailerInfo.Encrypt;
  const dict = enc instanceof PDFRef ? raw.context.lookup(enc) : enc;
  const pValue = dict instanceof PDFDict ? dict.lookupMaybe(PDFName.of("P"), PDFNumber) : undefined;
  const permissions = pValue ? fromP(pValue.asNumber()) : ALL_ALLOWED;
  doc = await PDFDocument.load(bytes, { password, updateMetadata: false });
  // The old security dictionary can stay behind as a loose object; without it
  // the saved file is plainly unencrypted.
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && obj.lookupMaybe(PDFName.of("Filter"), PDFName)?.decodeText() === "Standard" && obj.has(PDFName.of("O")) && obj.has(PDFName.of("U"))) {
      doc.context.delete(ref);
    }
  }
  const plain = await saveDoc(doc);
  // Make sure: every tool loads these bytes without a password.
  await PDFDocument.load(plain, { updateMetadata: false });
  return {
    bytes: plain,
    // Without the owner password we can't keep it: a new random one keeps the restrictions locked.
    protection: { openPassword: password, ownerPassword: allAllowed(permissions) ? password : randomPassword(), permissions },
  };
}

/** Put protection on plain bytes (AES-256). */
export async function encrypt(bytes: Uint8Array, p: Protection): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const owner = p.ownerPassword || (allAllowed(p.permissions) ? p.openPassword : randomPassword()) || randomPassword();
  doc.encrypt({
    userPassword: p.openPassword,
    ownerPassword: owner,
    algorithm: "AES-256",
    permissions: {
      printing: p.permissions.print ? (p.permissions.printHigh ? "highResolution" : "lowResolution") : false,
      modifying: p.permissions.edit,
      copying: p.permissions.copy,
      annotating: p.permissions.comment,
      fillingForms: p.permissions.fillForms,
      contentAccessibility: true,
      documentAssembly: p.permissions.assemble,
    },
  });
  return doc.save({ useObjectStreams: false });
}

// ---------- remove hidden information ----------

export interface SanitizeOptions {
  /** Title, author, producer... and the XMP metadata stream. */
  metadata: boolean;
  /** Embedded files (document-level and file-attachment comments). */
  attachments: boolean;
  /** JavaScript and actions that run on open or on events. */
  scripts: boolean;
  /** Comments and markup (not form fields or links). */
  comments: boolean;
}

const COMMENT_TYPES = new Set(["Text", "FreeText", "Highlight", "Underline", "StrikeOut", "Squiggly", "Square", "Circle", "Line", "Polygon", "PolyLine", "Ink", "Stamp", "Caret", "FileAttachment", "Sound", "Popup"]);

/** Remove the chosen kinds of hidden information; returns new bytes and what was removed. */
export async function sanitize(bytes: Uint8Array, o: SanitizeOptions): Promise<{ bytes: Uint8Array; removed: string[] }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const cat = doc.catalog;
  const removed: string[] = [];
  const names = cat.lookupMaybe(PDFName.of("Names"), PDFDict);

  if (o.metadata) {
    const info = doc.context.trailerInfo.Info;
    const infoDict = info instanceof PDFRef ? doc.context.lookup(info) : info;
    if (infoDict instanceof PDFDict && infoDict.keys().length) {
      for (const k of infoDict.keys()) infoDict.delete(k);
      removed.push("document information (title, author, software…)");
    }
    if (cat.has(PDFName.of("Metadata"))) {
      cat.delete(PDFName.of("Metadata"));
      removed.push("XMP metadata");
    }
    if (cat.has(PDFName.of("PieceInfo"))) cat.delete(PDFName.of("PieceInfo"));
  }
  if (o.attachments && names?.has(PDFName.of("EmbeddedFiles"))) {
    names.delete(PDFName.of("EmbeddedFiles"));
    removed.push("attached files");
  }
  if (o.scripts) {
    let any = false;
    if (names?.has(PDFName.of("JavaScript"))) {
      names.delete(PDFName.of("JavaScript"));
      any = true;
    }
    for (const k of ["OpenAction", "AA"]) {
      if (cat.has(PDFName.of(k))) {
        cat.delete(PDFName.of(k));
        any = true;
      }
    }
    for (const page of doc.getPages()) {
      if (page.node.has(PDFName.of("AA"))) {
        page.node.delete(PDFName.of("AA"));
        any = true;
      }
    }
    if (any) removed.push("scripts and automatic actions");
  }
  let comments = 0;
  let attachedComments = 0;
  if (o.comments || o.attachments) {
    for (const page of doc.getPages()) {
      const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
      if (!annots) continue;
      const keep: (PDFRef | PDFDict)[] = [];
      for (let i = 0; i < annots.size(); i++) {
        const ref = annots.get(i);
        const a = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
        const sub = a instanceof PDFDict ? a.lookupMaybe(PDFName.of("Subtype"), PDFName)?.decodeText() : undefined;
        const isAttachment = sub === "FileAttachment";
        const drop = (o.comments && sub && COMMENT_TYPES.has(sub)) || (o.attachments && isAttachment);
        if (drop) {
          if (isAttachment) attachedComments++;
          else comments++;
        } else if (ref instanceof PDFRef || ref instanceof PDFDict) keep.push(ref);
      }
      page.node.set(PDFName.of("Annots"), doc.context.obj(keep));
    }
  }
  if (comments) removed.push(`${comments} comment${comments === 1 ? "" : "s"}`);
  if (attachedComments && !removed.includes("attached files")) removed.push("attached files");
  return { bytes: await saveDoc(doc), removed };
}

// ---------- redaction: replace pages with flat pictures ----------

export interface BurntPage {
  /** 0-based page. */
  index: number;
  /** The page as seen, already drawn with the black boxes (JPEG or PNG). */
  image: Uint8Array;
  type: "image/jpeg" | "image/png";
  /** Size as seen, in points. */
  width: number;
  height: number;
}

/**
 * Replace each listed page's content with its picture. The page object is
 * kept (so bookmarks and links to it still work) but everything on it is
 * gone: text, drawings, images, comments and form fields on that page.
 */
export async function burnPages(bytes: Uint8Array, pages: BurntPage[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const all = doc.getPages();
  const ctx = doc.context;
  const acro = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  for (const b of pages) {
    const page = all[b.index];
    if (!page) throw new Error(`There is no page ${b.index + 1}.`);
    const img = b.type === "image/png" ? await doc.embedPng(b.image) : await doc.embedJpg(b.image);
    const node = page.node;
    const content = ctx.register(ctx.flateStream(`q ${b.width} 0 0 ${b.height} 0 0 cm /Im0 Do Q`));
    node.set(PDFName.of("Contents"), content);
    node.set(PDFName.of("Resources"), ctx.obj({ XObject: { Im0: img.ref } }));
    node.set(PDFName.of("MediaBox"), ctx.obj([0, 0, b.width, b.height]));
    for (const k of ["CropBox", "BleedBox", "TrimBox", "ArtBox", "Rotate", "Annots", "Group", "Thumb", "PieceInfo", "StructParents"]) node.delete(PDFName.of(k));
    // Form fields that lived on this page go too (their values could hold the redacted words).
    if (acro) {
      const fields = acro.lookupMaybe(PDFName.of("Fields"), PDFArray);
      if (fields) {
        const keep = fields.asArray().filter((f) => {
          const d = f instanceof PDFRef ? ctx.lookup(f) : f;
          return !(d instanceof PDFDict && widgetsOnlyOn(d, page.ref, ctx.lookup.bind(ctx)));
        });
        acro.set(PDFName.of("Fields"), ctx.obj(keep));
      }
    }
  }
  // Unused objects (the old page content) are not written by a fresh save.
  return saveDoc(await PDFDocument.load(await saveDoc(doc), { updateMetadata: false }));
}

/** True if every widget of this field sits on `pageRef`. */
function widgetsOnlyOn(field: PDFDict, pageRef: PDFRef, lookup: (r: PDFRef) => unknown): boolean {
  const kids = field.lookupMaybe(PDFName.of("Kids"), PDFArray);
  const widgets = kids ? kids.asArray().map((k) => (k instanceof PDFRef ? lookup(k) : k)) : [field];
  const onPage = widgets.filter((w) => w instanceof PDFDict && w.get(PDFName.of("P")) === pageRef);
  return widgets.length > 0 && onPage.length === widgets.length;
}
