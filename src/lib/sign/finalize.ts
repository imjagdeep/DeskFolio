// The final signed PDF: every signer's fields drawn onto the original, then
// a certificate of completion. Same file in DeskFolio (src/lib/sign/) and
// the signing page, so either can finish a request.

import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
import type { Field, FieldValue, ValuesFile } from "./envelope";

export interface SignerInfo {
  id: string;
  name: string;
  email: string;
  signedAt: string | null;
}

export interface AuditEvent {
  at: string;
  event: string;
  name: string | null;
  email: string | null;
  ip: string | null;
  userAgent: string | null;
}

export interface CompletionInfo {
  envelopeId: string;
  title: string;
  ownerName: string;
  ownerEmail: string;
  docSha256: string;
  signers: SignerInfo[];
  events: AuditEvent[];
  auditHash: string | null;
  auditIntact: boolean;
  verifyUrl: string;
  completedAt: Date;
}

/** Text the standard PDF fonts can draw (Latin-1); anything else becomes "?". */
export function pdfSafe(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7e\xa0-\xff]/g, "?");
}

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Map a point in the box's upright frame to page user space, for a page rotated `rot`. */
function placer(rect: [number, number, number, number], rot: number) {
  const [x1, y1, x2, y2] = [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])];
  const r = ((rot % 360) + 360) % 360;
  const origin: [number, number] = r === 90 ? [x2, y1] : r === 180 ? [x2, y2] : r === 270 ? [x1, y2] : [x1, y1];
  const turned = r === 90 || r === 270;
  const w = turned ? y2 - y1 : x2 - x1;
  const h = turned ? x2 - x1 : y2 - y1;
  const t = (r * Math.PI) / 180;
  const at = (lx: number, ly: number): [number, number] => [origin[0] + lx * Math.cos(t) - ly * Math.sin(t), origin[1] + lx * Math.sin(t) + ly * Math.cos(t)];
  return { w, h, at, angle: r };
}

async function drawValue(doc: PDFDocument, page: PDFPage, f: Field, v: FieldValue, font: PDFFont) {
  const p = placer(f.rect, page.getRotation().angle);
  if (v.kind === "image") {
    const img = await doc.embedPng(b64(v.png));
    const scale = Math.min(p.w / img.width, p.h / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    const [x, y] = p.at(0, (p.h - h) / 2);
    page.drawImage(img, { x, y, width: w, height: h, rotate: degrees(p.angle) });
  } else if (v.kind === "text") {
    const text = pdfSafe(v.text);
    let size = Math.min(12, p.h * 0.72);
    const width = font.widthOfTextAtSize(text, size);
    if (width > p.w) size = Math.max(5, (size * p.w) / width);
    const [x, y] = p.at(1, (p.h - size * 0.72) / 2);
    page.drawText(text, { x, y, size, font, color: rgb(0.05, 0.05, 0.1), rotate: degrees(p.angle) });
  } else if (v.on) {
    const s = Math.min(p.w, p.h);
    const pts: [number, number][] = [
      [0.18 * s, 0.5 * s],
      [0.42 * s, 0.22 * s],
      [0.85 * s, 0.82 * s],
    ];
    for (let i = 0; i < 2; i++) {
      const [ax, ay] = p.at(pts[i][0], pts[i][1]);
      const [bx, by] = p.at(pts[i + 1][0], pts[i + 1][1]);
      page.drawLine({ start: { x: ax, y: ay }, end: { x: bx, y: by }, thickness: Math.max(1, s * 0.1), color: rgb(0.05, 0.05, 0.1) });
    }
  }
}

const EVENT_TEXT: Record<string, string> = {
  created: "Request created",
  sent: "Sent for signature",
  notified: "Invitation emailed",
  resent: "Invitation emailed again",
  opened: "Opened the document",
  reminded: "Reminder emailed",
  signed: "Signed",
  "all-signed": "Everyone signed",
  completed: "Final copy made",
};

const utc = (iso: string | Date) => {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${d.toISOString().slice(0, 19).replace("T", " ")} UTC`;
};

function shortAgent(ua: string | null): string {
  if (!ua) return "";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : /DeskFolio|Tauri/.test(ua) ? "DeskFolio" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

/** Lines of text laid out top to bottom over as many pages as needed. */
class Writer {
  page: PDFPage;
  y = 0;
  constructor(
    private doc: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont,
  ) {
    this.page = this.newPage();
  }
  private newPage(): PDFPage {
    const p = this.doc.addPage([612, 792]);
    this.y = 740;
    this.page = p;
    p.drawText("DeskLab Sign", { x: 56, y: 762, size: 8, font: this.font, color: rgb(0.45, 0.45, 0.45) });
    return p;
  }
  private room(h: number) {
    if (this.y - h < 56) this.newPage();
  }
  line(text: string, o: { size?: number; bold?: boolean; gray?: boolean; indent?: number; gap?: number } = {}) {
    const size = o.size ?? 9.5;
    const font = o.bold ? this.bold : this.font;
    const x = 56 + (o.indent ?? 0);
    const maxW = 612 - 56 - x;
    const words = pdfSafe(text).split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > maxW && cur) {
        lines.push(cur);
        cur = w;
      } else cur = next;
    }
    lines.push(cur);
    for (const l of lines) {
      this.room(size * 1.4);
      this.page.drawText(l, { x, y: this.y, size, font, color: o.gray ? rgb(0.4, 0.4, 0.4) : rgb(0.08, 0.08, 0.08) });
      this.y -= size * 1.4;
    }
    this.y -= o.gap ?? 0;
  }
  rule() {
    this.room(14);
    this.page.drawLine({ start: { x: 56, y: this.y + 4 }, end: { x: 556, y: this.y + 4 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
    this.y -= 10;
  }
}

/** The original with everyone's fields filled in, plus the certificate of completion. */
export async function buildFinal(original: Uint8Array, fields: Field[], values: ValuesFile[], info: CompletionInfo): Promise<Uint8Array> {
  const doc = await PDFDocument.load(original, { updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();
  for (const f of fields) {
    const v = values.find((x) => x.recipient === f.recipient)?.values[f.id];
    const page = pages[f.page];
    if (v && page) await drawValue(doc, page, f, v, font);
  }

  const w = new Writer(doc, font, bold);
  w.line("Certificate of completion", { size: 18, bold: true, gap: 8 });
  w.line(info.title, { size: 12, bold: true, gap: 4 });
  w.line(`Request ID: ${info.envelopeId}`, { gray: true });
  w.line(`Sent by: ${info.ownerName} <${info.ownerEmail}>`, { gray: true });
  w.line(`Completed: ${utc(info.completedAt)}`, { gray: true });
  w.line(`Original document SHA-256: ${info.docSha256}`, { gray: true, size: 8, gap: 6 });
  w.rule();
  w.line("Signers", { size: 12, bold: true, gap: 2 });
  for (const s of info.signers) {
    const opened = info.events.find((e) => e.event === "opened" && e.email === s.email);
    const signed = [...info.events].reverse().find((e) => e.event === "signed" && e.email === s.email);
    w.line(`${s.name} <${s.email}>`, { bold: true });
    w.line(`Signed ${s.signedAt ? utc(s.signedAt) : "-"}${signed?.ip ? ` from IP ${signed.ip}` : ""}${signed?.userAgent ? ` (${shortAgent(signed.userAgent)})` : ""}`, { indent: 12 });
    if (opened) w.line(`Opened ${utc(opened.at)}${opened.ip ? ` from IP ${opened.ip}` : ""}`, { indent: 12, gray: true });
    w.line(`Agreed: "${values.find((v) => v.recipient === s.id)?.consent ?? ""}"`, { indent: 12, gray: true, size: 8, gap: 6 });
  }
  w.rule();
  w.line("History", { size: 12, bold: true, gap: 2 });
  for (const e of info.events) {
    const who = e.name ? ` - ${e.name} <${e.email ?? ""}>` : "";
    w.line(`${utc(e.at)}  ${EVENT_TEXT[e.event] ?? e.event}${who}${e.ip ? `  (IP ${e.ip})` : ""}`, { size: 8.5 });
  }
  w.rule();
  w.line(`Audit record: ${info.auditIntact ? "intact" : "NOT intact"}. Fingerprint of the full history: ${info.auditHash ?? "-"}`, { size: 8, gray: true });
  w.line(
    `Each step above was recorded by DeskLab Sign as it happened, chained so that any later change shows. To check that a copy of this PDF is the unchanged final document, open ${info.verifyUrl} and choose the file; it is checked on your computer and never uploaded.`,
    { size: 8, gray: true },
  );
  doc.setProducer("DeskLab Sign");
  return doc.save({ useObjectStreams: false });
}
