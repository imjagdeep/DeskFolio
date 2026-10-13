// Page and zoom controls, stacked at the foot of the right-hand rail (where
// the status bar used to be): page x of y, previous/next, zoom, fit, reading mode.

import { useEffect, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, FitPageIcon, FitWidthIcon, MoonIcon, ZoomInIcon, ZoomOutIcon } from "../components/Icons";
import { goToPage, nextPage, setDark, setScale, useView, zoom, type ScaleValue } from "./viewer";

const NAMED = ["auto", "page-actual", "page-fit", "page-width"] as const;
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

function toScale(v: string): ScaleValue {
  const n = Number(v);
  if (!isNaN(n)) return n;
  return NAMED.find((x) => x === v) ?? "auto";
}

export function PageControls() {
  const view = useView();
  const [typed, setTyped] = useState(String(view.page));
  useEffect(() => setTyped(String(view.page)), [view.page]);
  const pct = `${Math.round(view.scale * 100)}%`;

  return (
    <div className="page-controls" aria-label="Page and zoom">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(typed);
          if (Number.isInteger(n) && n >= 1 && n <= view.pages) goToPage(n);
          else setTyped(String(view.page));
        }}
      >
        <input className="page-input" aria-label="Page number" title="Go to page" value={typed} onChange={(e) => setTyped(e.target.value.replace(/\D/g, ""))} onBlur={() => setTyped(String(view.page))} />
      </form>
      <span className="page-total" title={`${view.pages} pages`}>
        / {view.pages}
      </span>
      <button className="icon" title="Previous page (Page Up)" aria-label="Previous page" disabled={view.page <= 1} onClick={() => nextPage(-1)}>
        <ChevronUpIcon size={15} />
      </button>
      <button className="icon" title="Next page (Page Down)" aria-label="Next page" disabled={view.page >= view.pages} onClick={() => nextPage(1)}>
        <ChevronDownIcon size={15} />
      </button>
      <span className="rail-sep" />
      <button className="icon" title="Zoom in (Ctrl+=)" aria-label="Zoom in" onClick={() => zoom(1)}>
        <ZoomInIcon size={16} />
      </button>
      <label className="zoom-pill" title="Zoom">
        <span>{pct}</span>
        <select aria-label="Zoom" value={view.preset ?? "custom"} onChange={(e) => setScale(toScale(e.target.value))}>
          {view.preset === null && <option value="custom">{pct}</option>}
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <button className="icon" title="Zoom out (Ctrl+-)" aria-label="Zoom out" onClick={() => zoom(-1)}>
        <ZoomOutIcon size={16} />
      </button>
      <button className={view.preset === "page-width" ? "icon on" : "icon"} title="Fit width" aria-label="Fit width" onClick={() => setScale("page-width")}>
        <FitWidthIcon size={16} />
      </button>
      <button className={view.preset === "page-fit" ? "icon on" : "icon"} title="Fit page" aria-label="Fit page" onClick={() => setScale("page-fit")}>
        <FitPageIcon size={16} />
      </button>
      <button className={view.dark ? "icon on" : "icon"} title="Reading mode (dark pages)" aria-pressed={view.dark} onClick={() => setDark(!view.dark)}>
        <MoonIcon size={15} />
      </button>
    </div>
  );
}
