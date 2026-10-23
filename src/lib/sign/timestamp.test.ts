// Trusted timestamps (RFC 3161) against a fake timestamp authority made with the
// same libraries: a good token, a token for another signature, a wrong nonce, a
// refusal, and a token damaged inside a saved file.

import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { describe, expect, it } from "vitest";
import { createSelfSigned, importPrivateKey } from "./cms";
import { readSignatures, signPdf } from "./pades";

const TST_INFO = "1.2.840.113549.1.9.16.1.4";
const SIGNED_DATA = "1.2.840.113549.1.7.2";
const buf = (u: Uint8Array): ArrayBuffer => u.slice().buffer;

type Trick = "none" | "otherImprint" | "otherNonce" | "refuse";

async function fakeAuthority(trick: Trick = "none") {
  const id = await createSelfSigned({ name: "Test Timestamp Authority", kind: "ECDSA" });
  const key = await importPrivateKey(id.pkcs8);
  const cert = pkijs.Certificate.fromBER(buf(id.cert));
  let calls = 0;
  const tsa = async (reqDer: Uint8Array): Promise<Uint8Array> => {
    calls++;
    const req = pkijs.TimeStampReq.fromBER(buf(reqDer));
    if (trick === "refuse") {
      const resp = new pkijs.TimeStampResp({
        status: new pkijs.PKIStatusInfo({ status: 2, statusStrings: [new asn1js.Utf8String({ value: "bad request" })] }),
      });
      return new Uint8Array(resp.toSchema().toBER(false));
    }
    const imprint = trick === "otherImprint"
      ? new pkijs.MessageImprint({ hashAlgorithm: req.messageImprint.hashAlgorithm, hashedMessage: new asn1js.OctetString({ valueHex: new Uint8Array(32).fill(7).buffer }) })
      : req.messageImprint;
    const nonce = trick === "otherNonce" ? new asn1js.Integer({ value: 12345 }) : req.nonce;
    const tst = new pkijs.TSTInfo({
      version: 1,
      policy: "1.3.6.1.4.1.99999.1",
      messageImprint: imprint,
      serialNumber: new asn1js.Integer({ value: 42 }),
      genTime: new Date(),
      nonce,
    });
    const tstDer = tst.toSchema().toBER(false);
    const digest = await crypto.subtle.digest("SHA-256", tstDer);
    const sd = new pkijs.SignedData({
      version: 3,
      encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: TST_INFO, eContent: new asn1js.OctetString({ valueHex: tstDer }) }),
      signerInfos: [
        new pkijs.SignerInfo({
          version: 1,
          sid: new pkijs.IssuerAndSerialNumber({ issuer: cert.issuer, serialNumber: cert.serialNumber }),
          signedAttrs: new pkijs.SignedAndUnsignedAttributes({
            type: 0,
            attributes: [
              new pkijs.Attribute({ type: "1.2.840.113549.1.9.3", values: [new asn1js.ObjectIdentifier({ value: TST_INFO })] }),
              new pkijs.Attribute({ type: "1.2.840.113549.1.9.4", values: [new asn1js.OctetString({ valueHex: digest })] }),
            ],
          }),
        }),
      ],
      certificates: [cert],
    });
    await sd.sign(key, 0, "SHA-256");
    const resp = new pkijs.TimeStampResp({
      status: new pkijs.PKIStatusInfo({ status: 0 }),
      timeStampToken: new pkijs.ContentInfo({ contentType: SIGNED_DATA, content: sd.toSchema(true) }),
    });
    return new Uint8Array(resp.toSchema().toBER(false));
  };
  return { tsa, calls: () => calls };
}

async function sample(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]).drawText("Contract", { x: 40, y: 340, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
  return doc.save();
}

async function signer() {
  const id = await createSelfSigned({ name: "Alex Morgan", kind: "ECDSA" });
  return { cert: id.cert, chain: [], key: await importPrivateKey(id.pkcs8) };
}

const box = { page: 0, rect: [40, 40, 240, 100] as [number, number, number, number], name: "Alex Morgan" };

describe("trusted timestamps", () => {
  it("adds a timestamp that reads back as trusted time from the authority", async () => {
    const auth = await fakeAuthority();
    const before = Date.now();
    const signed = await signPdf(await sample(), { ...box, timestamper: auth.tsa }, await signer());
    expect(auth.calls()).toBe(1);
    const [s] = await readSignatures(signed);
    expect(s.intact).toBe(true);
    expect(s.timestamp?.intact).toBe(true);
    expect(s.timestamp?.authority).toBe("Test Timestamp Authority");
    const t = s.timestamp?.time.getTime() ?? 0;
    expect(t).toBeGreaterThanOrEqual(before - 2000);
    expect(t).toBeLessThanOrEqual(Date.now() + 2000);
  }, 60_000);

  it("a signature without one has no timestamp", async () => {
    const [s] = await readSignatures(await signPdf(await sample(), box, await signer()));
    expect(s.timestamp).toBeUndefined();
  }, 60_000);

  it("refuses a timestamp made for a different signature", async () => {
    const auth = await fakeAuthority("otherImprint");
    await expect(signPdf(await sample(), { ...box, timestamper: auth.tsa }, await signer())).rejects.toThrow(/different signature/);
  }, 60_000);

  it("refuses an answer to a different request (nonce)", async () => {
    const auth = await fakeAuthority("otherNonce");
    await expect(signPdf(await sample(), { ...box, timestamper: auth.tsa }, await signer())).rejects.toThrow(/different request/);
  }, 60_000);

  it("reports a refusal in plain words", async () => {
    const auth = await fakeAuthority("refuse");
    await expect(signPdf(await sample(), { ...box, timestamper: auth.tsa }, await signer())).rejects.toThrow(/refused the request: bad request/);
  }, 60_000);

  it("notices a timestamp damaged in the saved file, while the signature itself stays valid", async () => {
    const auth = await fakeAuthority();
    const signed = await signPdf(await sample(), { ...box, timestamper: auth.tsa }, await signer());
    // The CMS sits as hex in /Contents; the timestamp token is its last part, and
    // the token's own signature value its very end - change one hex digit there.
    const text = new TextDecoder("latin1").decode(signed);
    const start = text.lastIndexOf("/Contents <") + "/Contents <".length;
    const hex = text.slice(start, text.indexOf(">", start));
    const derEnd = hex.replace(/(00)+$/, "").length;
    const at = start + derEnd - 6;
    const damaged = signed.slice();
    damaged[at] = damaged[at] === 0x61 ? 0x62 : 0x61; // 'a' <-> 'b'
    const [s] = await readSignatures(damaged);
    expect(s.intact).toBe(true);
    expect(s.timestamp?.intact).toBe(false);
  }, 60_000);
});
