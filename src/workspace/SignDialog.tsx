// Digital signing: after the user draws the signature box (tool "digisign"),
// pick a digital ID, type its password, optionally show a handwritten
// signature, then save the signed copy. Signing always writes a file,
// because the signature covers the exact saved bytes.

import { useEffect, useState, useSyncExternalStore } from "react";
import { useSignatures } from "../components/SignaturePad";
import { api } from "../lib/api";
import { currentDoc, flushPending, pickSavePath, replaceWithSaved } from "../lib/doc";
import { siblingPath } from "../lib/format";
import { listIds, unlockId, type IdSummary } from "../lib/sign/ids";
import { signPdf } from "../lib/sign/pades";
import { createStore, toast, toastError } from "../lib/store";
import { go } from "./route";
import { clearOwnTool } from "./markup";
import { setPanel } from "./panels";

export interface SignRequest {
  page: number;
  rect: [number, number, number, number];
}

const reqStore = createStore<SignRequest | null>(null);
export const requestSignature = (r: SignRequest) => reqStore.set(r);
const useRequest = () => useSyncExternalStore(reqStore.subscribe, reqStore.get);

const LAST_ID = "deskfolio-last-digital-id";
const readLast = () => {
  try {
    return localStorage.getItem(LAST_ID) ?? "";
  } catch {
    // Storage unavailable: no default ID.
    return "";
  }
};

function dataUrlBytes(url: string): Uint8Array {
  const b64 = url.slice(url.indexOf(",") + 1);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function SignDialog() {
  const req = useRequest();
  const sigs = useSignatures();
  const [ids, setIds] = useState<IdSummary[] | null>(null);
  const [file, setFile] = useState("");
  const [pw, setPw] = useState("");
  const [reason, setReason] = useState("");
  const [location, setLocation] = useState("");
  const [image, setImage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!req) return;
    setPw("");
    listIds()
      .then((list) => {
        setIds(list);
        const last = readLast();
        setFile(list.some((i) => i.file === last) ? last : (list[0]?.file ?? ""));
      })
      .catch((e) => {
        toastError(e);
        setIds([]);
      });
  }, [req]);

  if (!req) return null;
  const close = () => reqStore.set(null);
  const chosen = ids?.find((i) => i.file === file);

  const sign = async () => {
    const d = currentDoc();
    if (!d || !chosen) return;
    if (d.protection) {
      toastError("Remove the password protection first (Protect tab); signing protected PDFs isn't supported yet.");
      return;
    }
    setBusy(true);
    try {
      await flushPending();
      const doc = currentDoc();
      if (!doc) return;
      const signer = await unlockId(chosen.file, pw);
      const sig = sigs.find((s) => s.id === image);
      const signed = await signPdf(doc.bytes, { page: req.page, rect: req.rect, name: chosen.info.name, reason: reason.trim() || undefined, location: location.trim() || undefined, image: sig ? dataUrlBytes(sig.dataUrl) : undefined }, signer);
      const target = await pickSavePath(siblingPath(doc.path, "signed"));
      if (!target) return;
      await api.writeFile(target, signed);
      await replaceWithSaved(signed, target, `Signed by ${chosen.info.name}`);
      try {
        localStorage.setItem(LAST_ID, chosen.file);
      } catch {
        // Not remembered; fine.
      }
      toast(`Signed and saved as ${target.split(/[\\/]/).pop() ?? target}`);
      clearOwnTool();
      setPanel("signatures");
      close();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Sign with digital ID">
      <div className="modal card sign-dialog">
        <h2>Sign with a digital ID</h2>
        {ids === null && <p className="muted">Reading your digital IDs…</p>}
        {ids?.length === 0 && (
          <>
            <p className="muted small">You don't have a digital ID yet. Make one (takes a second) or import a .pfx file, then draw the box again.</p>
            <div className="action-bar">
              <span />
              <div className="page-actions">
                <button onClick={close}>Cancel</button>
                <button
                  className="primary"
                  onClick={() => {
                    close();
                    clearOwnTool();
                    go("digitalids");
                  }}
                >
                  Set up a digital ID…
                </button>
              </div>
            </div>
          </>
        )}
        {ids && ids.length > 0 && (
          <>
            <label className="field">
              <span>Digital ID</span>
              <select value={file} onChange={(e) => setFile(e.target.value)}>
                {ids.map((i) => (
                  <option key={i.file} value={i.file}>
                    {i.info.name}
                    {i.info.email ? ` (${i.info.email})` : ""}
                    {i.info.selfSigned ? " · self-made" : ` · ${i.info.issuer}`}
                  </option>
                ))}
              </select>
            </label>
            {chosen && chosen.info.notAfter.getTime() < Date.now() && <p className="error-text small">This ID has expired; readers will show the signature as not valid.</p>}
            <label className="field">
              <span>Password</span>
              <input type="password" value={pw} autoFocus onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && pw && !busy && void sign()} />
            </label>
            <div className="form-row">
              <label className="field">
                <span>Reason (optional)</span>
                <input value={reason} placeholder="I approve this document" onChange={(e) => setReason(e.target.value)} />
              </label>
              <label className="field">
                <span>Location (optional)</span>
                <input value={location} onChange={(e) => setLocation(e.target.value)} />
              </label>
            </div>
            {sigs.length > 0 && (
              <label className="field">
                <span>Show my handwritten signature</span>
                <select value={image} onChange={(e) => setImage(e.target.value)}>
                  <option value="">No, just the text</option>
                  {sigs.map((s, n) => (
                    <option key={s.id} value={s.id}>
                      Saved signature {n + 1}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="muted small">The signed copy is saved as a new file. Changing it afterwards shows the signature as broken, so finish other edits first.</p>
            <div className="action-bar">
              <span />
              <div className="page-actions">
                <button onClick={close} disabled={busy}>
                  Cancel
                </button>
                <button className="primary" disabled={!pw || !chosen || busy} onClick={() => void sign()}>
                  {busy ? "Signing…" : "Sign and save…"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
