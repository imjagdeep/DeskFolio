// The active document, drawn by pdf.js's viewer, with DeskFolio's own
// markup tools on top.

import { useEffect, useRef } from "react";
import type { OpenDoc } from "../lib/doc";
import { useMarkup } from "./markup";
import { MarkupLayer } from "./MarkupLayer";
import { RedactLayer } from "./RedactLayer";
import { EditLayer } from "./EditLayer";
import { mountViewer, useView } from "./viewer";

export function DocView({ doc }: { doc: OpenDoc }) {
  const container = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const view = useView();
  const { tool } = useMarkup();

  // A new viewer for each tab and each edited version of the file; the tab's
  // page, zoom and tool carry over.
  useEffect(() => {
    if (!container.current || !inner.current) return;
    return mountViewer(container.current, inner.current, doc.id, doc.pdf);
  }, [doc.id, doc.pdf]);

  const cls = ["docview"];
  if (view.dark) cls.push("reading-dark");
  if (tool === "edittext") cls.push("edit-text");
  else if (tool === "editimage") cls.push("edit-image");
  else if (tool) cls.push(tool === "underline" || tool === "strikeout" ? "markup-select" : "markup-place");
  return (
    <div className={cls.join(" ")}>
      <div ref={container} className="docview-scroll" tabIndex={0} aria-label={`${doc.name}, page ${view.page} of ${view.pages}`}>
        <div ref={inner} className="pdfViewer" />
      </div>
      <MarkupLayer container={container} />
      <RedactLayer />
      <EditLayer container={container} />
    </div>
  );
}
