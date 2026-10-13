// Digital IDs: create a self-signed ID, import one (.pfx / .p12) from a
// certificate provider or another app, export a backup, delete.

import { open, save } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../components/Common";
import { createId, deleteId, exportPfx, importPfx, listIds, type IdSummary } from "../lib/sign/ids";
import { toast, toastError } from "../lib/store";

export function DigitalIds() {
  const [ids, setIds] = useState<IdSummary[] | null>(null);
  const [mode, setMode] = useState<"list" | "create" | "import">("list");
  const reload = useCallback(() => {
    listIds().then(setIds).catch((e) => {
      toastError(e);
      setIds([]);
    });
  }, []);
  useEffect(reload, [reload]);

  return (
    <div className="page">
      <PageHeader title="Digital IDs" subtitle="What you sign PDFs with. Kept on this computer, each locked with its own password.">
        {mode === "list" && (
          <>
            <button onClick={() => setMode("import")}>Import…</button>
            <button className="primary" onClick={() => setMode("create")}>
              New digital ID
            </button>
          </>
        )}
      </PageHeader>
      {mode === "create" && <CreateForm onDone={() => (setMode("list"), reload())} />}
      {mode === "import" && <ImportForm onDone={() => (setMode("list"), reload())} />}
      {mode === "list" && (
        <>
          {ids === null && <div className="card muted">Reading your digital IDs…</div>}
          {ids?.length === 0 && (
            <div className="card">
              <h2>No digital IDs yet</h2>
              <p className="muted small">
                Make one here (free, ready in a second), or import one you got from a certificate provider (a .pfx or .p12 file). A self-made ID proves the PDF wasn't changed after
                you signed it. Other people's PDF readers show your name as "not verified" until they choose to trust it; a green check everywhere needs an ID from a provider on
                Adobe's trusted list.
              </p>
            </div>
          )}
          {ids?.map((id) => <IdCard key={id.file} id={id} onChange={reload} />)}
        </>
      )}
    </div>
  );
}

function IdCard({ id, onChange }: { id: IdSummary; onChange: () => void }) {
  const [exporting, setExporting] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const expired = id.info.notAfter.getTime() < Date.now();
  const doExport = async () => {
    try {
      const path = await save({ defaultPath: `${id.info.name}.pfx`, filters: [{ name: "Digital ID", extensions: ["pfx", "p12"] }] });
      if (!path) return;
      await exportPfx(id.file, pw, path, pw2 || pw, id.info.name);
      toast("Digital ID exported. Keep the file and its password safe.");
      setExporting(false);
      setPw("");
      setPw2("");
    } catch (e) {
      toastError(e);
    }
  };
  const doDelete = async () => {
    const { ask } = await import("@tauri-apps/plugin-dialog");
    const ok = await ask(`Delete the digital ID "${id.info.name}"? PDFs you already signed stay signed, but you can't sign with this ID again unless you have a backup.`, {
      title: "Delete digital ID",
      kind: "warning",
      okLabel: "Delete",
      cancelLabel: "Keep it",
    });
    if (!ok) return;
    try {
      await deleteId(id.file);
      onChange();
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <div className="card id-card">
      <div className="id-head">
        <div>
          <strong>{id.info.name}</strong>
          {id.info.email && <span className="muted"> · {id.info.email}</span>}
          <div className="muted small">
            {id.info.selfSigned ? "Self-made (self-signed)" : `Issued by ${id.info.issuer}`} · valid until {id.info.notAfter.toLocaleDateString()}
            {expired && <span className="error-text"> · expired</span>}
          </div>
          <div className="muted small mono">SHA-256 {id.info.fingerprint.slice(0, 32)}…</div>
        </div>
        <div className="page-actions">
          <button onClick={() => setExporting(!exporting)}>Export…</button>
          <button className="danger" onClick={() => void doDelete()}>
            Delete
          </button>
        </div>
      </div>
      {exporting && (
        <div className="form-row">
          <label className="field">
            <span>This ID's password</span>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </label>
          <label className="field">
            <span>Password for the exported file (empty = same)</span>
            <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </label>
          <button className="primary" disabled={!pw} onClick={() => void doExport()}>
            Save .pfx…
          </button>
        </div>
      )}
    </div>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ name: "", email: "", organization: "", country: "", pw: "", pw2: "", kind: "RSA" as "RSA" | "ECDSA" });
  const [busy, setBusy] = useState(false);
  const ok = f.name.trim() && f.pw.length >= 6 && f.pw === f.pw2;
  const create = async () => {
    setBusy(true);
    try {
      await createId({ name: f.name.trim(), email: f.email.trim() || undefined, organization: f.organization.trim() || undefined, country: f.country.trim() || undefined, kind: f.kind }, f.pw);
      toast("Digital ID created. Consider exporting a backup.");
      onDone();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const field = (k: "name" | "email" | "organization" | "country", label: string, ph = "") => (
    <label className="field">
      <span>{label}</span>
      <input value={f[k]} placeholder={ph} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  );
  return (
    <div className="card">
      <h2>New digital ID</h2>
      <div className="form-row">
        {field("name", "Your name (as it appears on signatures)")}
        {field("email", "Email (optional)")}
      </div>
      <div className="form-row">
        {field("organization", "Organisation (optional)")}
        {field("country", "Country code (optional)", "CA")}
        <label className="field">
          <span>Key</span>
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value === "ECDSA" ? "ECDSA" : "RSA" })}>
            <option value="RSA">RSA 3072 (works everywhere)</option>
            <option value="ECDSA">ECDSA P-256 (smaller, newer readers)</option>
          </select>
        </label>
      </div>
      <div className="form-row">
        <label className="field">
          <span>Password (at least 6 characters)</span>
          <input type="password" value={f.pw} autoComplete="new-password" onChange={(e) => setF({ ...f, pw: e.target.value })} />
        </label>
        <label className="field">
          <span>Type it again</span>
          <input type="password" value={f.pw2} autoComplete="new-password" onChange={(e) => setF({ ...f, pw2: e.target.value })} />
        </label>
      </div>
      <p className="muted small">The password is needed every time you sign. If you forget it, the ID can't be used; there is no reset.</p>
      <div className="action-bar">
        <span />
        <div className="page-actions">
          <button onClick={onDone}>Cancel</button>
          <button className="primary" disabled={!ok || busy} onClick={() => void create()}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportForm({ onDone }: { onDone: () => void }) {
  const [path, setPath] = useState("");
  const [pw, setPw] = useState("");
  const [savePw, setSavePw] = useState("");
  const [busy, setBusy] = useState(false);
  const pick = async () => {
    const p = await open({ title: "Digital ID file", filters: [{ name: "Digital ID", extensions: ["pfx", "p12"] }] });
    if (typeof p === "string") setPath(p);
  };
  const needNew = pw.length < 6;
  const go = async () => {
    setBusy(true);
    try {
      await importPfx(path, pw, needNew ? savePw : pw);
      toast("Digital ID imported.");
      onDone();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <h2>Import a digital ID</h2>
      <div className="form-row">
        <button onClick={() => void pick()}>{path ? "Change file…" : "Choose .pfx or .p12…"}</button>
        {path && <span className="muted small ellipsis">{path}</span>}
      </div>
      <label className="field">
        <span>The file's password</span>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
      </label>
      {pw && needNew && (
        <label className="field">
          <span>That password is short; choose one of at least 6 characters for DeskFolio's copy</span>
          <input type="password" value={savePw} autoComplete="new-password" onChange={(e) => setSavePw(e.target.value)} />
        </label>
      )}
      <div className="action-bar">
        <span className="muted small">The file stays as it is; DeskFolio keeps its own locked copy.</span>
        <div className="page-actions">
          <button onClick={onDone}>Cancel</button>
          <button className="primary" disabled={!path || !pw || (needNew && savePw.length < 6) || busy} onClick={() => void go()}>
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
