import * as pdfjs from "pdfjs-dist";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, SaveIcon, SearchIcon, UndoIcon, ViewIcon, ZoomInIcon, ZoomOutIcon } from "../components/Icons";
import { Empty } from "../components/Common";
import type { Page } from "../components/Sidebar";
import { canUndo, openDialog, saveAs, saveOver, undo, useDoc, type OpenDoc } from "../lib/doc";
import { renderPage } from "../lib/pdfjs";

const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3];

/** Page sizes in points (unrotated by us), loaded once per document version. */
function usePageSizes(doc: OpenDoc | null) {
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([]);
  useEffect(() => {
    let live = true;
    setSizes([]);
    if (!doc) return;
    void (async () => {
      const out: { w: number; h: number }[] = [];
      for (let i = 1; i <= doc.pages; i++) {
        const v = (await doc.pdf.getPage(i)).getViewport({ scale: 1 });
        out.push({ w: v.width, h: v.height });
        // Show the first pages quickly on long documents.
        if (i === 8 || i === doc.pages) {
          if (!live) return;
          setSizes([...out]);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [doc?.pdf, doc?.rev]);
  return sizes;
}

export function Viewer({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const doc = useDoc();
  const sizes = usePageSizes(doc);
  const scroller = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [width, setWidth] = useState(800);
  const [current, setCurrent] = useState(1);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ page: number; text: string }[] | null>(null);
  const [searching, setSearching] = useState(false);

  // Fit-to-width follows the window.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc?.pdf]);

  const widest = useMemo(() => Math.max(1, ...sizes.map((s) => s.w)), [sizes]);
  const scale = zoom === "fit" ? Math.min(3, Math.max(0.3, (width - 48) / widest)) : zoom;

  const goTo = useCallback((n: number) => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-page="${n}"]`);
    el?.scrollIntoView({ block: "start" });
  }, []);

  // Current page = the one nearest the top of the view.
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    let best = 1;
    for (const p of el.querySelectorAll<HTMLElement>("[data-page]")) {
      if (p.getBoundingClientRect().top - top <= 80) best = Number(p.dataset.page);
      else break;
    }
    setCurrent(best);
  };

  const zoomStep = (dir: 1 | -1) => {
    const now = scale;
    const next = dir > 0 ? ZOOMS.find((z) => z > now + 0.01) : [...ZOOMS].reverse().find((z) => z < now - 0.01);
    setZoom(next ?? (dir > 0 ? ZOOMS[ZOOMS.length - 1] : ZOOMS[0]));
  };

  // Text search over every page (text is cached per document version).
  const textCache = useRef<Map<number, string>>(new Map());
  useEffect(() => {
    textCache.current = new Map();
    setHits(null);
  }, [doc?.pdf]);
  const runSearch = async () => {
    if (!doc || !query.trim()) return setHits(null);
    setSearching(true);
    const q = query.trim().toLowerCase();
    const out: { page: number; text: string }[] = [];
    for (let i = 1; i <= doc.pages; i++) {
      let t = textCache.current.get(i);
      if (t === undefined) {
        const c = await (await doc.pdf.getPage(i)).getTextContent();
        t = c.items.map((it) => ("str" in it ? it.str : "")).join(" ").replace(/\s+/g, " ");
        textCache.current.set(i, t);
      }
      const at = t.toLowerCase().indexOf(q);
      if (at >= 0) out.push({ page: i, text: `${at > 40 ? "…" : ""}${t.slice(Math.max(0, at - 40), at + q.length + 60)}…` });
    }
    setHits(out);
    setSearching(false);
  };

  if (!doc) {
    return (
      <div className="page">
        <Empty Icon={ViewIcon} title="No PDF open" text="Open a PDF to read it here.">
          <button className="primary" onClick={() => void openDialog()}>
            Open a PDF…
          </button>
        </Empty>
      </div>
    );
  }

  return (
    <div className="viewer">
      <div className="viewer-bar">
        <div className="viewer-file ellipsis" title={doc.path}>
          <strong>{doc.name}</strong>
          {doc.dirty && <span className="badge warn">edited</span>}
        </div>
        <div className="viewer-tools">
          <button className="icon" title="Previous page" disabled={current <= 1} onClick={() => goTo(current - 1)}>
            <ChevronLeftIcon size={16} />
          </button>
          <input
            className="page-input"
            aria-label="Page"
            value={current}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (n >= 1 && n <= doc.pages) {
                setCurrent(n);
                goTo(n);
              }
            }}
          />
          <span className="muted small">/ {doc.pages}</span>
          <button className="icon" title="Next page" disabled={current >= doc.pages} onClick={() => goTo(current + 1)}>
            <ChevronRightIcon size={16} />
          </button>
          <span className="bar-sep" />
          <button className="icon" title="Zoom out" onClick={() => zoomStep(-1)}>
            <ZoomOutIcon size={16} />
          </button>
          <button className="zoom-label" title="Fit to width" onClick={() => setZoom("fit")}>
            {Math.round(scale * 100)}%
          </button>
          <button className="icon" title="Zoom in" onClick={() => zoomStep(1)}>
            <ZoomInIcon size={16} />
          </button>
          <span className="bar-sep" />
          <form
            className="viewer-search"
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch();
            }}
          >
            <SearchIcon size={14} />
            <input value={query} placeholder="Find text" aria-label="Find text" onChange={(e) => setQuery(e.target.value)} />
          </form>
        </div>
        <div className="viewer-actions">
          <button className="icon" title="Undo (Ctrl+Z)" disabled={!canUndo()} onClick={() => void undo()}>
            <UndoIcon size={16} />
          </button>
          {doc.dirty && <button onClick={() => void saveOver()}>Save over original</button>}
          <button className="primary with-icon" onClick={() => void saveAs()}>
            <SaveIcon size={14} /> Save as…
          </button>
        </div>
      </div>

      <div className="viewer-body">
        <aside className="thumbs" aria-label="Pages">
          {hits !== null ? (
            <div className="search-results">
              <div className="search-head">
                <span className="small">
                  {searching ? "Searching…" : `${hits.length} page${hits.length === 1 ? "" : "s"} with “${query.trim()}”`}
                </span>
                <button className="link" onClick={() => setHits(null)}>
                  Close
                </button>
              </div>
              {hits.map((h) => (
                <button key={h.page} className="search-hit" onClick={() => goTo(h.page)}>
                  <strong>Page {h.page}</strong>
                  <span className="muted small">{h.text}</span>
                </button>
              ))}
            </div>
          ) : (
            sizes.map((s, i) => (
              <Thumb key={`${doc.rev}-${i}`} doc={doc} n={i + 1} size={s} active={current === i + 1} onClick={() => goTo(i + 1)} />
            ))
          )}
        </aside>
        <div className="pages" ref={scroller} onScroll={onScroll}>
          {sizes.map((s, i) => (
            <PageView key={`${doc.rev}-${i}`} doc={doc} n={i + 1} size={s} scale={scale} root={scroller} />
          ))}
          {sizes.length < doc.pages && <div className="muted small loading-more">Loading pages…</div>}
        </div>
      </div>
      {doc.edits.length === 0 && doc.pages > 0 && (
        <div className="viewer-hint muted small">
          Tip: <button className="link" onClick={() => onNavigate("organize")}>Organize pages</button> to reorder,
          rotate or delete pages.
        </div>
      )}
    </div>
  );
}

/** Renders when scrolled into view (and again when the zoom changes). */
function PageView({
  doc,
  n,
  size,
  scale,
  root,
}: {
  doc: OpenDoc;
  n: number;
  size: { w: number; h: number };
  scale: number;
  root: React.RefObject<HTMLDivElement | null>;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textLayer = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { root: root.current, rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  useEffect(() => {
    if (!visible || !canvas.current || !textLayer.current) return;
    let cancelled = false;
    const layer = textLayer.current;
    void (async () => {
      try {
        await renderPage(doc.pdf, n, canvas.current as HTMLCanvasElement, scale);
        if (cancelled) return;
        // Selectable, searchable text over the drawing.
        const page = await doc.pdf.getPage(n);
        const viewport = page.getViewport({ scale });
        layer.replaceChildren();
        await new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport }).render();
      } catch {
        // A page that fails to draw stays blank; the rest still work.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, scale, doc.pdf, n]);

  return (
    <div
      ref={holder}
      className="pdf-page"
      data-page={n}
      style={{ width: size.w * scale, height: size.h * scale, ["--total-scale-factor" as string]: scale }}
    >
      {visible && <canvas ref={canvas} />}
      <div ref={textLayer} className="textLayer" />
    </div>
  );
}

function Thumb({
  doc,
  n,
  size,
  active,
  onClick,
}: {
  doc: OpenDoc;
  n: number;
  size: { w: number; h: number };
  active: boolean;
  onClick: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const holder = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const scale = 120 / Math.max(size.w, 1);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: "300px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !canvas.current) return;
    renderPage(doc.pdf, n, canvas.current, scale).catch(() => undefined);
  }, [visible, doc.pdf, n, scale]);

  useEffect(() => {
    if (active) holder.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <button ref={holder} className={active ? "thumb active" : "thumb"} onClick={onClick} aria-label={`Page ${n}`}>
      <span className="thumb-paper" style={{ width: size.w * scale, height: size.h * scale }}>
        {visible && <canvas ref={canvas} />}
      </span>
      <span className="thumb-no">{n}</span>
    </button>
  );
}
