// The Comments panel: every comment and mark in the document (DeskFolio's,
// Acrobat's, anyone's), by page, with author, text and date; click to go
// there. Filter by text or type.

import { useEffect, useMemo, useState } from "react";
import type { OpenDoc } from "../lib/doc";
import { toComment, type CommentItem } from "../lib/pdf/comments";
import { goToPage, useView } from "./viewer";

export function Comments({ doc }: { doc: OpenDoc }) {
  const view = useView();
  const [items, setItems] = useState<CommentItem[] | null>(null);
  const [filter, setFilter] = useState("");

  // Re-read when the document changes (new marks are written into it).
  useEffect(() => {
    let live = true;
    setItems(null);
    void (async () => {
      const out: CommentItem[] = [];
      for (let i = 1; i <= doc.pages; i++) {
        try {
          const list = await (await doc.pdf.getPage(i)).getAnnotations({ intent: "display" });
          for (const a of list) {
            const c = toComment(a, i);
            if (c) out.push(c);
          }
        } catch {
          // A page whose annotations can't be read is skipped.
        }
        if (!live) return;
      }
      setItems(out);
    })();
    return () => {
      live = false;
    };
  }, [doc.pdf, doc.pages]);

  const shown = useMemo(() => {
    if (!items) return [];
    const q = filter.trim().toLowerCase();
    return q ? items.filter((c) => `${c.kind} ${c.author} ${c.text}`.toLowerCase().includes(q)) : items;
  }, [items, filter]);

  if (items === null) return <p className="side-note">Reading comments…</p>;
  return (
    <div className="comments-panel">
      {items.length > 0 && (
        <input className="comments-filter" value={filter} placeholder={`Filter ${items.length} comment${items.length === 1 ? "" : "s"}`} aria-label="Filter comments" onChange={(e) => setFilter(e.target.value)} />
      )}
      {!items.length && <p className="side-note">No comments yet. Use the Comment tab to highlight, add notes, shapes and stamps.</p>}
      {view.pendingMarks && <p className="side-note">New marks show here once they are added to the document (Done).</p>}
      <div className="comments-list">
        {shown.map((c, i) => (
          <button key={i} className="comment-item" onClick={() => goToPage(c.page)}>
            <span className="comment-head">
              <span className="comment-dot" style={c.color ? { background: c.color } : undefined} />
              <strong>{c.kind}</strong>
              <span className="muted small">p. {c.page}</span>
            </span>
            {c.text && <span className="comment-text">{c.text}</span>}
            {(c.author || c.date) && (
              <span className="muted small">
                {c.author}
                {c.author && c.date ? " · " : ""}
                {c.date ? c.date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : ""}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
