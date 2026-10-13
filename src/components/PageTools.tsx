// Pieces shared by the page tools (watermark, header & footer, crop):
// choosing which pages, and a live preview of the result before applying.

import { useEffect, useRef, useState } from "react";
import { closePdf, loadPdf, renderPage } from "../lib/pdfjs";
import { parseRanges } from "../lib/pdf/ops";

export type PageScope = { kind: "all" } | { kind: "current" } | { kind: "range"; text: string };

/** The chosen pages as 0-based indexes (empty = all), or an error message. */
export function scopePages(scope: PageScope, current: number, count: number): number[] | string {
  if (scope.kind === "all") return [];
  if (scope.kind === "current") return [Math.max(0, Math.min(count - 1, current - 1))];
  try {
    return [...new Set(parseRanges(scope.text, count).flat())].sort((a, b) => a - b);
  } catch (e) {
    return e instanceof Error ? e.message : "Type pages like 1-3, 5, 8-.";
  }
}

export function PageScopePicker({ value, onChange, pages }: { value: PageScope; onChange: (s: PageScope) => void; pages: number }) {
  return (
    <div className="scope-picker">
      <div className="segmented" role="radiogroup" aria-label="Pages">
        <button role="radio" aria-checked={value.kind === "all"} className={value.kind === "all" ? "active" : ""} onClick={() => onChange({ kind: "all" })}>
          All {pages} pages
        </button>
        <button role="radio" aria-checked={value.kind === "current"} className={value.kind === "current" ? "active" : ""} onClick={() => onChange({ kind: "current" })}>
          Current page
        </button>
        <button role="radio" aria-checked={value.kind === "range"} className={value.kind === "range" ? "active" : ""} onClick={() => onChange({ kind: "range", text: value.kind === "range" ? value.text : "" })}>
          Pages…
        </button>
      </div>
      {value.kind === "range" && <input className="range-input" value={value.text} placeholder="e.g. 1-3, 5, 8-" aria-label="Page ranges" autoFocus onChange={(e) => onChange({ kind: "range", text: e.target.value })} />}
    </div>
  );
}

/**
 * Renders page `page` (0-based) of `make()`'s result, re-made when `settingsKey`
 * (the caller's settings, as a string) changes, debounced, so a tool shows
 * exactly what applying would give.
 */
export function LivePreview({ make, page, password, settingsKey, overlay }: { make: () => Promise<Uint8Array>; page: number; password?: string; settingsKey: string; overlay?: (w: number, h: number) => React.ReactNode }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const makeRef = useRef(make);
  makeRef.current = make;

  useEffect(() => {
    let live = true;
    setBusy(true);
    const t = window.setTimeout(async () => {
      try {
        const bytes = await makeRef.current();
        const pdf = await loadPdf(bytes, password);
        try {
          if (!live || !canvas.current) return;
          const p = await pdf.getPage(Math.min(page + 1, pdf.numPages));
          const vp = p.getViewport({ scale: 1 });
          const scale = Math.min(460 / vp.width, 560 / vp.height);
          await renderPage(pdf, Math.min(page + 1, pdf.numPages), canvas.current, scale);
          if (live) {
            setSize({ w: vp.width * scale, h: vp.height * scale });
            setError("");
          }
        } finally {
          closePdf(pdf);
        }
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (live) setBusy(false);
      }
    }, 350);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [page, password, settingsKey]);

  return (
    <div className="live-preview">
      <div className={busy ? "preview-paper busy" : "preview-paper"} style={size ? { width: size.w, height: size.h } : undefined}>
        <canvas ref={canvas} />
        {size && overlay?.(size.w, size.h)}
      </div>
      <div className="muted small preview-cap">{error ? <span className="error-text">{error}</span> : `Preview of page ${page + 1}`}</div>
    </div>
  );
}

const SPOTS = ["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"] as const;
const SPOT_NAMES: Record<(typeof SPOTS)[number], string> = {
  tl: "Top left",
  tc: "Top centre",
  tr: "Top right",
  ml: "Middle left",
  mc: "Centre",
  mr: "Middle right",
  bl: "Bottom left",
  bc: "Bottom centre",
  br: "Bottom right",
};

/** Nine-square position picker. */
export function SpotPicker({ value, onChange }: { value: (typeof SPOTS)[number]; onChange: (s: (typeof SPOTS)[number]) => void }) {
  return (
    <div className="spot-picker" role="radiogroup" aria-label="Position">
      {SPOTS.map((s) => (
        <button key={s} role="radio" aria-checked={value === s} aria-label={SPOT_NAMES[s]} title={SPOT_NAMES[s]} className={value === s ? "spot on" : "spot"} onClick={() => onChange(s)}>
          <span />
        </button>
      ))}
    </div>
  );
}

/** "#rrggbb" ↔ [r, g, b] in 0–1. */
export function hexToRgb(h: string): [number, number, number] {
  const c = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [c(1), c(3), c(5)];
}
