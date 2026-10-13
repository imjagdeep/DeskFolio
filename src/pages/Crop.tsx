// Crop: trim margins off pages (as seen on screen). Only the visible area
// changes; what's outside stays in the file, as in Acrobat.

import { useState } from "react";
import { PageHeader } from "../components/Common";
import { LivePreview, PageScopePicker, scopePages, type PageScope } from "../components/PageTools";
import { applyEdit, useDoc } from "../lib/doc";
import { cropPages, type Margins } from "../lib/pdf/pagetools";
import { toastError } from "../lib/store";
import { back } from "../workspace/route";
import { useView } from "../workspace/viewer";

const MM = 72 / 25.4;
const SIDES: { id: keyof Margins; label: string }[] = [
  { id: "top", label: "Top" },
  { id: "bottom", label: "Bottom" },
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
];

export function Crop() {
  const doc = useDoc();
  const view = useView();
  const [mm, setMm] = useState<Margins>({ top: 10, right: 10, bottom: 10, left: 10 });
  const [scope, setScope] = useState<PageScope>({ kind: "all" });
  const [busy, setBusy] = useState(false);
  if (!doc) return null;

  const pages = scopePages(scope, view.page, doc.pages);
  const pt = (): Margins => ({ top: mm.top * MM, right: mm.right * MM, bottom: mm.bottom * MM, left: mm.left * MM });
  const make = async () => {
    if (typeof pages === "string") throw new Error(pages);
    return cropPages(doc.bytes, pages, pt(), { password: doc.password });
  };
  const previewPage = typeof pages === "string" || !pages.length ? view.page - 1 : pages.includes(view.page - 1) ? view.page - 1 : pages[0];
  const apply = async () => {
    setBusy(true);
    try {
      if (await applyEdit(await make(), "Cropped pages")) back();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof Margins, v: number) => setMm({ ...mm, [k]: Math.max(0, Math.min(500, v)) });

  return (
    <div className="page wide">
      <PageHeader title="Crop pages" subtitle="Trim the edges: scanner borders, wide margins, printer marks. The hidden part stays in the file." />
      <div className="tool-split">
        <div className="tool-form">
          <div className="form-row">
            {SIDES.map((s) => (
              <label key={s.id} className="field">
                <span>{s.label} (mm)</span>
                <input type="number" min={0} max={500} step={1} value={mm[s.id]} onChange={(e) => set(s.id, Number(e.target.value) || 0)} />
              </label>
            ))}
          </div>
          <div className="chip-row">
            {[0, 5, 10, 20].map((v) => (
              <button key={v} className="chip" onClick={() => setMm({ top: v, right: v, bottom: v, left: v })}>
                {v === 0 ? "None" : `${v} mm all round`}
              </button>
            ))}
          </div>
          <div className="field">
            <span>Pages</span>
            <PageScopePicker value={scope} onChange={setScope} pages={doc.pages} />
            {typeof pages === "string" && <span className="error-text small">{pages}</span>}
          </div>
          <div className="action-bar">
            <span className="muted small">Undo takes it back.</span>
            <div className="page-actions">
              <button onClick={back}>Cancel</button>
              <button className="primary" disabled={busy || typeof pages === "string"} onClick={() => void apply()}>
                {busy ? "Cropping…" : "Crop"}
              </button>
            </div>
          </div>
        </div>
        <LivePreview make={make} page={previewPage} password={doc.password} settingsKey={JSON.stringify({ mm, scope, rev: doc.rev })} />
      </div>
    </div>
  );
}
