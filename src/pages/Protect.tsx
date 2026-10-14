// Protect: an open password, permissions (printing, copying, editing…), and
// removing hidden information. The protection is applied whenever the
// document is saved (AES-256), like Acrobat's security settings.

import { useState } from "react";
import { PageHeader } from "../components/Common";
import { applyEdit, setProtection, useDoc } from "../lib/doc";
import { ALL_ALLOWED, allAllowed, sanitize, type Permissions, type SanitizeOptions } from "../lib/pdf/protect";
import { toast, toastError } from "../lib/store";
import { back } from "../workspace/route";

const PERMS: { id: keyof Permissions; label: string }[] = [
  { id: "print", label: "Print" },
  { id: "printHigh", label: "Print at full quality" },
  { id: "copy", label: "Copy text and pictures" },
  { id: "edit", label: "Change the document" },
  { id: "comment", label: "Add comments" },
  { id: "fillForms", label: "Fill in forms and sign" },
  { id: "assemble", label: "Insert, delete and rotate pages" },
];

function strength(pw: string): { label: string; ok: boolean } {
  if (!pw) return { label: "", ok: true };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (pw.length < 8) return { label: "Too short: use 8 characters or more", ok: false };
  if (pw.length >= 14 || (pw.length >= 10 && kinds >= 3)) return { label: "Strong", ok: true };
  return { label: kinds >= 2 ? "Fair" : "Weak: mix letters, numbers and symbols", ok: true };
}

export function Protect() {
  const doc = useDoc();
  const current = doc?.protection ?? null;
  const [usePassword, setUsePassword] = useState(!!current?.openPassword);
  const [pw, setPw] = useState(current?.openPassword ?? "");
  const [pw2, setPw2] = useState(current?.openPassword ?? "");
  const [show, setShow] = useState(false);
  const [restrict, setRestrict] = useState(current ? !allAllowed(current.permissions) : false);
  const [perms, setPerms] = useState<Permissions>(current?.permissions ?? ALL_ALLOWED);
  const [ownerPw, setOwnerPw] = useState("");
  const [clean, setClean] = useState<SanitizeOptions>({ metadata: true, attachments: true, scripts: true, comments: false });
  const [busy, setBusy] = useState(false);
  if (!doc) return null;

  const s = strength(pw);
  const mismatch = usePassword && pw !== pw2;
  const ownerOk = ownerPw.length >= 6 && ownerPw !== pw;
  const valid = (!usePassword || (pw.length >= 1 && s.ok && !mismatch)) && (!restrict || ownerOk);
  const changed = usePassword || restrict;

  const applyProtection = () => {
    if (!changed) {
      setProtection(null, "Protection removed");
      toast("Protection removed: the file opens and changes freely once saved.");
    } else {
      setProtection(
        { openPassword: usePassword ? pw : "", ownerPassword: restrict ? ownerPw : usePassword ? pw : "", permissions: restrict ? perms : ALL_ALLOWED },
        usePassword ? "Password protection" : "Permission restrictions",
      );
      toast("Protection set. It is applied when you save.");
    }
    back();
  };

  const runClean = async () => {
    setBusy(true);
    try {
      const r = await sanitize(doc.bytes, clean);
      if (!r.removed.length) toast("Nothing of that kind was found.");
      else if (await applyEdit(r.bytes, "Removed hidden information")) toast(`Removed ${r.removed.join(", ")}.`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title="Protect" subtitle="Who can open this PDF, what they can do with it, and what's hidden inside it." />

      <div className="card">
        <h2>Password to open</h2>
        <label className="check-row">
          <input type="checkbox" checked={usePassword} onChange={(e) => setUsePassword(e.target.checked)} />
          <span>
            Ask for a password to open this PDF
            <span className="muted small block">Encrypted with AES-256. There is no way back in without the password, so keep it somewhere safe.</span>
          </span>
        </label>
        {usePassword && (
          <div className="form-row">
            <label className="field">
              <span>Password</span>
              <input type={show ? "text" : "password"} value={pw} autoComplete="new-password" onChange={(e) => setPw(e.target.value)} />
              {pw && <span className={s.ok ? "muted small" : "error-text small"}>{s.label}</span>}
            </label>
            <label className="field">
              <span>Type it again</span>
              <input type={show ? "text" : "password"} value={pw2} autoComplete="new-password" onChange={(e) => setPw2(e.target.value)} />
              {mismatch && pw2 && <span className="error-text small">The two don't match.</span>}
            </label>
            <label className="check-row">
              <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
              <span>Show</span>
            </label>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Permissions</h2>
        <label className="check-row">
          <input type="checkbox" checked={restrict} onChange={(e) => setRestrict(e.target.checked)} />
          <span>
            Limit what people can do with it
            <span className="muted small block">Honoured by Acrobat, Chrome, Edge and most readers. It is a request, not a lock: some tools ignore it.</span>
          </span>
        </label>
        {restrict && (
          <>
            <div className="perm-grid">
              {PERMS.map((p) => (
                <label key={p.id} className="check-row">
                  <input type="checkbox" checked={perms[p.id]} disabled={p.id === "printHigh" && !perms.print} onChange={(e) => setPerms({ ...perms, [p.id]: e.target.checked })} />
                  <span>{p.label}</span>
                </label>
              ))}
            </div>
            <label className="field">
              <span>Permissions password (to change these later; at least 6 characters, different from the open password)</span>
              <input type="password" value={ownerPw} autoComplete="new-password" onChange={(e) => setOwnerPw(e.target.value)} />
              {ownerPw && !ownerOk && <span className="error-text small">{ownerPw === pw ? "Use a different password from the open password." : "At least 6 characters."}</span>}
            </label>
          </>
        )}
        <div className="action-bar">
          <span className="muted small">{current ? "This PDF is protected now. Untick both to remove the protection." : "Applied when you save the PDF."}</span>
          <div className="page-actions">
            <button onClick={back}>Cancel</button>
            <button className="primary" disabled={!valid || (!changed && !current)} onClick={applyProtection}>
              {changed || !current ? "Set protection" : "Remove protection"}
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Remove hidden information</h2>
        <p className="muted small">Things that travel with a PDF without showing on the page.</p>
        {(
          [
            ["metadata", "Title, author, software and other document information"],
            ["attachments", "Attached files"],
            ["scripts", "JavaScript and actions that run by themselves"],
            ["comments", "All comments and markup"],
          ] as const
        ).map(([id, label]) => (
          <label key={id} className="check-row">
            <input type="checkbox" checked={clean[id]} onChange={(e) => setClean({ ...clean, [id]: e.target.checked })} />
            <span>{label}</span>
          </label>
        ))}
        <div className="action-bar">
          <span className="muted small">Undo takes it back.</span>
          <button disabled={busy || !Object.values(clean).some(Boolean)} onClick={() => void runClean()}>
            {busy ? "Removing…" : "Remove"}
          </button>
        </div>
      </div>
    </div>
  );
}
