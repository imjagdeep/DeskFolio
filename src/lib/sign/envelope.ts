// DeskLab Sign envelope formats and encryption. Same file in DeskFolio
// (src/lib/sign/envelope.ts) and the signing page (desklab-api/sign/src).
// Every file the server stores is AES-256-GCM: 12-byte IV, then ciphertext.
// The key never reaches the server's storage: it travels in the link's #.

export type FieldKind = "signature" | "initials" | "date" | "name" | "text" | "checkbox";

export interface Field {
  id: string;
  /** Recipient id (from the server) who fills it in. */
  recipient: string;
  kind: FieldKind;
  /** 0-based page. */
  page: number;
  /** PDF user space of the unrotated page: [x1, y1, x2, y2]. */
  rect: [number, number, number, number];
  required: boolean;
  /** For text fields: what to type ("Job title"). */
  label?: string;
}

export interface FieldsFile {
  v: 1;
  fields: Field[];
}

export type FieldValue = { kind: "image"; png: string } | { kind: "text"; text: string } | { kind: "check"; on: boolean };

export interface ValuesFile {
  v: 1;
  recipient: string;
  /** Field id → what was filled in (images as base64 PNG). */
  values: Record<string, FieldValue>;
  /** When the signer pressed Finish (their clock; the server records its own). */
  at: string;
  /** The words the signer agreed to. */
  consent: string;
}

export interface LinksFile {
  v: 1;
  owner: string;
  /** Recipient id → access token. */
  recipients: Record<string, string>;
}

export const CONSENT_TEXT =
  "I agree to sign this document electronically. My electronic signature, and the details recorded with it (time, IP address, browser), have the same effect as signing on paper.";

// ---------- encryption ----------

const buf = (u: Uint8Array): ArrayBuffer => u.slice().buffer;

export function newKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function keyToText(key: Uint8Array): string {
  let s = "";
  for (const b of key) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function keyFromText(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(text)) return null;
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "=";
  const out = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return out.length === 32 ? out : null;
}

async function aes(key: Uint8Array, use: "encrypt" | "decrypt"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", buf(key), "AES-GCM", false, [use]);
}

export async function seal(key: Uint8Array, plain: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: buf(iv) }, await aes(key, "encrypt"), buf(plain)));
  const out = new Uint8Array(12 + c.length);
  out.set(iv);
  out.set(c, 12);
  return out;
}

export async function unseal(key: Uint8Array, sealed: Uint8Array): Promise<Uint8Array> {
  if (sealed.length < 29) throw new Error("This file is damaged.");
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf(sealed.subarray(0, 12)) }, await aes(key, "decrypt"), buf(sealed.subarray(12))));
  } catch {
    throw new Error("This link's key doesn't open the document. Use the complete link from the email.");
  }
}

export const sealJson = (key: Uint8Array, value: unknown) => seal(key, new TextEncoder().encode(JSON.stringify(value)));
export async function unsealJson<T>(key: Uint8Array, sealed: Uint8Array, check: (v: unknown) => v is T): Promise<T> {
  const v: unknown = JSON.parse(new TextDecoder().decode(await unseal(key, sealed)));
  if (!check(v)) throw new Error("This file has an unexpected format.");
  return v;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", buf(bytes)));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function signLink(base: string, token: string, key: Uint8Array): string {
  return `${base.replace(/\/$/, "")}/s/${token}#${keyToText(key)}`;
}

// ---------- shape checks for decrypted files ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isRect = (v: unknown): v is [number, number, number, number] => Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === "number" && Number.isFinite(n));
const KINDS = new Set<string>(["signature", "initials", "date", "name", "text", "checkbox"]);

export function isFieldsFile(v: unknown): v is FieldsFile {
  return (
    isObj(v) &&
    v.v === 1 &&
    Array.isArray(v.fields) &&
    v.fields.every(
      (f) => isObj(f) && typeof f.id === "string" && typeof f.recipient === "string" && typeof f.kind === "string" && KINDS.has(f.kind) && typeof f.page === "number" && isRect(f.rect) && typeof f.required === "boolean",
    )
  );
}

function isValue(v: unknown): v is FieldValue {
  if (!isObj(v)) return false;
  if (v.kind === "image") return typeof v.png === "string";
  if (v.kind === "text") return typeof v.text === "string";
  if (v.kind === "check") return typeof v.on === "boolean";
  return false;
}

export function isValuesFile(v: unknown): v is ValuesFile {
  return isObj(v) && v.v === 1 && typeof v.recipient === "string" && isObj(v.values) && Object.values(v.values).every(isValue) && typeof v.at === "string" && typeof v.consent === "string";
}

export function isLinksFile(v: unknown): v is LinksFile {
  return isObj(v) && v.v === 1 && typeof v.owner === "string" && isObj(v.recipients) && Object.values(v.recipients).every((t) => typeof t === "string");
}
