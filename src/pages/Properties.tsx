// Document properties: title, author, subject, keywords (what other apps and
// search show), plus facts about the file.

import { useEffect, useState } from "react";
import { PageHeader } from "../components/Common";
import { applyEdit, useDoc } from "../lib/doc";
import { humanSize } from "../lib/format";
import { readProperties, writeProperties, type Properties as Props } from "../lib/pdf/pagetools";
import { toastError } from "../lib/store";
import { back } from "../workspace/route";

export function Properties() {
  const doc = useDoc();
  const [p, setP] = useState<Props | null>(null);
  const [orig, setOrig] = useState<Props | null>(null);
  const [facts, setFacts] = useState<{ size: string; version: string; producer: string; created: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!doc) return;
    let live = true;
    readProperties(doc.bytes, { password: doc.password })
      .then((v) => {
        if (!live) return;
        setP(v);
        setOrig(v);
      })
      .catch(toastError);
    doc.pdf
      .getMetadata()
      .then((m) => {
        if (!live) return;
        const info: unknown = m.info;
        const get = (k: string) => {
          if (!info || typeof info !== "object" || !(k in info)) return "";
          const v: unknown = Object.getOwnPropertyDescriptor(info, k)?.value;
          return typeof v === "string" ? v : "";
        };
        setFacts({ size: humanSize(doc.bytes.length), version: get("PDFFormatVersion"), producer: [get("Producer"), get("Creator")].filter(Boolean).join(" · "), created: get("CreationDate") });
      })
      .catch(() => live && setFacts({ size: humanSize(doc.bytes.length), version: "", producer: "", created: "" }));
    return () => {
      live = false;
    };
  }, [doc]);

  if (!doc || !p) return null;
  const changed = JSON.stringify(p) !== JSON.stringify(orig);
  const save = async () => {
    setBusy(true);
    try {
      if (await applyEdit(await writeProperties(doc.bytes, p, { password: doc.password }), "Document properties")) back();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const field = (k: keyof Props, label: string, hint?: string) => (
    <label className="field">
      <span>{label}</span>
      <input value={p[k]} placeholder={hint} onChange={(e) => setP({ ...p, [k]: e.target.value })} />
    </label>
  );

  return (
    <div className="page">
      <PageHeader title="Document properties" subtitle="What other apps, file browsers and search show for this PDF." />
      <div className="card">
        {field("title", "Title", "Shown in the window title of PDF readers")}
        {field("author", "Author")}
        {field("subject", "Subject")}
        {field("keywords", "Keywords", "Separate with commas")}
      </div>
      {facts && (
        <div className="card facts">
          <div>
            <span className="muted">Pages</span>
            <strong>{doc.pages}</strong>
          </div>
          <div>
            <span className="muted">Size</span>
            <strong>{facts.size}</strong>
          </div>
          {facts.version && (
            <div>
              <span className="muted">PDF version</span>
              <strong>{facts.version}</strong>
            </div>
          )}
          {facts.producer && (
            <div>
              <span className="muted">Made with</span>
              <strong>{facts.producer}</strong>
            </div>
          )}
          <div>
            <span className="muted">Password</span>
            <strong>{doc.password ? "Yes" : "No"}</strong>
          </div>
        </div>
      )}
      <div className="action-bar">
        <span className="muted small">Undo takes it back.</span>
        <div className="page-actions">
          <button onClick={back}>Cancel</button>
          <button className="primary" disabled={busy || !changed} onClick={() => void save()}>
            Save properties
          </button>
        </div>
      </div>
    </div>
  );
}
