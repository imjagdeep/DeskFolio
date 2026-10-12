import { useState } from "react";
import { Empty, PageHeader } from "../components/Common";
import { OcrIcon } from "../components/Icons";
import { applyEdit, openDialog, useDoc } from "../lib/doc";
import { plural } from "../lib/format";
import { ocrPdf } from "../lib/ocr";
import { toast, toastError } from "../lib/store";

export function Ocr() {
  const doc = useDoc();
  const [onlyWithoutText, setOnlyWithoutText] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [pct, setPct] = useState(0);

  if (!doc) {
    return (
      <div className="page">
        <Empty Icon={OcrIcon} title="No PDF open" text="Open a scanned PDF to make its text searchable and copyable.">
          <button className="primary" onClick={() => void openDialog()}>
            Open a PDF…
          </button>
        </Empty>
      </div>
    );
  }

  const run = async () => {
    setBusy(true);
    setPct(0);
    setStatus("Checking which pages need reading…");
    try {
      const r = await ocrPdf(doc.pdf, doc.bytes, {
        password: doc.password,
        onlyWithoutText,
        onProgress: (page, total, stage) => {
          setPct(total ? page / total : 0);
          setStatus(stage === "loading" ? "Starting the text reader…" : `Reading page ${Math.min(page + 1, total)} of ${total}…`);
        },
      });
      if (!r.read) {
        toast("Every page already has text, so there was nothing to read. Untick the option to read them again.");
        return;
      }
      const ok = await applyEdit(r.bytes, `Made ${plural(r.read, "page")} searchable`);
      if (ok) {
        toast(
          r.words
            ? `Found ${plural(r.words, "word")} on ${plural(r.read, "page")}. Check it in View with Find, then save.`
            : `No text was found on ${plural(r.read, "page")}. The pages may be photos, or the scan too faint.`,
        );
      }
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="OCR"
        subtitle="Read the text in scanned pages so you can search, select and copy it. The pages look exactly the same."
      />
      <div className="card convert-panel">
        <div className="ellipsis wide-ellipsis">
          <strong>{doc.name}</strong> <span className="muted">· {plural(doc.pages, "page")}</span>
        </div>
        <label className="check-row inline">
          <input type="checkbox" checked={onlyWithoutText} disabled={busy} onChange={(e) => setOnlyWithoutText(e.target.checked)} />
          <span>Only pages without text (skip pages that are already searchable)</span>
        </label>
        <p className="muted small">
          Language: English (built in, works offline). Reading takes a few seconds per page. Handwriting and very faint scans may not
          be read well.
        </p>
      </div>
      <div className="action-bar">
        <span className="muted">{busy ? status : "Nothing is saved until you choose Save in View."}</span>
        <div className="page-actions">
          <button className="primary" disabled={busy} onClick={() => void run()}>
            {busy ? "Reading…" : "Make searchable"}
          </button>
        </div>
      </div>
      {busy && (
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}>
          <div style={{ width: `${pct * 100}%` }} />
        </div>
      )}
    </div>
  );
}
