// Areas marked for redaction, drawn on the pages (red outline, dark fill)
// until they are applied. Each can be removed with its ×.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useDoc } from "../lib/doc";
import { removeRedaction, useRedactions } from "./redact";
import { toCssRect, useView } from "./viewer";

export function RedactLayer() {
  const doc = useDoc();
  const boxes = useRedactions(doc?.id ?? null);
  const view = useView();
  // Page elements come and go as pdf.js lays pages out; look them up on every change.
  const [pages, setPages] = useState<Map<number, HTMLElement>>(new Map());
  useEffect(() => {
    if (!boxes.length) return setPages(new Map());
    const t = window.setTimeout(() => {
      const m = new Map<number, HTMLElement>();
      document.querySelectorAll<HTMLElement>(".pdfViewer .page[data-page-number]").forEach((el) => m.set(Number(el.dataset.pageNumber) - 1, el));
      setPages(m);
    }, 50);
    return () => window.clearTimeout(t);
  }, [boxes, view.scale, view.rotation, view.page, view.ready, view.spread, view.scroll]);

  if (!doc || !boxes.length) return null;
  return (
    <>
      {boxes.map((b) => {
        const el = pages.get(b.page);
        const r = el ? toCssRect(b.page, b.rect) : null;
        if (!el || !r) return null;
        return createPortal(
          <div className="redact-box" style={{ left: r[0], top: r[1], width: r[2], height: r[3] }} title={`Will be removed: ${b.label}`}>
            <button className="redact-x" aria-label="Don't redact this" title="Don't redact this" onClick={() => removeRedaction(doc.id, b.id)}>
              ×
            </button>
          </div>,
          el,
          String(b.id),
        );
      })}
    </>
  );
}
