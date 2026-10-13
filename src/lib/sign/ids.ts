// Saved digital IDs: certificate in the clear, private key encrypted with the
// ID's password (PBKDF2-SHA256, 600,000 rounds → AES-256-GCM). The key is
// only decrypted in memory when signing. Files live in DeskFolio's app-data
// folder ("digital-ids"); .pfx import/export goes through the Rust side.

import { api } from "../api";
import { certInfo, createSelfSigned, importPrivateKey, type CertInfo, type IdMaterial, type NewIdOptions } from "./cms";
import type { Signer } from "./pades";

const ROUNDS = 600_000;

interface SavedId {
  v: 1;
  cert: string;
  chain: string[];
  salt: string;
  iv: string;
  key: string;
  created: string;
}

export interface IdSummary {
  file: string;
  info: CertInfo;
  created: Date;
}

const b64 = (u: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const buf = (u: Uint8Array): ArrayBuffer => u.slice().buffer;

async function wrapKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: buf(salt), iterations: ROUNDS }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** The saved form of an ID (the private key encrypted with `password`). */
export async function sealId(m: IdMaterial, password: string): Promise<string> {
  if (password.length < 6) throw new Error("Use a password of at least 6 characters for your digital ID.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: buf(iv) }, await wrapKey(password, salt), buf(m.pkcs8)));
  const saved: SavedId = { v: 1, cert: b64(m.cert), chain: m.chain.map(b64), salt: b64(salt), iv: b64(iv), key: b64(sealed), created: new Date().toISOString() };
  return JSON.stringify(saved);
}

function parse(text: string): SavedId {
  const o: unknown = JSON.parse(text);
  const str = (k: string) => (o && typeof o === "object" && k in o && typeof Object.getOwnPropertyDescriptor(o, k)?.value === "string" ? String(Object.getOwnPropertyDescriptor(o, k)?.value) : null);
  const chainV: unknown = o && typeof o === "object" && "chain" in o ? Object.getOwnPropertyDescriptor(o, "chain")?.value : [];
  const fields = { cert: str("cert"), salt: str("salt"), iv: str("iv"), key: str("key"), created: str("created") };
  if (!fields.cert || !fields.salt || !fields.iv || !fields.key || !Array.isArray(chainV) || !chainV.every((c) => typeof c === "string")) throw new Error("This saved digital ID is damaged.");
  return { v: 1, cert: fields.cert, chain: chainV, salt: fields.salt, iv: fields.iv, key: fields.key, created: fields.created ?? new Date(0).toISOString() };
}

/** Decrypt the private key (PKCS#8) with the ID's password. */
export async function openId(text: string, password: string): Promise<IdMaterial> {
  const s = parse(text);
  try {
    const pkcs8 = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf(unb64(s.iv)) }, await wrapKey(password, unb64(s.salt)), buf(unb64(s.key))));
    return { cert: unb64(s.cert), chain: s.chain.map(unb64), pkcs8 };
  } catch {
    throw new Error("That password doesn't open this digital ID.");
  }
}

// ---------- on disk ----------

const newFile = () => `id-${Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("")}.json`;
const join = (dir: string, name: string) => `${dir.replace(/[\\/]+$/, "")}${dir.includes("\\") ? "\\" : "/"}${name}`;

export async function listIds(): Promise<IdSummary[]> {
  const [dir, names] = await api.digitalIds();
  const out: IdSummary[] = [];
  for (const file of names) {
    try {
      const s = parse(new TextDecoder().decode(await api.readFile(join(dir, file))));
      out.push({ file, info: await certInfo(unb64(s.cert)), created: new Date(s.created) });
    } catch {
      // A damaged file is skipped; the others still show.
    }
  }
  return out.sort((a, b) => a.info.name.localeCompare(b.info.name));
}

async function store(m: IdMaterial, password: string): Promise<string> {
  const [dir] = await api.digitalIds();
  const file = newFile();
  await api.writeFile(join(dir, file), new TextEncoder().encode(await sealId(m, password)));
  // Your own IDs count as trusted when checking signatures.
  setTrusted((await certInfo(m.cert)).fingerprint, true);
  return file;
}

/** Make a new self-signed ID and save it. */
export async function createId(o: NewIdOptions, password: string): Promise<string> {
  return store(await createSelfSigned(o), password);
}

/** Import a .pfx/.p12 opened with `pfxPassword`; saved protected with `savePassword` (often the same). */
export async function importPfx(path: string, pfxPassword: string, savePassword: string): Promise<string> {
  const parts = await api.digitalIdImport(path, pfxPassword);
  return store({ cert: Uint8Array.from(parts.cert), chain: parts.chain.map((c) => Uint8Array.from(c)), pkcs8: Uint8Array.from(parts.pkcs8) }, savePassword);
}

async function readSaved(file: string): Promise<string> {
  const [dir] = await api.digitalIds();
  return new TextDecoder().decode(await api.readFile(join(dir, file)));
}

/** Unlock an ID for signing. */
export async function unlockId(file: string, password: string): Promise<Signer> {
  const m = await openId(await readSaved(file), password);
  return { cert: m.cert, chain: m.chain, key: await importPrivateKey(m.pkcs8) };
}

/** Write an ID as a .pfx protected with `exportPassword`. */
export async function exportPfx(file: string, password: string, path: string, exportPassword: string, alias: string): Promise<void> {
  const m = await openId(await readSaved(file), password);
  await api.digitalIdExport(path, Array.from(m.cert), m.chain.map((c) => Array.from(c)), Array.from(m.pkcs8), exportPassword, alias);
}

export const deleteId = (file: string) => api.digitalIdDelete(file);

// ---------- trust ----------

const TRUST_KEY = "deskfolio-trusted-signers";

/** Certificates (by SHA-256) the user said to trust, plus their own IDs. */
export function trustedFingerprints(): Set<string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(TRUST_KEY) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^[0-9a-f]{64}$/.test(x)) : []);
  } catch {
    // Unreadable list: trust nothing extra.
    return new Set();
  }
}

export function setTrusted(fingerprint: string, trusted: boolean) {
  const s = trustedFingerprints();
  if (trusted) s.add(fingerprint);
  else s.delete(fingerprint);
  try {
    localStorage.setItem(TRUST_KEY, JSON.stringify([...s]));
  } catch {
    // Not remembered; fine.
  }
}
