// Request keys (Send for signature), kept outside the webview's storage: in
// sign-keys.json in the app's data folder, encrypted with a key held in the
// system keychain (both through Rust, see lib.rs). A reset of the webview's
// storage loses nothing, and the file alone opens nothing. Without a keychain
// (some Linux desktops) the keys stay in the webview's storage, as before.

import { api } from "../api";
import { keyFromText, keyToText } from "./envelope";

const LEGACY = "deskfolio-sign-keys";
const buf = (u: Uint8Array): ArrayBuffer => u.slice().buffer;
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

let keys: Record<string, string> = {};
let vault: CryptoKey | null = null;
let loading: Promise<void> | null = null;
let saving: Promise<void> = Promise.resolve();

function textMap(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === "string"));
}

function readLegacy(): Record<string, string> {
  try {
    return textMap(JSON.parse(localStorage.getItem(LEGACY) ?? "{}"));
  } catch {
    // Unreadable: no keys (requests still show, their files can't be opened here).
    return {};
  }
}

async function vaultKey(): Promise<CryptoKey> {
  let text = await api.signVaultKey();
  if (!text) {
    await api.signVaultKeySet(keyToText(crypto.getRandomValues(new Uint8Array(32))));
    // Read back: only a key the keychain really holds may lock the file.
    text = await api.signVaultKey();
  }
  const raw = text ? keyFromText(text) : null;
  if (!raw) throw new Error("the keychain didn't keep the key");
  return crypto.subtle.importKey("raw", buf(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** The file's keys; throws when it can't be opened (then it is left alone). */
async function readVault(key: CryptoKey): Promise<Record<string, string>> {
  const text = await api.signKeysRead();
  if (!text) return {};
  const f: unknown = JSON.parse(text);
  if (!f || typeof f !== "object" || !("iv" in f) || !("data" in f) || typeof f.iv !== "string" || typeof f.data !== "string") {
    throw new Error("sign-keys.json is damaged");
  }
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf(fromB64(f.iv)) }, key, buf(fromB64(f.data)));
  return textMap(JSON.parse(new TextDecoder().decode(plain)));
}

async function writeVault(key: CryptoKey, all: Record<string, string>) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: buf(iv) }, key, buf(new TextEncoder().encode(JSON.stringify(all)))));
  await api.signKeysWrite(JSON.stringify({ v: 1, iv: b64(iv), data: b64(data) }));
}

/** Load the keys once; moves keys from the webview's storage into the vault. */
export function loadKeys(): Promise<void> {
  loading ??= (async () => {
    const legacy = readLegacy();
    try {
      const key = await vaultKey();
      keys = { ...legacy, ...(await readVault(key)) };
      vault = key;
      if (Object.keys(legacy).length) {
        await writeVault(key, keys);
        localStorage.removeItem(LEGACY);
      }
    } catch (e) {
      console.warn("Request keys stay in the app's own storage:", e);
      keys = legacy;
      vault = null;
    }
  })();
  return loading;
}

function persist(): Promise<void> {
  const snapshot = { ...keys };
  const key = vault;
  const next = saving.then(async () => {
    if (key) await writeVault(key, snapshot);
    else localStorage.setItem(LEGACY, JSON.stringify(snapshot));
  });
  // One failed save mustn't block the ones after it; the caller still sees it.
  saving = next.catch(() => undefined);
  return next;
}

/** The key's text for a request, once loadKeys() has finished. */
export const keyText = (id: string): string | undefined => keys[id];

export async function keepKey(id: string, key: Uint8Array): Promise<void> {
  await loadKeys();
  keys[id] = keyToText(key);
  await persist();
}

export async function dropKey(id: string): Promise<void> {
  await loadKeys();
  delete keys[id];
  await persist();
}
