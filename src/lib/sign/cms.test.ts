import { describe, expect, it } from "vitest";
import { certInfo, createSelfSigned, importPrivateKey, keyKindOf, signDetached, trimDer, verifyDetached } from "./cms";

const data = new TextEncoder().encode("%PDF-1.7 the bytes a signature covers");

describe("digital IDs and CMS signatures", () => {
  for (const kind of ["RSA", "ECDSA"] as const) {
    it(`signs and verifies with a new ${kind} ID, and notices tampering`, async () => {
      const id = await createSelfSigned({ name: "Alex Morgan", email: "alex@example.com", organization: "Example Ltd", country: "ca", kind });
      expect(keyKindOf(id.pkcs8).kind).toBe(kind);
      const info = await certInfo(id.cert);
      expect(info).toMatchObject({ name: "Alex Morgan", email: "alex@example.com", organization: "Example Ltd", selfSigned: true });
      expect(info.notAfter.getFullYear()).toBe(new Date().getFullYear() + 5);
      expect(info.fingerprint).toMatch(/^[0-9a-f]{64}$/);

      const cms = await signDetached(data, id.cert, [], await importPrivateKey(id.pkcs8));
      const ok = await verifyDetached(cms, data);
      expect(ok.intact).toBe(true);
      expect(ok.signer).toEqual(id.cert);

      const changed = data.slice();
      changed[5] ^= 1;
      const bad = await verifyDetached(cms, changed);
      expect(bad.intact).toBe(false);
      expect(bad.problem).toMatch(/changed|not valid/);
    }, 60_000);
  }

  it("reads signatures padded with zeros, as stored in a PDF", async () => {
    const id = await createSelfSigned({ name: "Pad Test", kind: "ECDSA" });
    const cms = await signDetached(data, id.cert, [], await importPrivateKey(id.pkcs8));
    const padded = new Uint8Array(cms.length + 500);
    padded.set(cms);
    expect(trimDer(padded)).toEqual(cms);
    expect((await verifyDetached(padded, data)).intact).toBe(true);
  });

  it("calls garbage damaged instead of crashing", async () => {
    expect((await verifyDetached(new Uint8Array([1, 2, 3]), data)).intact).toBe(false);
  });
});
