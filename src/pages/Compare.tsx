// Compare: the open document against another PDF, page by page, showing
// which words were added, removed or changed. Compares the text, not the
// look; scans need OCR first.

import { useState } from "react";
import { Empty, PageHeader } from "../components/Common";
import { CompareIcon } from "../components/Icons";
import { api } from "../lib/api";
import { loadWithPassword, pickPdfs, useDoc } from "../lib/doc";
import { fileName } from "../lib/format";
import { comparePages, type PageDiff } from "../lib/pdf/compare";
import { closePdf, type PDFDocumentProxy } from "../lib/pdfjs";
import { toastError } from "../lib/store";

async function pageTexts(pdf: PDFDocumentProxy): Promise<string[]> {
  const out: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const c = await (await pdf.getPage(i)).getTextContent();
    out.push(c.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return out;
}

export function Compare() {
  const doc = useDoc();
  const [other, setOther] = useState<{ name: string; diffs: PageDiff[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [olderIsOther, setOlderIsOther] = useState(true);
  if (!doc) return null;

  const pick = async () => {
    try {
      const [path] = await pickPdfs(false, "PDF to compare with");
      if (!path) return;
      setBusy(true);
      const bytes = await api.readFile(path);
      const loaded = await loadWithPassword(bytes, fileName(path));
      if (!loaded) return;
      try {
        const [mine, theirs] = await Promise.all([pageTexts(doc.pdf), pageTexts(loaded.pdf)]);
        setOther({ name: fileName(path), diffs: olderIsOther ? comparePages(theirs, mine) : comparePages(mine, theirs) });
      } finally {
        closePdf(loaded.pdf);
      }
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const shown = other ? other.diffs.filter((d) => !onlyChanged || d.changes > 0) : [];
  const changed = other ? other.diffs.filter((d) => d.changes > 0).length : 0;
  const oldName = olderIsOther ? (other?.name ?? "the other PDF") : doc.name;
  const newName = olderIsOther ? doc.name : (other?.name ?? "the other PDF");

  return (
    <div className="page wide">
      <PageHeader title="Compare" subtitle="What changed between two versions of a document, word by word.">
        {other && <button onClick={() => void pick()}>Compare with another…</button>}
      </PageHeader>
      <label className="check-row">
        <input type="checkbox" checked={olderIsOther} onChange={(e) => setOlderIsOther(e.target.checked)} disabled={!!other} />
        <span>The other PDF is the older version (changes are shown as edits made in {doc.name})</span>
      </label>
      {!other ? (
        <Empty Icon={CompareIcon} title={`Compare ${doc.name} with…`} text="Choose the other version. Pages are compared in order: page 1 with page 1, and so on.">
          <button className="primary" disabled={busy} onClick={() => void pick()}>
            {busy ? "Reading both files…" : "Choose a PDF…"}
          </button>
        </Empty>
      ) : (
        <>
          <div className="card compare-summary">
            <div>
              <span className="diff-removed">Removed</span> from <strong>{oldName}</strong>, <span className="diff-added">added</span> in <strong>{newName}</strong>.
            </div>
            <div className="muted small">
              {changed === 0 ? "The text is the same on every page." : `${changed} of ${other.diffs.length} page${other.diffs.length === 1 ? "" : "s"} changed.`} Layout, pictures and
              scanned pages without text are not compared.
            </div>
            <label className="check-row">
              <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />
              <span>Only pages with changes</span>
            </label>
          </div>
          {shown.map((d) => (
            <div className="card compare-page" key={d.page}>
              <div className="compare-head">
                <strong>Page {d.page}</strong>
                <span className="muted small">
                  {d.onlyIn ? `only in ${d.onlyIn === "new" ? newName : oldName}` : d.changes ? `${d.changes} change${d.changes === 1 ? "" : "s"}` : "no changes"}
                </span>
              </div>
              <p className="compare-text">
                {d.pieces.map((p, i) => (
                  <span key={i} className={p.kind === "added" ? "diff-added" : p.kind === "removed" ? "diff-removed" : undefined}>
                    {p.kind === "same" && p.text.length > 400 ? `${p.text.slice(0, 160)} … ${p.text.slice(-160)}` : p.text}{" "}
                  </span>
                ))}
              </p>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
