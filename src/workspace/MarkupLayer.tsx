// Mouse handling on the pages for DeskFolio's own markup tools: drag for
// rectangles, ellipses, lines and arrows; click for sticky notes and stamps;
// select text for underline and strike-through. Finished marks go into the
// document through markup.ts.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Mark, RGB } from "../lib/pdf/markup";
import { mergeLines, STAMPS } from "../lib/pdf/markup";
import { currentDoc } from "../lib/doc";
import { addToDocument, markupState, RGB_HEX, useMarkup } from "./markup";
import { addRedactions } from "./redact";
import { pageOf, toPdfPoint } from "./viewer";

const NOTE_YELLOW: RGB = [1, 0.85, 0.3];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "12 Oct 2026": plain ASCII, so the stamp's standard font can draw it in any locale. */
const stampDate = (d = new Date()) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

interface Drag {
  page: number;
  el: HTMLElement;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface NoteDraft {
  page: number;
  el: HTMLElement;
  x: number;
  y: number;
}

const local = (el: HTMLElement, e: { clientX: number; clientY: number }): [number, number] => {
  const r = el.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
};

export function MarkupLayer({ container }: { container: React.RefObject<HTMLDivElement | null> }) {
  const m = useMarkup();
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [note, setNote] = useState<NoteDraft | null>(null);
  const [text, setText] = useState("");

  useEffect(() => {
    const c = container.current;
    // The editing tools (text, images, links) are handled by EditLayer.
    if (!c || !m.tool || m.tool === "edittext" || m.tool === "editimage" || m.tool === "link") return;
    const tool = m.tool;

    const down = (e: PointerEvent) => {
      if (e.button !== 0 || tool === "underline" || tool === "strikeout") return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(".note-draft")) return;
      const pg = pageOf(target);
      if (!pg) return;
      e.preventDefault();
      e.stopPropagation();
      const [x, y] = local(pg.el, e);
      if (tool === "note") {
        setText("");
        setNote({ page: pg.index, el: pg.el, x, y });
        return;
      }
      if (tool === "stamp") {
        const at = toPdfPoint(pg.index, x, y);
        const s = STAMPS[markupState().stamp] ?? STAMPS[0];
        if (at) void addToDocument([{ kind: "stamp", page: pg.index, at, label: s.label, sub: markupState().stampDate ? stampDate() : undefined, color: s.color }]);
        return;
      }
      const d = { page: pg.index, el: pg.el, x0: x, y0: y, x1: x, y1: y };
      dragRef.current = d;
      setDrag(d);
      c.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const [x, y] = local(d.el, e);
      const r = d.el.getBoundingClientRect();
      const next = { ...d, x1: Math.max(0, Math.min(r.width, x)), y1: Math.max(0, Math.min(r.height, y)) };
      dragRef.current = next;
      setDrag(next);
    };
    const up = () => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d || Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 4) return;
      const a = toPdfPoint(d.page, d.x0, d.y0);
      const b = toPdfPoint(d.page, d.x1, d.y1);
      if (!a || !b) return;
      const st = markupState();
      let mark: Mark;
      if (tool === "redact") {
        const d0 = currentDoc();
        if (d0) addRedactions(d0.id, [{ page: d.page, rect: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])], label: "Area" }]);
        return;
      }
      if (tool === "square" || tool === "circle") mark = { kind: tool, page: d.page, rect: [a[0], a[1], b[0], b[1]], color: st.color, width: st.width };
      else if (tool === "line" || tool === "arrow") mark = { kind: tool, page: d.page, from: a, to: b, color: st.color, width: st.width };
      else return;
      void addToDocument([mark]);
    };
    // Underline / strike-through: whatever text was just selected.
    const selected = () => {
      if (tool !== "underline" && tool !== "strikeout") return;
      window.setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) return;
        const quads = new Map<number, number[][]>();
        for (let i = 0; i < sel.rangeCount; i++) {
          for (const r of Array.from(sel.getRangeAt(i).getClientRects())) {
            if (r.width < 1 || r.height < 1) continue;
            const pg = pageOf(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
            if (!pg) continue;
            const box = pg.el.getBoundingClientRect();
            const ul = toPdfPoint(pg.index, r.left - box.left, r.top - box.top);
            const ur = toPdfPoint(pg.index, r.right - box.left, r.top - box.top);
            const ll = toPdfPoint(pg.index, r.left - box.left, r.bottom - box.top);
            const lr = toPdfPoint(pg.index, r.right - box.left, r.bottom - box.top);
            if (!ul || !ur || !ll || !lr) continue;
            const list = quads.get(pg.index) ?? [];
            list.push([...ul, ...ur, ...ll, ...lr]);
            quads.set(pg.index, list);
          }
        }
        sel.removeAllRanges();
        const marks: Mark[] = [...quads.entries()].map(([page, q]) => ({ kind: tool, page, quads: mergeLines(q), color: markupState().color }));
        void addToDocument(marks);
      }, 0);
    };

    c.addEventListener("pointerdown", down, true);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    c.addEventListener("mouseup", selected);
    return () => {
      c.removeEventListener("pointerdown", down, true);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("pointercancel", up);
      c.removeEventListener("mouseup", selected);
    };
  }, [m.tool, container]);

  // Switching tools drops an unfinished note.
  useEffect(() => setNote(null), [m.tool]);

  const saveNote = () => {
    if (!note) return;
    const at = toPdfPoint(note.page, note.x, note.y);
    const body = text.trim();
    setNote(null);
    if (at && body) void addToDocument([{ kind: "note", page: note.page, at, note: body, color: NOTE_YELLOW }]);
  };

  return (
    <>
      {drag && createPortal(dragPreview(drag), drag.el)}
      {note &&
        createPortal(
          <div className="note-draft" style={{ left: note.x, top: note.y }} onPointerDown={(e) => e.stopPropagation()}>
            <textarea
              autoFocus
              value={text}
              placeholder="Write a note…"
              aria-label="Note"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setNote(null);
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) saveNote();
              }}
            />
            <div className="note-draft-actions">
              <span className="muted small">Ctrl+Enter to add</span>
              <button onClick={() => setNote(null)}>Cancel</button>
              <button className="primary" disabled={!text.trim()} onClick={saveNote}>
                Add note
              </button>
            </div>
          </div>,
          note.el,
        )}
    </>
  );

  function dragPreview(d: Drag) {
    const x = Math.min(d.x0, d.x1);
    const y = Math.min(d.y0, d.y1);
    const w = Math.abs(d.x1 - d.x0);
    const h = Math.abs(d.y1 - d.y0);
    const stroke = RGB_HEX(m.color);
    const sw = Math.max(1, m.width * 1.33);
    return (
      <svg className="markup-preview" width="100%" height="100%">
        {m.tool === "square" && <rect x={x} y={y} width={w} height={h} fill="none" stroke={stroke} strokeWidth={sw} />}
        {m.tool === "redact" && <rect x={x} y={y} width={w} height={h} className="redact-draft" />}
        {m.tool === "circle" && <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill="none" stroke={stroke} strokeWidth={sw} />}
        {(m.tool === "line" || m.tool === "arrow") && <line x1={d.x0} y1={d.y0} x2={d.x1} y2={d.y1} stroke={stroke} strokeWidth={sw} strokeLinecap="round" />}
      </svg>
    );
  }
}
