// PDF digital signatures (PAdES baseline B, ETSI.CAdES.detached): a visible
// signature field added as an incremental update, so earlier signatures stay
// valid, then the signature over every byte except its own slot. And
// reading back every signature in a file with its status.

import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, StandardFonts } from "@cantoo/pdf-lib";
import { unsupportedChars } from "../pdf/stamp";
import { certInfo, signDetached, verifyDetached, type CertInfo } from "./cms";

/** Room for the signature in the file: 16 KB fits RSA 4096 with a 4-certificate chain. */
const SLOT = 16384;
const PLACEHOLDER = 9999999999;

export interface Signer {
  cert: Uint8Array;
  chain: Uint8Array[];
  key: CryptoKey;
}

export interface SignOptions {
  /** 0-based page and box (PDF user space) for the visible signature. */
  page: number;
  rect: [number, number, number, number];
  name: string;
  reason?: string;
  location?: string;
  /** A picture of the handwritten signature (PNG), shown on the left. */
  image?: Uint8Array;
  date?: Date;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
/** "2026.10.12 17:55:03 -07'00'" like Acrobat's appearance text. */
export function stampDate(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ${sign}${pad2(Math.floor(Math.abs(off) / 60))}'${pad2(Math.abs(off) % 60)}'`;
}

const latin1 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return s;
};

/** Does the file have digital signatures already? (quick byte search, no copying) */
export function hasSignatures(bytes: Uint8Array): boolean {
  const needle = [47, 66, 121, 116, 101, 82, 97, 110, 103, 101]; // "/ByteRange"
  outer: for (let i = bytes.indexOf(47); i >= 0 && i <= bytes.length - needle.length; i = bytes.indexOf(47, i + 1)) {
    for (let k = 1; k < needle.length; k++) if (bytes[i + k] !== needle[k]) continue outer;
    return true;
  }
  return false;
}

/** Sign a PDF; returns the signed bytes (the original bytes plus an update). */
export async function signPdf(bytes: Uint8Array, o: SignOptions, signer: Signer): Promise<Uint8Array> {
  const info = await certInfo(signer.cert);
  const lines = [`Digitally signed by ${o.name || info.name}`, `Date: ${stampDate(o.date ?? new Date())}`, ...(o.reason ? [`Reason: ${o.reason}`] : []), ...(o.location ? [`Location: ${o.location}`] : [])];
  const bad = unsupportedChars(lines.join(" "));
  if (bad.length) throw new Error(`These characters can't be shown in the signature box yet: ${bad.join(" ")}`);

  const doc = await PDFDocument.load(bytes, { forIncrementalUpdate: true, updateMetadata: false });
  const pages = doc.getPages();
  const page = pages[o.page];
  if (!page) throw new Error(`There is no page ${o.page + 1}.`);
  const ctx = doc.context;

  // The signature value: ByteRange and Contents are filled in after saving.
  const sig = ctx.obj({
    Type: "Sig",
    Filter: "Adobe.PPKLite",
    SubFilter: "ETSI.CAdES.detached",
    ByteRange: [0, PLACEHOLDER, PLACEHOLDER, PLACEHOLDER],
  });
  sig.set(PDFName.of("Contents"), PDFHexString.of("0".repeat(SLOT * 2)));
  sig.set(PDFName.of("M"), PDFString.fromDate(o.date ?? new Date()));
  sig.set(PDFName.of("Name"), PDFHexString.fromText(o.name || info.name));
  if (o.reason) sig.set(PDFName.of("Reason"), PDFHexString.fromText(o.reason));
  if (o.location) sig.set(PDFName.of("Location"), PDFHexString.fromText(o.location));
  const sigRef = ctx.register(sig);

  // The visible box.
  const [x1, y1, x2, y2] = o.rect;
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const img = o.image ? await doc.embedPng(o.image) : null;
  const textX = img ? w * 0.42 : 4;
  const textW = w - textX - 4;
  let size = Math.min(10, (h - 6) / (lines.length * 1.25));
  for (const l of lines) size = Math.min(size, (textW / Math.max(1, font.widthOfTextAtSize(l, 10))) * 10);
  size = Math.max(4, size);
  const ops: string[] = [];
  if (img) {
    const iw = w * 0.38;
    const ih = Math.min(h - 4, (iw * img.height) / img.width);
    ops.push(`q ${iw} 0 0 ${ih} 3 ${(h - ih) / 2} cm /Img Do Q`);
  }
  ops.push("BT /Helv " + size.toFixed(2) + " Tf 0 g");
  const top = h - 3 - size;
  lines.forEach((l, i) => ops.push(`1 0 0 1 ${textX.toFixed(2)} ${(top - i * size * 1.25).toFixed(2)} Tm ${font.encodeText(l).toString()} Tj`));
  ops.push("ET");
  const resources = ctx.obj({ Font: { Helv: font.ref } });
  if (img) resources.set(PDFName.of("XObject"), ctx.obj({ Img: img.ref }));
  const ap = ctx.register(ctx.flateStream(ops.join("\n"), { Type: "XObject", Subtype: "Form", BBox: [0, 0, w, h], Resources: resources }));

  // A field + widget in one dictionary, on the page and in the form.
  const acro = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict) ?? (() => {
    const a = ctx.obj({ Fields: [] });
    doc.catalog.set(PDFName.of("AcroForm"), ctx.register(a));
    return a;
  })();
  const fields = acro.lookupMaybe(PDFName.of("Fields"), PDFArray) ?? (() => {
    const f = ctx.obj([]);
    acro.set(PDFName.of("Fields"), f);
    return f;
  })();
  const existing = new Set(
    fields.asArray().map((f) => {
      const d = f instanceof PDFRef ? ctx.lookup(f) : f;
      return d instanceof PDFDict ? (d.lookupMaybe(PDFName.of("T"), PDFString)?.decodeText() ?? d.lookupMaybe(PDFName.of("T"), PDFHexString)?.decodeText() ?? "") : "";
    }),
  );
  let n = 1;
  while (existing.has(`Signature${n}`)) n++;
  const widget = ctx.obj({
    Type: "Annot",
    Subtype: "Widget",
    FT: "Sig",
    Rect: [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)],
    F: 132,
    P: page.ref,
    V: sigRef,
    AP: { N: ap },
  });
  widget.set(PDFName.of("T"), PDFString.of(`Signature${n}`));
  const widgetRef = ctx.register(widget);
  fields.push(widgetRef);
  acro.set(PDFName.of("SigFlags"), PDFNumber.of(3));
  // Not page.node.addAnnot(): it "normalizes" the page first (wraps its
  // content in new q/Q streams, rewrites resources), which an earlier
  // signer's validator reports as a change to their signed page.
  const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (annots) annots.push(widgetRef);
  else page.node.set(PDFName.of("Annots"), ctx.obj([widgetRef]));

  // Uncompressed, so the placeholders can be found and filled in place.
  const out = new Uint8Array(await doc.commit({ useObjectStreams: false }));
  const text = latin1(out);
  const brAt = text.lastIndexOf("/ByteRange");
  const open = text.indexOf("[", brAt);
  const close = text.indexOf("]", open);
  const cAt = text.lastIndexOf(`<${"0".repeat(64)}`);
  if (brAt < 0 || open < 0 || close < 0 || cAt < 0 || cAt < brAt - 200000) throw new Error("Couldn't prepare the signature slot in this PDF.");
  const cStart = cAt;
  const cEnd = text.indexOf(">", cStart) + 1;
  const range = [0, cStart, cEnd, out.length - cEnd];
  const rangeText = `[${range.join(" ")}]`;
  const slotLen = close - open + 1;
  if (rangeText.length > slotLen) throw new Error("This PDF is too large to sign in place.");
  for (let i = 0; i < slotLen; i++) out[open + i] = (rangeText.padEnd(slotLen, " ")).charCodeAt(i);

  const covered = new Uint8Array(range[1] + range[3]);
  covered.set(out.subarray(0, range[1]), 0);
  covered.set(out.subarray(range[2], range[2] + range[3]), range[1]);
  const cms = await signDetached(covered, signer.cert, signer.chain, signer.key);
  const hex = Array.from(cms, (b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length > cEnd - cStart - 2) throw new Error("The signature is bigger than the room reserved for it.");
  for (let i = 0; i < hex.length; i++) out[cStart + 1 + i] = hex.charCodeAt(i);
  return out;
}

// ---------- reading signatures back ----------

export interface SignatureStatus {
  field: string;
  signer: CertInfo | null;
  /** When the signer's computer says it signed (not a trusted timestamp). */
  signedAt: Date | null;
  reason: string;
  location: string;
  /** The signed bytes are unchanged and the signature matches. */
  intact: boolean;
  /** Nothing was added to the file after this signature. */
  wholeFile: boolean;
  problem?: string;
  /** 1-based page of the visible box, if any. */
  page: number | null;
}

const textOf = (d: PDFDict, key: string): string => {
  const v = d.lookup(PDFName.of(key));
  return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : "";
};

function hexBytes(v: unknown): Uint8Array | null {
  if (v instanceof PDFHexString) {
    const hex = v.asString();
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  if (v instanceof PDFString) return v.asBytes();
  return null;
}

/** Every signature in the file, checked. */
export async function readSignatures(bytes: Uint8Array): Promise<SignatureStatus[]> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  } catch {
    return [];
  }
  const acro = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  const fields = acro?.lookupMaybe(PDFName.of("Fields"), PDFArray);
  if (!fields) return [];
  const pages = doc.getPages();
  const out: SignatureStatus[] = [];
  const walk = async (list: PDFArray) => {
    for (const ref of list.asArray()) {
      const f = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
      if (!(f instanceof PDFDict)) continue;
      const kids = f.lookupMaybe(PDFName.of("Kids"), PDFArray);
      if (kids && !f.has(PDFName.of("FT"))) {
        await walk(kids);
        continue;
      }
      if (f.lookupMaybe(PDFName.of("FT"), PDFName)?.decodeText() !== "Sig") continue;
      const v = f.lookupMaybe(PDFName.of("V"), PDFDict);
      if (!v) continue; // an empty signature field, waiting to be signed
      const name = textOf(f, "T");
      const pRef = f.get(PDFName.of("P"));
      const pageNo = pRef ? pages.findIndex((p) => p.ref === pRef) : -1;
      const br = v.lookupMaybe(PDFName.of("ByteRange"), PDFArray)?.asArray().map((x) => (x instanceof PDFNumber ? x.asNumber() : NaN)) ?? [];
      const contents = hexBytes(v.lookup(PDFName.of("Contents")));
      const base: Omit<SignatureStatus, "intact" | "wholeFile" | "signer"> = {
        field: name,
        signedAt: (() => {
          const m = textOf(v, "M");
          const r = /^D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/.exec(m);
          return r ? new Date(Date.UTC(+r[1], +r[2] - 1, +r[3], +(r[4] ?? 0), +(r[5] ?? 0), +(r[6] ?? 0))) : null;
        })(),
        reason: textOf(v, "Reason"),
        location: textOf(v, "Location"),
        page: pageNo >= 0 ? pageNo + 1 : null,
      };
      const [a, b, c, d] = br;
      if (br.length !== 4 || ![a, b, c, d].every(Number.isFinite) || a !== 0 || b > c || c + d > bytes.length || !contents) {
        out.push({ ...base, signer: null, intact: false, wholeFile: false, problem: "The signature's byte range is damaged." });
        continue;
      }
      const covered = new Uint8Array(b + d);
      covered.set(bytes.subarray(0, b), 0);
      covered.set(bytes.subarray(c, c + d), b);
      const check = await verifyDetached(contents, covered);
      out.push({
        ...base,
        signer: check.signer ? await certInfo(check.signer) : null,
        intact: check.intact,
        // Later updates (comments, more signatures) appear after c + d.
        wholeFile: c + d === bytes.length || latin1(bytes.subarray(c + d)).trim() === "",
        problem: check.problem,
      });
    }
  };
  await walk(fields);
  return out;
}
