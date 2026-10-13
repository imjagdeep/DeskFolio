// Watermark: text (DRAFT, CONFIDENTIAL…) or a picture across pages, over or
// behind the content, with a live preview.

import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { PageHeader } from "../components/Common";
import { hexToRgb, LivePreview, PageScopePicker, scopePages, SpotPicker, type PageScope } from "../components/PageTools";
import { api } from "../lib/api";
import { applyEdit, useDoc } from "../lib/doc";
import { fileName } from "../lib/format";
import { addOverlays, type FontName, type Overlay, type Spot } from "../lib/pdf/pagetools";
import { toastError } from "../lib/store";
import { back } from "../workspace/route";
import { useView } from "../workspace/viewer";

const FONTS: FontName[] = ["Helvetica-Bold", "Helvetica", "Times-Bold", "Times", "Courier"];
const QUICK = ["DRAFT", "CONFIDENTIAL", "COPY", "SAMPLE", "DO NOT COPY", "PAID"];

export function Watermark() {
  const doc = useDoc();
  const view = useView();
  const [kind, setKind] = useState<"text" | "image">("text");
  const [text, setText] = useState("CONFIDENTIAL");
  const [font, setFont] = useState<FontName>("Helvetica-Bold");
  const [size, setSize] = useState(64);
  const [color, setColor] = useState("#c62828");
  const [opacity, setOpacity] = useState(0.18);
  const [angle, setAngle] = useState(45);
  const [spot, setSpot] = useState<Spot>("mc");
  const [behind, setBehind] = useState(true);
  const [image, setImage] = useState<{ bytes: Uint8Array; type: "image/png" | "image/jpeg"; name: string } | null>(null);
  const [scale, setScale] = useState(0.5);
  const [scope, setScope] = useState<PageScope>({ kind: "all" });
  const [busy, setBusy] = useState(false);
  if (!doc) return null;

  const pages = scopePages(scope, view.page, doc.pages);
  const overlay = (): Overlay | null =>
    kind === "text"
      ? { kind: "text", text, spot, font, size, color: hexToRgb(color), opacity, angle, margin: 36, behind }
      : image
        ? { kind: "image", bytes: image.bytes, type: image.type, spot, scale, opacity, angle, margin: 36, behind }
        : null;
  const make = async () => {
    const o = overlay();
    if (typeof pages === "string") throw new Error(pages);
    return o ? addOverlays(doc.bytes, [o], { pages }, { password: doc.password }) : doc.bytes;
  };
  const previewPage = typeof pages === "string" || !pages.length ? view.page - 1 : pages.includes(view.page - 1) ? view.page - 1 : pages[0];

  const pickImage = async () => {
    try {
      const path = await open({ title: "Watermark picture", filters: [{ name: "Picture", extensions: ["png", "jpg", "jpeg"] }] });
      if (typeof path !== "string") return;
      const bytes = await api.readFile(path);
      setImage({ bytes, type: /\.png$/i.test(path) ? "image/png" : "image/jpeg", name: fileName(path) });
    } catch (e) {
      toastError(e);
    }
  };

  const apply = async () => {
    setBusy(true);
    try {
      if (await applyEdit(await make(), kind === "text" ? `Watermark "${text}"` : "Picture watermark")) back();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const settingsKey = JSON.stringify({ kind, text, font, size, color, opacity, angle, spot, behind, scale, scope, img: image?.name, rev: doc.rev });
  const canApply = typeof pages !== "string" && (kind === "text" ? !!text.trim() : !!image);

  return (
    <div className="page wide">
      <PageHeader title="Watermark" subtitle="Text or a picture across your pages, faint and behind the content or bold on top." />
      <div className="tool-split">
        <div className="tool-form">
          <div className="segmented" role="radiogroup" aria-label="Watermark type">
            <button role="radio" aria-checked={kind === "text"} className={kind === "text" ? "active" : ""} onClick={() => setKind("text")}>
              Text
            </button>
            <button role="radio" aria-checked={kind === "image"} className={kind === "image" ? "active" : ""} onClick={() => setKind("image")}>
              Picture
            </button>
          </div>

          {kind === "text" ? (
            <>
              <label className="field">
                <span>Text</span>
                <input value={text} onChange={(e) => setText(e.target.value)} />
              </label>
              <div className="chip-row">
                {QUICK.map((q) => (
                  <button key={q} className={text === q ? "chip on" : "chip"} onClick={() => setText(q)}>
                    {q}
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
                  <input type="number" min={6} max={300} value={size} onChange={(e) => setSize(Math.max(6, Math.min(300, Number(e.target.value) || 6)))} />
                </label>
                <label className="field">
                  <span>Colour</span>
                  <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
                </label>
              </div>
            </>
          ) : (
            <div className="field">
              <span>Picture</span>
              <div className="form-row">
                <button onClick={() => void pickImage()}>{image ? "Change picture…" : "Choose a picture…"}</button>
                {image && <span className="muted small ellipsis">{image.name}</span>}
              </div>
              <label className="field">
                <span>Width: {Math.round(scale * 100)}% of the page</span>
                <input type="range" min={0.05} max={1} step={0.05} value={scale} onChange={(e) => setScale(Number(e.target.value))} />
              </label>
            </div>
          )}

          <label className="field">
            <span>Opacity: {Math.round(opacity * 100)}%</span>
            <input type="range" min={0.05} max={1} step={0.01} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
          </label>
          <div className="form-row align-start">
            <div className="field">
              <span>Position</span>
              <SpotPicker value={spot} onChange={setSpot} />
            </div>
            <div className="field">
              <span>Angle</span>
              <div className="segmented small-seg">
                {[0, 45, 90, -45].map((a) => (
                  <button key={a} className={angle === a ? "active" : ""} onClick={() => setAngle(a)}>
                    {a}°
                  </button>
                ))}
              </div>
              <label className="check-row">
                <input type="checkbox" checked={behind} onChange={(e) => setBehind(e.target.checked)} />
                <span>Behind the page content</span>
              </label>
            </div>
          </div>
          <div className="field">
            <span>Pages</span>
            <PageScopePicker value={scope} onChange={setScope} pages={doc.pages} />
            {typeof pages === "string" && <span className="error-text small">{pages}</span>}
          </div>
          <div className="action-bar">
            <span className="muted small">Added to the open document; Undo takes it back.</span>
            <div className="page-actions">
              <button onClick={back}>Cancel</button>
              <button className="primary" disabled={busy || !canApply} onClick={() => void apply()}>
                {busy ? "Adding…" : "Add watermark"}
              </button>
            </div>
          </div>
        </div>
        <LivePreview make={make} page={previewPage} password={doc.password} settingsKey={settingsKey} />
      </div>
    </div>
  );
}
