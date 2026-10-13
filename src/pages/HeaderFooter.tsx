// Header & footer: text in up to six places (top/bottom × left/centre/right),
// with page numbers, Bates numbers, the date and the file name filled in per
// page. Live preview; added to the open document (Undo takes it back).

import { useState } from "react";
import { PageHeader } from "../components/Common";
import { hexToRgb, LivePreview, PageScopePicker, scopePages, type PageScope } from "../components/PageTools";
import { applyEdit, useDoc } from "../lib/doc";
import { addOverlays, type FontName, type Overlay, type Spot } from "../lib/pdf/pagetools";
import { toastError } from "../lib/store";
import { back } from "../workspace/route";
import { useView } from "../workspace/viewer";

type Slot = "tl" | "tc" | "tr" | "bl" | "bc" | "br";
const SLOTS: { id: Slot; label: string }[] = [
  { id: "tl", label: "Top left" },
  { id: "tc", label: "Top centre" },
  { id: "tr", label: "Top right" },
  { id: "bl", label: "Bottom left" },
  { id: "bc", label: "Bottom centre" },
  { id: "br", label: "Bottom right" },
];
const TOKENS = [
  { t: "{page}", label: "Page number" },
  { t: "{pages}", label: "Page count" },
  { t: "{date}", label: "Date" },
  { t: "{file}", label: "File name" },
  { t: "{bates}", label: "Bates number" },
];
const PRESETS: { label: string; slots: Partial<Record<Slot, string>> }[] = [
  { label: "Page numbers", slots: { bc: "{page}" } },
  { label: "Page X of Y", slots: { bc: "Page {page} of {pages}" } },
  { label: "File and date", slots: { tl: "{file}", tr: "{date}" } },
  { label: "Bates", slots: { br: "{bates}" } },
];
const FONTS: FontName[] = ["Helvetica", "Helvetica-Bold", "Times", "Times-Bold", "Courier"];

export function HeaderFooter() {
  const doc = useDoc();
  const view = useView();
  const [texts, setTexts] = useState<Record<Slot, string>>({ tl: "", tc: "", tr: "", bl: "", bc: "Page {page} of {pages}", br: "" });
  const [focus, setFocus] = useState<Slot>("bc");
  const [font, setFont] = useState<FontName>("Helvetica");
  const [size, setSize] = useState(9);
  const [color, setColor] = useState("#333333");
  const [margin, setMargin] = useState(28);
  const [startAt, setStartAt] = useState(1);
  const [bates, setBates] = useState({ prefix: "DOC-", digits: 6, start: 1 });
  const [scope, setScope] = useState<PageScope>({ kind: "all" });
  const [busy, setBusy] = useState(false);
  if (!doc) return null;

  const pages = scopePages(scope, view.page, doc.pages);
  const usesBates = Object.values(texts).some((t) => t.includes("{bates}"));
  const overlays = (): Overlay[] =>
    SLOTS.filter((s) => texts[s.id].trim()).map((s) => ({
      kind: "text",
      text: texts[s.id],
      spot: s.id satisfies Spot,
      font,
      size,
      color: hexToRgb(color),
      opacity: 1,
      angle: 0,
      margin,
      behind: false,
    }));
  const make = async () => {
    if (typeof pages === "string") throw new Error(pages);
    const list = overlays();
    if (!list.length) return doc.bytes;
    return addOverlays(doc.bytes, list, { pages, startAt, bates: usesBates ? bates : undefined, fileName: doc.name }, { password: doc.password });
  };
  const previewPage = typeof pages === "string" || !pages.length ? view.page - 1 : pages.includes(view.page - 1) ? view.page - 1 : pages[0];
  const insert = (tok: string) => setTexts({ ...texts, [focus]: `${texts[focus]}${texts[focus] && !texts[focus].endsWith(" ") ? " " : ""}${tok}` });

  const apply = async () => {
    setBusy(true);
    try {
      if (await applyEdit(await make(), usesBates ? "Bates numbers" : "Header and footer")) back();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const settingsKey = JSON.stringify({ texts, font, size, color, margin, startAt, bates, scope, rev: doc.rev });

  return (
    <div className="page wide">
      <PageHeader title="Header & footer" subtitle="Page numbers, dates, file names or Bates numbers at the top or bottom of each page." />
      <div className="tool-split">
        <div className="tool-form">
          <div className="chip-row">
            {PRESETS.map((p) => (
              <button key={p.label} className="chip" onClick={() => setTexts({ tl: "", tc: "", tr: "", bl: "", bc: "", br: "", ...p.slots })}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="slot-grid">
            {SLOTS.map((s) => (
              <label key={s.id} className={focus === s.id ? "field slot on" : "field slot"}>
                <span>{s.label}</span>
                <input value={texts[s.id]} onFocus={() => setFocus(s.id)} onChange={(e) => setTexts({ ...texts, [s.id]: e.target.value })} />
              </label>
            ))}
          </div>
          <div className="chip-row">
            <span className="muted small">Insert into {SLOTS.find((s) => s.id === focus)?.label.toLowerCase()}:</span>
            {TOKENS.map((t) => (
              <button key={t.t} className="chip" onClick={() => insert(t.t)}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="form-row">
            <label className="field">
              <span>Font</span>
              <select value={font} onChange={(e) => setFont(FONTS.find((f) => f === e.target.value) ?? "Helvetica")}>
                {FONTS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Size</span>
              <input type="number" min={5} max={48} value={size} onChange={(e) => setSize(Math.max(5, Math.min(48, Number(e.target.value) || 9)))} />
            </label>
            <label className="field">
              <span>Colour</span>
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
            </label>
            <label className="field">
              <span>From edge (pt)</span>
              <input type="number" min={4} max={144} value={margin} onChange={(e) => setMargin(Math.max(4, Math.min(144, Number(e.target.value) || 28)))} />
            </label>
            <label className="field">
              <span>First number</span>
              <input type="number" min={0} value={startAt} onChange={(e) => setStartAt(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
            </label>
          </div>
          {usesBates && (
            <div className="form-row">
              <label className="field">
                <span>Bates prefix</span>
                <input value={bates.prefix} onChange={(e) => setBates({ ...bates, prefix: e.target.value })} />
              </label>
              <label className="field">
                <span>Digits</span>
                <input type="number" min={1} max={12} value={bates.digits} onChange={(e) => setBates({ ...bates, digits: Math.max(1, Math.min(12, Number(e.target.value) || 6)) })} />
              </label>
              <label className="field">
                <span>Start at</span>
                <input type="number" min={0} value={bates.start} onChange={(e) => setBates({ ...bates, start: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
              </label>
            </div>
          )}
          <div className="field">
            <span>Pages</span>
            <PageScopePicker value={scope} onChange={setScope} pages={doc.pages} />
            {typeof pages === "string" && <span className="error-text small">{pages}</span>}
          </div>
          <div className="action-bar">
            <span className="muted small">Added to the open document; Undo takes it back.</span>
            <div className="page-actions">
              <button onClick={back}>Cancel</button>
              <button className="primary" disabled={busy || typeof pages === "string" || !overlays().length} onClick={() => void apply()}>
                {busy ? "Adding…" : "Add to pages"}
              </button>
            </div>
          </div>
        </div>
        <LivePreview make={make} page={previewPage} password={doc.password} settingsKey={settingsKey} />
      </div>
    </div>
  );
}
