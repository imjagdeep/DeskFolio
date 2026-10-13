// The cryptography behind digital signatures, on the platform's own Web
// Crypto (no keys leave this computer):
// - creating a self-signed digital ID (RSA 3072 or ECDSA P-256),
// - CMS SignedData for PDF signatures (PAdES: detached, SHA-256, with the
//   ESS signing-certificate-v2 attribute and no signing-time attribute),
// - verifying such signatures and reading certificates.

import * as asn1js from "asn1js";
import * as pkijs from "pkijs";

const OID = {
  data: "1.2.840.113549.1.7.1",
  signedData: "1.2.840.113549.1.7.2",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  signingTime: "1.2.840.113549.1.9.5",
  signingCertificateV2: "1.2.840.113549.1.9.16.2.47",
  commonName: "2.5.4.3",
  organization: "2.5.4.10",
  country: "2.5.4.6",
  email: "1.2.840.113549.1.9.1",
  basicConstraints: "2.5.29.19",
  keyUsage: "2.5.29.15",
  extKeyUsage: "2.5.29.37",
  subjectKeyId: "2.5.29.14",
  rsa: "1.2.840.113549.1.1.1",
  ec: "1.2.840.10045.2.1",
  p256: "1.2.840.10045.3.1.7",
  p384: "1.3.132.0.34",
};

const buf = (u: Uint8Array): ArrayBuffer => u.slice().buffer;
const bytes = (b: ArrayBuffer) => new Uint8Array(b);

function crypto(): SubtleCrypto {
  const c = globalThis.crypto?.subtle;
  if (!c) throw new Error("This system has no Web Crypto.");
  return c;
}

export type KeyKind = "RSA" | "ECDSA";

function signAlgorithm(kind: KeyKind, curve = "P-256"): RsaHashedImportParams | EcKeyImportParams {
  return kind === "RSA" ? { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } : { name: "ECDSA", namedCurve: curve };
}

export interface NewIdOptions {
  name: string;
  email?: string;
  organization?: string;
  /** Two-letter country code. */
  country?: string;
  years?: number;
  kind?: KeyKind;
}

export interface IdMaterial {
  /** The certificate, DER. */
  cert: Uint8Array;
  /** The private key, PKCS#8 DER (kept encrypted at rest by the caller). */
  pkcs8: Uint8Array;
  /** Issuer certificates when imported from a .pfx (DER), nearest first. */
  chain: Uint8Array[];
}

function nameOf(o: NewIdOptions): pkijs.RelativeDistinguishedNames {
  const rdn = new pkijs.RelativeDistinguishedNames();
  const add = (type: string, value: string | undefined, printable = false) => {
    if (!value) return;
    rdn.typesAndValues.push(
      new pkijs.AttributeTypeAndValue({ type, value: printable ? new asn1js.PrintableString({ value }) : type === OID.email ? new asn1js.IA5String({ value }) : new asn1js.Utf8String({ value }) }),
    );
  };
  add(OID.country, o.country?.toUpperCase().slice(0, 2), true);
  add(OID.organization, o.organization);
  add(OID.commonName, o.name);
  add(OID.email, o.email);
  return rdn;
}

/** Create a self-signed digital ID for signing documents. */
export async function createSelfSigned(o: NewIdOptions): Promise<IdMaterial> {
  const kind = o.kind ?? "RSA";
  const gen: RsaHashedKeyGenParams | EcKeyGenParams =
    kind === "RSA" ? { name: "RSASSA-PKCS1-v1_5", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" } : { name: "ECDSA", namedCurve: "P-256" };
  const keys = await crypto().generateKey(gen, true, ["sign", "verify"]);
  const cert = new pkijs.Certificate();
  cert.version = 2;
  const serial = new Uint8Array(16);
  globalThis.crypto.getRandomValues(serial);
  serial[0] &= 0x7f;
  cert.serialNumber = new asn1js.Integer({ valueHex: buf(serial) });
  cert.subject = nameOf(o);
  cert.issuer = nameOf(o);
  const now = new Date();
  cert.notBefore.value = new Date(now.getTime() - 60_000);
  cert.notAfter.value = new Date(now.getFullYear() + (o.years ?? 5), now.getMonth(), now.getDate());
  await cert.subjectPublicKeyInfo.importKey(keys.publicKey);
  const spki = new Uint8Array(cert.subjectPublicKeyInfo.subjectPublicKey.valueBlock.valueHexView);
  const keyId = bytes(await crypto().digest("SHA-1", buf(spki)));
  // digitalSignature (bit 0) + nonRepudiation (bit 1).
  const keyUsage = new asn1js.BitString({ valueHex: buf(new Uint8Array([0xc0])), unusedBits: 6 });
  cert.extensions = [
    new pkijs.Extension({ extnID: OID.basicConstraints, critical: true, extnValue: new pkijs.BasicConstraints({ cA: false }).toSchema().toBER(false), parsedValue: new pkijs.BasicConstraints({ cA: false }) }),
    new pkijs.Extension({ extnID: OID.keyUsage, critical: true, extnValue: keyUsage.toBER(false) }),
    new pkijs.Extension({
      extnID: OID.extKeyUsage,
      extnValue: new pkijs.ExtKeyUsage({ keyPurposes: ["1.3.6.1.5.5.7.3.4", "1.3.6.1.5.5.7.3.36", "1.2.840.113583.1.1.5"] }).toSchema().toBER(false),
    }),
    new pkijs.Extension({ extnID: OID.subjectKeyId, extnValue: new asn1js.OctetString({ valueHex: buf(keyId) }).toBER(false) }),
  ];
  await cert.sign(keys.privateKey, "SHA-256");
  const pkcs8 = bytes(await crypto().exportKey("pkcs8", keys.privateKey));
  return { cert: bytes(cert.toSchema(true).toBER(false)), pkcs8, chain: [] };
}

/** Which algorithm a PKCS#8 key is for, so Web Crypto can load it. */
export function keyKindOf(pkcs8: Uint8Array): { kind: KeyKind; curve?: string } {
  const info = pkijs.PrivateKeyInfo.fromBER(buf(pkcs8));
  const alg = info.privateKeyAlgorithm.algorithmId;
  if (alg === OID.rsa) return { kind: "RSA" };
  if (alg === OID.ec) {
    const params = info.privateKeyAlgorithm.algorithmParams;
    const curveOid = params instanceof asn1js.ObjectIdentifier ? params.valueBlock.toString() : "";
    if (curveOid === OID.p384) return { kind: "ECDSA", curve: "P-384" };
    if (curveOid === OID.p256) return { kind: "ECDSA", curve: "P-256" };
    throw new Error("This digital ID uses an elliptic curve DeskFolio doesn't support yet (P-256 and P-384 are supported).");
  }
  throw new Error("This digital ID uses a key type DeskFolio doesn't support (RSA and ECDSA are supported).");
}

export async function importPrivateKey(pkcs8: Uint8Array): Promise<CryptoKey> {
  const { kind, curve } = keyKindOf(pkcs8);
  return crypto().importKey("pkcs8", buf(pkcs8), signAlgorithm(kind, curve), false, ["sign"]);
}

/** ESS signing-certificate-v2: the SHA-256 of the signer's certificate (PAdES requires it). */
async function signingCertificateV2(certDer: Uint8Array): Promise<pkijs.Attribute> {
  const hash = await crypto().digest("SHA-256", buf(certDer));
  const essCertIdV2 = new asn1js.Sequence({ value: [new asn1js.OctetString({ valueHex: hash })] });
  const value = new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [essCertIdV2] })] });
  return new pkijs.Attribute({ type: OID.signingCertificateV2, values: [value] });
}

/**
 * Detached CMS SignedData over `data` (the PDF bytes the signature covers),
 * signed with `key` for `cert` (plus its chain).
 */
export async function signDetached(data: Uint8Array, cert: Uint8Array, chain: Uint8Array[], key: CryptoKey): Promise<Uint8Array> {
  const signer = pkijs.Certificate.fromBER(buf(cert));
  const digest = await crypto().digest("SHA-256", buf(data));
  const attrs = new pkijs.SignedAndUnsignedAttributes({
    type: 0,
    attributes: [
      new pkijs.Attribute({ type: OID.contentType, values: [new asn1js.ObjectIdentifier({ value: OID.data })] }),
      new pkijs.Attribute({ type: OID.messageDigest, values: [new asn1js.OctetString({ valueHex: digest })] }),
      await signingCertificateV2(cert),
    ],
  });
  const sd = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: OID.data }),
    signerInfos: [
      new pkijs.SignerInfo({
        version: 1,
        sid: new pkijs.IssuerAndSerialNumber({ issuer: signer.issuer, serialNumber: signer.serialNumber }),
        signedAttrs: attrs,
      }),
    ],
    certificates: [signer, ...chain.map((c) => pkijs.Certificate.fromBER(buf(c)))],
  });
  await sd.sign(key, 0, "SHA-256");
  const ci = new pkijs.ContentInfo({ contentType: OID.signedData, content: sd.toSchema(true) });
  return bytes(ci.toSchema().toBER(false));
}

export interface CertInfo {
  name: string;
  email: string;
  organization: string;
  issuer: string;
  notBefore: Date;
  notAfter: Date;
  selfSigned: boolean;
  /** SHA-256 of the certificate, hex (what "trust this ID" remembers). */
  fingerprint: string;
}

function rdnValue(rdn: pkijs.RelativeDistinguishedNames, type: string): string {
  const v = rdn.typesAndValues.find((t) => t.type === type)?.value;
  return v && "valueBlock" in v && v.valueBlock && "value" in v.valueBlock && typeof v.valueBlock.value === "string" ? v.valueBlock.value : "";
}

export async function certInfo(der: Uint8Array): Promise<CertInfo> {
  const c = pkijs.Certificate.fromBER(buf(der));
  const fp = bytes(await crypto().digest("SHA-256", buf(der)));
  const subject = rdnValue(c.subject, OID.commonName);
  const issuer = rdnValue(c.issuer, OID.commonName) || rdnValue(c.issuer, OID.organization);
  return {
    name: subject || rdnValue(c.subject, OID.organization) || "Unknown signer",
    email: rdnValue(c.subject, OID.email),
    organization: rdnValue(c.subject, OID.organization),
    issuer,
    notBefore: c.notBefore.value,
    notAfter: c.notAfter.value,
    selfSigned: c.subject.isEqual(c.issuer),
    fingerprint: Array.from(fp, (b) => b.toString(16).padStart(2, "0")).join(""),
  };
}

export interface CmsCheck {
  /** The signature matches the signed bytes and the signer's key. */
  intact: boolean;
  /** The signer's certificate (DER), if present. */
  signer: Uint8Array | null;
  /** Every certificate the signature carries (DER). */
  certificates: Uint8Array[];
  /** Why it isn't intact, in plain words. */
  problem?: string;
}

/** Check a detached CMS signature over `data`. */
export async function verifyDetached(cms: Uint8Array, data: Uint8Array): Promise<CmsCheck> {
  let sd: pkijs.SignedData;
  try {
    const ci = pkijs.ContentInfo.fromBER(buf(trimDer(cms)));
    if (ci.contentType !== OID.signedData) return { intact: false, signer: null, certificates: [], problem: "Not a CMS signature." };
    sd = new pkijs.SignedData({ schema: ci.content });
  } catch {
    return { intact: false, signer: null, certificates: [], problem: "The signature data is damaged." };
  }
  const certs = (sd.certificates ?? []).filter((c): c is pkijs.Certificate => c instanceof pkijs.Certificate);
  const certificates = certs.map((c) => bytes(c.toSchema(true).toBER(false)));
  const sid = sd.signerInfos[0]?.sid;
  const signerCert =
    sid instanceof pkijs.IssuerAndSerialNumber ? certs.find((c) => c.issuer.isEqual(sid.issuer) && c.serialNumber.isEqual(sid.serialNumber)) : certs[0];
  const signer = signerCert ? bytes(signerCert.toSchema(true).toBER(false)) : null;
  try {
    const r = await sd.verify({ signer: 0, data: buf(data), checkChain: false, extendedMode: true });
    return r.signatureVerified ? { intact: true, signer, certificates } : { intact: false, signer, certificates, problem: "The document was changed after it was signed, or the signature is not valid." };
  } catch (e) {
    const msg = e && typeof e === "object" && "message" in e && typeof e.message === "string" ? e.message : String(e);
    return { intact: false, signer, certificates, problem: /digest/i.test(msg) ? "The document was changed after it was signed." : `The signature couldn't be checked: ${msg}` };
  }
}

/** /Contents is zero-padded; cut the DER to its declared length. */
export function trimDer(b: Uint8Array): Uint8Array {
  if (b.length < 2 || b[0] !== 0x30) return b;
  let len = b[1];
  let head = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | b[2 + i];
    head = 2 + n;
  }
  return b.subarray(0, Math.min(b.length, head + len));
}
