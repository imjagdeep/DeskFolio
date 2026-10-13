// The panel left of the document: page thumbnails, bookmarks (the PDF's
// outline) and search, switched by the icon rail on its left edge.

import { useEffect, useRef, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, BookmarkIcon, CloseIcon, CommentsIcon, PagesIcon, RedactIcon, SearchIcon, SignIcon, type IconType } from "../components/Icons";
import { Bookmarks } from "./Bookmarks";
import { Comments } from "./Comments";
import { RedactPanel } from "./RedactPanel";
import { SignaturesPanel } from "./SignaturesPanel";
import type { OpenDoc } from "../lib/doc";
import { renderPage } from "../lib/pdfjs";
import { setPanel, usePanel, type PanelId } from "./panels";
import { closeFind, find, goToPage, useView } from "./viewer";

const RAIL: { id: PanelId; label: string; Icon: IconType }[] = [
  { id: "pages", label: "Pages", Icon: PagesIcon },
  { id: "outline", label: "Bookmarks", Icon: BookmarkIcon },
  { id: "comments", label: "Comments", Icon: CommentsIcon },
  { id: "search", label: "Search", Icon: SearchIcon },
  { id: "redact", label: "Redact", Icon: RedactIcon },
  { id: "signatures", label: "Signatures", Icon: SignIcon },
];

export function SidePanel({ doc }: { doc: OpenDoc }) {
  const panel = usePanel();
  return (
    <div className={panel ? "side open" : "side"}>
      <nav className="side-rail" aria-label="Side panel">
        {RAIL.map((r) => (
          <button
            key={r.id}
            className={panel === r.id ? "rail-btn active" : "rail-btn"}
            title={r.label}
            aria-label={r.label}
            aria-pressed={panel === r.id}
            onClick={() => setPanel(panel === r.id ? null : r.id)}
          >
            <r.Icon size={18} />
          </button>
        ))}
      </nav>
      {panel && (
        <section className="side-body" aria-label={RAIL.find((r) => r.id === panel)?.label}>
          <header className="side-head">
            <strong>{RAIL.find((r) => r.id === panel)?.label}</strong>
            <button className="icon" title="Close panel (F4)" aria-label="Close panel" onClick={() => setPanel(null)}>
              <CloseIcon size={14} />
            </button>
          </header>
          {panel === "pages" && <Thumbs doc={doc} />}
          {panel === "outline" && <Bookmarks doc={doc} />}
          {panel === "comments" && <Comments doc={doc} />}
          {panel === "search" && <Search doc={doc} />}
          {panel === "redact" && <RedactPanel doc={doc} />}
          {panel === "signatures" && <SignaturesPanel doc={doc} />}
        </section>
      )}
    </div>
  );
}

// ---------- thumbnails ----------

function Thumbs({ doc }: { doc: OpenDoc }) {
  const view = useView();
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([]);
  useEffect(() => {
    let live = true;
    void (async () => {
      const out: { w: number; h: number }[] = [];
      for (let i = 1; i <= doc.pages; i++) {
        try {
          const v = (await doc.pdf.getPage(i)).getViewport({ scale: 1 });
          out.push({ w: v.width, h: v.height });
        } catch {
          // A broken page still gets a slot, at Letter size.
          out.push({ w: 612, h: 792 });
        }
        if (i % 24 === 0 || i === doc.pages) {
          if (!live) return;
          setSizes([...out]);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [doc.pdf, doc.pages]);
  return (
    <div className="thumbs-list">
      {sizes.map((s, i) => (
        <Thumb key={`${doc.rev}-${i}`} doc={doc} n={i + 1} size={s} active={view.page === i + 1} onClick={() => goToPage(i + 1)} />
      ))}
    </div>
  );
}

function Thumb({ doc, n, size, active, onClick }: { doc: OpenDoc; n: number; size: { w: number; h: number }; active: boolean; onClick: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const holder = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const scale = 132 / Math.max(size.w, size.h, 1);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: "300px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !canvas.current) return;
    // A page that fails to draw keeps its blank paper.
    renderPage(doc.pdf, n, canvas.current, scale).catch(() => undefined);
  }, [visible, doc.pdf, n, scale]);

  useEffect(() => {
    if (active) holder.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <button ref={holder} className={active ? "thumb active" : "thumb"} onClick={onClick} aria-label={`Page ${n}`} aria-current={active}>
      <span className="thumb-paper" style={{ width: size.w * scale, height: size.h * scale }}>
        {visible && <canvas ref={canvas} />}
      </span>
      <span className="thumb-no">{n}</span>
    </button>
  );
}

// ---------- search ----------

function Search({ doc }: { doc: OpenDoc }) {
  const view = useView();
  const [query, setQuery] = useState(view.find.query);
  const [matchCase, setMatchCase] = useState(false);
  const [whole, setWhole] = useState(false);
  const [pagesHit, setPagesHit] = useState<{ page: number; text: string; count: number }[] | null>(null);
  const textCache = useRef(new Map<number, string>());

  useEffect(() => {
    textCache.current = new Map();
    setPagesHit(null);
  }, [doc.pdf]);
  // Leaving the panel clears the highlights.
  useEffect(() => () => closeFind(), []);

  const run = async (q: string) => {
    find(q, false, false, { caseSensitive: matchCase, wholeWord: whole });
    if (!q.trim()) return setPagesHit(null);
    const needle = matchCase ? q : q.toLowerCase();
    const out: { page: number; text: string; count: number }[] = [];
    for (let i = 1; i <= doc.pages; i++) {
      let t = textCache.current.get(i);
      if (t === undefined) {
        try {
          const c = await (await doc.pdf.getPage(i)).getTextContent();
          t = c.items
            .map((it) => ("str" in it ? it.str : ""))
            .join(" ")
            .replace(/\s+/g, " ");
        } catch {
          t = "";
        }
        textCache.current.set(i, t);
      }
      const hay = matchCase ? t : t.toLowerCase();
      let at = hay.indexOf(needle);
      if (at < 0) continue;
      const first = at;
      let count = 0;
      while (at >= 0) {
        count++;
        at = hay.indexOf(needle, at + needle.length);
      }
      out.push({ page: i, count, text: `${first > 40 ? "…" : ""}${t.slice(Math.max(0, first - 40), first + q.length + 70)}…` });
    }
    setPagesHit(out);
  };

  const f = view.find;
  return (
    <div className="search-panel">
      <form
        className="find-box"
        onSubmit={(e) => {
          e.preventDefault();
          if (query === f.query && f.total > 0) find(query, true, false, { caseSensitive: matchCase, wholeWord: whole });
          else void run(query);
        }}
      >
        <SearchIcon size={14} />
        <input value={query} placeholder="Find in document" aria-label="Find in document" onChange={(e) => setQuery(e.target.value)} />
        <button type="button" className="icon" title="Previous (Shift+Enter)" aria-label="Previous match" disabled={!f.total} onClick={() => find(query, true, true, { caseSensitive: matchCase, wholeWord: whole })}>
          <ArrowUpIcon size={14} />
        </button>
        <button type="submit" className="icon" title="Next (Enter)" aria-label="Next match">
          <ArrowDownIcon size={14} />
        </button>
      </form>
      <div className="find-options">
        <label>
          <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case
        </label>
        <label>
          <input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} /> Whole words
        </label>
      </div>
      <div className="find-count small muted" aria-live="polite">
        {f.state === "pending" && "Searching…"}
        {f.state === "not-found" && f.query && "Not found"}
        {f.state === "found" && f.total > 0 && `${f.current} of ${f.total} matches`}
      </div>
      {pagesHit && (
        <div className="find-hits">
          {pagesHit.map((h) => (
            <button key={h.page} className="search-hit" onClick={() => goToPage(h.page)}>
              <strong>
                Page {h.page} <span className="muted small">· {h.count}</span>
              </strong>
              <span className="muted small">{h.text}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
