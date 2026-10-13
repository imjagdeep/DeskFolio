// The bar under the document: page x of y, zoom, fit buttons, reading mode.

import { useEffect, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, FitPageIcon, LockIcon, FitWidthIcon, MoonIcon, ZoomInIcon, ZoomOutIcon } from "../components/Icons";
import type { OpenDoc } from "../lib/doc";
import { goToPage, nextPage, setDark, setScale, useView, zoom } from "./viewer";

const PRESETS: { value: string; label: string }[] = [
  { value: "auto", label: "Automatic" },
  { value: "page-actual", label: "Actual size" },
  { value: "page-fit", label: "Fit page" },
  { value: "page-width", label: "Fit width" },
  { value: "0.5", label: "50%" },
  { value: "0.75", label: "75%" },
  { value: "1", label: "100%" },
  { value: "1.25", label: "125%" },
  { value: "1.5", label: "150%" },
  { value: "2", label: "200%" },
  { value: "3", label: "300%" },
  { value: "4", label: "400%" },
];

export function StatusBar({ doc }: { doc: OpenDoc }) {
  const view = useView();
  const [typed, setTyped] = useState(String(view.page));
  useEffect(() => setTyped(String(view.page)), [view.page]);
  const pct = `${Math.round(view.scale * 100)}%`;

  return (
    <footer className="statusbar">
      <div className="status-left ellipsis" title={doc.path}>
        {doc.dirty ? <span className="status-dot" title="Unsaved changes" /> : null}
        {doc.dirty ? `Edited · ${doc.edits.length} change${doc.edits.length === 1 ? "" : "s"}` : "No changes"}
        {doc.protection && (
          <span className="status-lock" title={doc.protection.openPassword ? "Opens with a password (kept when you save)" : "Has permission limits (kept when you save)"}>
            <LockIcon size={12} /> {doc.protection.openPassword ? "Password" : "Limited"}
          </span>
        )}
      </div>
      <div className="status-mid">
        <button className="icon" title="Previous page" aria-label="Previous page" disabled={view.page <= 1} onClick={() => nextPage(-1)}>
          <ChevronLeftIcon size={14} />
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(typed);
            if (Number.isInteger(n) && n >= 1 && n <= view.pages) goToPage(n);
            else setTyped(String(view.page));
          }}
        >
          <input className="page-input" aria-label="Page number" value={typed} onChange={(e) => setTyped(e.target.value.replace(/\D/g, ""))} onBlur={() => setTyped(String(view.page))} />
        </form>
        <span className="muted small">of {view.pages}</span>
        <button className="icon" title="Next page" aria-label="Next page" disabled={view.page >= view.pages} onClick={() => nextPage(1)}>
          <ChevronRightIcon size={14} />
        </button>
      </div>
      <div className="status-right">
        <button className={view.dark ? "icon on" : "icon"} title="Reading mode" aria-pressed={view.dark} onClick={() => setDark(!view.dark)}>
          <MoonIcon size={14} />
        </button>
        <span className="status-sep" />
        <button className={view.preset === "page-width" ? "icon on" : "icon"} title="Fit width" aria-label="Fit width" onClick={() => setScale("page-width")}>
          <FitWidthIcon size={15} />
        </button>
        <button className={view.preset === "page-fit" ? "icon on" : "icon"} title="Fit page" aria-label="Fit page" onClick={() => setScale("page-fit")}>
          <FitPageIcon size={15} />
        </button>
        <button className="icon" title="Zoom out (Ctrl+-)" aria-label="Zoom out" onClick={() => zoom(-1)}>
          <ZoomOutIcon size={15} />
        </button>
        <select className="zoom-select" aria-label="Zoom" value={view.preset ?? "custom"} onChange={(e) => setScale(isNaN(Number(e.target.value)) ? (e.target.value as "auto") : Number(e.target.value))}>
          {view.preset === null && <option value="custom">{pct}</option>}
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.value.startsWith("page") || p.value === "auto" ? (view.preset === p.value ? `${p.label} (${pct})` : p.label) : p.label}
            </option>
          ))}
        </select>
        <button className="icon" title="Zoom in (Ctrl+=)" aria-label="Zoom in" onClick={() => zoom(1)}>
          <ZoomInIcon size={15} />
        </button>
      </div>
    </footer>
  );
}
