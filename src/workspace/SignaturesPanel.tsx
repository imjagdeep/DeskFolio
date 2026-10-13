// Every digital signature in the open PDF with its status: valid and
// trusted, valid but signer not trusted (self-made IDs), changed after
// signing, or broken. "Trust this signer" remembers the certificate.

import { useEffect, useState } from "react";
import type { OpenDoc } from "../lib/doc";
import { setTrusted, trustedFingerprints } from "../lib/sign/ids";
import { readSignatures, type SignatureStatus } from "../lib/sign/pades";
import { goToPage } from "./viewer";

type Verdict = { cls: "ok" | "warn" | "bad"; title: string; detail: string };

function verdict(s: SignatureStatus, trusted: Set<string>): Verdict {
  if (!s.intact) return { cls: "bad", title: "Signature is not valid", detail: s.problem ?? "The signed content was changed or the signature is damaged." };
  const known = s.signer ? trusted.has(s.signer.fingerprint) : false;
  const expired = s.signer ? s.signer.notAfter.getTime() < (s.signedAt ?? new Date()).getTime() : false;
  const later = s.wholeFile ? "" : " Changes were added after this signature (for example comments or another signature); the signed version itself is unchanged.";
  if (expired) return { cls: "warn", title: "Valid, but the ID had expired", detail: `The content is unchanged, but the signer's ID expired before the signing date.${later}` };
  if (!known)
    return {
      cls: "warn",
      title: "Valid, signer not verified",
      detail: `The content is unchanged since it was signed, but this ID isn't on your trusted list${s.signer?.selfSigned ? " (it is self-made)" : ""}. Trust it only if you know it belongs to this person.${later}`,
    };
  return { cls: "ok", title: "Valid and trusted", detail: `Signed by a trusted ID and unchanged since.${later}` };
}

export function SignaturesPanel({ doc }: { doc: OpenDoc }) {
  const [sigs, setSigs] = useState<SignatureStatus[] | null>(null);
  const [trusted, setTrustedSet] = useState(trustedFingerprints);
  useEffect(() => {
    let live = true;
    setSigs(null);
    readSignatures(doc.bytes)
      .then((s) => live && setSigs(s))
      .catch(() => live && setSigs([]));
    return () => {
      live = false;
    };
  }, [doc.bytes]);

  const toggle = (fp: string, on: boolean) => {
    setTrusted(fp, on);
    setTrustedSet(trustedFingerprints());
  };

  if (sigs === null) return <p className="muted small side-pad">Checking signatures…</p>;
  if (!sigs.length) return <p className="muted small side-pad">This PDF has no digital signatures. To sign it, use Fill &amp; Sign › Sign with digital ID.</p>;
  return (
    <ul className="sig-list">
      {sigs.map((s) => {
        const v = verdict(s, trusted);
        const fp = s.signer?.fingerprint;
        return (
          <li key={s.field} className={`sig-item ${v.cls}`}>
            <div className="sig-title">
              <span className={`sig-dot ${v.cls}`} aria-hidden="true" />
              <strong>{v.title}</strong>
            </div>
            <div className="small">
              {s.signer?.name ?? "Unknown signer"}
              {s.signer?.email ? ` · ${s.signer.email}` : ""}
            </div>
            <div className="muted small">
              {s.signedAt ? `Signed ${s.signedAt.toLocaleString()} (signer's clock)` : "No signing time"}
              {s.reason ? ` · ${s.reason}` : ""}
              {s.location ? ` · ${s.location}` : ""}
            </div>
            <p className="muted small">{v.detail}</p>
            <div className="page-actions">
              {s.page && <button onClick={() => s.page && goToPage(s.page)}>Go to page {s.page}</button>}
              {fp && s.intact && (
                <button onClick={() => toggle(fp, !trusted.has(fp))}>{trusted.has(fp) ? "Stop trusting" : "Trust this signer"}</button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
