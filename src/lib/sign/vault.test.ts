import { beforeEach, describe, expect, it, vi } from "vitest";

// Rust's side (keychain + key file), played by a stand-in.
const os = { keychain: null as string | null, file: null as string | null, keychainWorks: true };
vi.mock("../api", () => ({
  api: {
    signVaultKey: async () => {
      if (!os.keychainWorks) throw new Error("no keychain");
      return os.keychain;
    },
    signVaultKeySet: async (k: string) => {
      os.keychain = k;
    },
    signKeysRead: async () => os.file,
    signKeysWrite: async (t: string) => {
      os.file = t;
    },
  },
}));

const KEY = new Uint8Array(32).fill(7);
const KEY_TEXT = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc";

let data: Map<string, string>;
beforeEach(() => {
  vi.resetModules();
  os.keychain = null;
  os.file = null;
  os.keychainWorks = true;
  data = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    },
  });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

const fresh = () => import("./vault");

describe("request keys", () => {
  it("are kept in an encrypted file whose key is in the keychain, and come back after a restart", async () => {
    const v = await fresh();
    await v.keepKey("req-1", KEY);
    expect(os.keychain).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(os.file).not.toContain(KEY_TEXT);
    expect(data.size).toBe(0);
    vi.resetModules();
    const again = await fresh();
    await again.loadKeys();
    expect(again.keyText("req-1")).toBe(KEY_TEXT);
  });

  it("move over from the webview's storage, which is then cleared", async () => {
    data.set("deskfolio-sign-keys", JSON.stringify({ old: KEY_TEXT }));
    const v = await fresh();
    await v.loadKeys();
    expect(v.keyText("old")).toBe(KEY_TEXT);
    expect(data.has("deskfolio-sign-keys")).toBe(false);
    expect(os.file).not.toBeNull();
  });

  it("survive a reset of the webview's storage", async () => {
    await (await fresh()).keepKey("req-1", KEY);
    data.clear();
    vi.resetModules();
    const v = await fresh();
    await v.loadKeys();
    expect(v.keyText("req-1")).toBe(KEY_TEXT);
  });

  it("stay in the webview's storage when there is no keychain", async () => {
    os.keychainWorks = false;
    const v = await fresh();
    await v.keepKey("req-1", KEY);
    expect(os.file).toBeNull();
    expect(JSON.parse(data.get("deskfolio-sign-keys") ?? "{}")).toEqual({ "req-1": KEY_TEXT });
  });

  it("leave a file they can't open alone (a different keychain key)", async () => {
    await (await fresh()).keepKey("req-1", KEY);
    const before = os.file;
    os.keychain = "A".repeat(43);
    vi.resetModules();
    const v = await fresh();
    await v.keepKey("req-2", KEY);
    expect(os.file).toBe(before);
    expect(v.keyText("req-2")).toBe(KEY_TEXT);
  });

  it("can be dropped", async () => {
    const v = await fresh();
    await v.keepKey("req-1", KEY);
    await v.dropKey("req-1");
    vi.resetModules();
    const again = await fresh();
    await again.loadKeys();
    expect(again.keyText("req-1")).toBeUndefined();
  });
});
