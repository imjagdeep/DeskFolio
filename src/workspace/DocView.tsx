// The active document, drawn by pdf.js's viewer.

import { useEffect, useRef } from "react";
import type { OpenDoc } from "../lib/doc";
import { mountViewer, useView } from "./viewer";

export function DocView({ doc }: { doc: OpenDoc }) {
  const container = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const view = useView();

  // A new viewer for each tab and each edited version of the file; the tab's
  // page and zoom carry over.
  useEffect(() => {
    if (!container.current || !inner.current) return;
    return mountViewer(container.current, inner.current, doc.id, doc.pdf);
  }, [doc.id, doc.pdf]);

  return (
    <div className={view.dark ? "docview reading-dark" : "docview"}>
      <div ref={container} className="docview-scroll" tabIndex={0} aria-label={`${doc.name}, page ${view.page} of ${view.pages}`}>
        <div ref={inner} className="pdfViewer" />
      </div>
    </div>
  );
}
