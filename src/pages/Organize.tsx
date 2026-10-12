import { useEffect, useRef, useState } from "react";
import { Empty, PageHeader } from "../components/Common";
import { OrganizeIcon, PlusIcon, RotateIcon, TrashIcon, UndoIcon } from "../components/Icons";
import { api } from "../lib/api";
import { applyEdit, canUndo, loadWithPassword, openDialog, pickPdfs, saveBytes, undo, useDoc, type OpenDoc } from "../lib/doc";
import { fileName, plural, siblingPath } from "../lib/format";
import { insertPdf, rebuild, rotatePages } from "../lib/pdf/ops";
import { closePdf, renderPage } from "../lib/pdfjs";
import { toast, toastError } from "../lib/store";

export function Organize() {
  const doc = useDoc();
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const anchor = useRef<number | null>(null);

  // A new version of the document: selection indexes no longer apply.
  useEffect(() => setSel(new Set()), [doc?.rev]);

  if (!doc) {
    return (
      <div className="page">
        <Empty Icon={OrganizeIcon} title="No PDF open" text="Open a PDF to reorder, rotate or delete its pages.">
          <button className="primary" onClick={() => void openDialog()}>
            Open a PDF…
          </button>
        </Empty>
      </div>
    );
  }

  const pages = Array.from({ length: doc.pages }, (_, i) => i);
  const selected = [...sel].sort((a, b) => a - b);
  const opts = { password: doc.password };

  const run = async (what: string, f: () => Promise<Uint8Array>) => {
    setBusy(true);
    try {
      await applyEdit(await f(), what);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const click = (i: number, e: React.MouseEvent) => {
    const add = e.ctrlKey || e.metaKey;
    const from = anchor.current;
    // From the latest selection, even when clicks come faster than renders.
    setSel((prev) => {
      const next = new Set(add ? prev : []);
      if (e.shiftKey && from !== null) {
        const [a, b] = [Math.min(from, i), Math.max(from, i)];
        for (let k = a; k <= b; k++) next.add(k);
      } else if (add && prev.has(i)) {
        next.delete(i);
      } else {
        next.add(i);
      }
      return next;
    });
    if (!e.shiftKey) anchor.current = i;
  };

  const rotate = (by: number) =>
    run(`Rotated ${plural(selected.length, "page")}`, () => rotatePages(doc.bytes, selected, by, opts));

  const remove = () => {
    if (selected.length >= doc.pages) return toast("A PDF needs at least one page; keep one.", true);
    void run(`Deleted ${plural(selected.length, "page")}`, () =>
      rebuild(
        doc.bytes,
        pages.filter((i) => !sel.has(i)).map((index) => ({ index })),
        opts,
      ),
    );
  };

  const move = (from: number, to: number) => {
    // Move the dragged page (or the whole selection, when it's part of it).
    const moving = sel.has(from) ? selected : [from];
    const rest = pages.filter((i) => !moving.includes(i));
    const before = pages.slice(0, to).filter((i) => !moving.includes(i)).length;
    const order = [...rest.slice(0, before), ...moving, ...rest.slice(before)];
    if (order.every((v, k) => v === k)) return;
    void run(`Moved ${plural(moving.length, "page")}`, () => rebuild(doc.bytes, order.map((index) => ({ index })), opts));
  };

  const insert = async () => {
    try {
      const [path] = await pickPdfs(false, "Insert pages from…");
      if (!path) return;
      const bytes = await api.readFile(path);
      const loaded = await loadWithPassword(bytes, fileName(path));
      if (!loaded) return;
      closePdf(loaded.pdf);
      const at = selected.length ? selected[selected.length - 1] + 1 : doc.pages;
      await run(`Inserted ${fileName(path)}`, () => insertPdf(doc.bytes, bytes, at, opts, { password: loaded.password }));
    } catch (e) {
      toastError(e);
    }
  };

  const extract = async () => {
    setBusy(true);
    try {
      const out = await rebuild(doc.bytes, selected.map((index) => ({ index })), opts);
      await saveBytes(out, siblingPath(doc.path, `pages ${selected.map((i) => i + 1).join(",").slice(0, 40)}`));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  // Pointer drag to reorder (HTML drag-and-drop is taken by file drops).
  const onPointerDown = (i: number, e: React.PointerEvent) => {
    if (e.button !== 0 || busy) return;
    const start = { x: e.clientX, y: e.clientY };
    let dragging = false;
    const target = (x: number, y: number) => {
      const tiles = [...(grid.current?.querySelectorAll<HTMLElement>("[data-tile]") ?? [])];
      let best = tiles.length;
      for (const t of tiles) {
        const r = t.getBoundingClientRect();
        if (y < r.bottom && x < r.left + r.width / 2 && y > r.top - 8) {
          best = Number(t.dataset.tile);
          break;
        }
        if (y < r.top - 8) {
          best = Number(t.dataset.tile);
          break;
        }
      }
      return best;
    };
    const onMove = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
      dragging = true;
      setDrag({ from: i, over: target(ev.clientX, ev.clientY) });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (dragging) {
        const over = target(ev.clientX, ev.clientY);
        setDrag(null);
        move(i, over);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div className="page wide">
      <PageHeader title="Organize pages" subtitle={`${doc.name} · ${plural(doc.pages, "page")}`}>
        <button className="icon" title="Undo (Ctrl+Z)" disabled={!canUndo() || busy} onClick={() => void undo()}>
          <UndoIcon size={16} />
        </button>
        <button className="with-icon" disabled={busy} onClick={() => void insert()}>
          <PlusIcon size={14} /> Insert PDF…
        </button>
      </PageHeader>
      <p className="muted small">
        Click to select (Ctrl to add, Shift for a range), drag to move. Changes apply straight away; Undo takes them back,
        and nothing is saved until you choose Save as… (top right).
      </p>

      <div className={selected.length ? "selection-bar on" : "selection-bar"}>
        <span>{selected.length ? `${plural(selected.length, "page")} selected` : "Select pages to rotate, delete or extract"}</span>
        <div className="selection-actions">
          <button className="with-icon" disabled={!selected.length || busy} onClick={() => void rotate(-90)}>
            <RotateIcon size={14} className="flip-x" /> Left
          </button>
          <button className="with-icon" disabled={!selected.length || busy} onClick={() => void rotate(90)}>
            <RotateIcon size={14} /> Right
          </button>
          <button disabled={!selected.length || busy} onClick={() => void extract()}>
            Extract to new PDF…
          </button>
          <button className="with-icon danger" disabled={!selected.length || busy} onClick={remove}>
            <TrashIcon size={14} /> Delete
          </button>
          <button className="link" disabled={!selected.length} onClick={() => setSel(new Set())}>
            Clear
          </button>
          <button className="link" onClick={() => setSel(new Set(pages))}>
            Select all
          </button>
        </div>
      </div>

      <div className={busy ? "page-grid busy" : "page-grid"} ref={grid}>
        {pages.map((i) => (
          <PageTile
            key={`${doc.rev}-${i}`}
            doc={doc}
            index={i}
            selected={sel.has(i)}
            dropBefore={drag !== null && drag.over === i}
            dragging={drag !== null && (drag.from === i || (sel.has(drag.from) && sel.has(i)))}
            onClick={(e) => click(i, e)}
            onPointerDown={(e) => onPointerDown(i, e)}
          />
        ))}
        {drag !== null && drag.over >= doc.pages && <div className="drop-end" />}
      </div>
    </div>
  );
}

function PageTile({
  doc,
  index,
  selected,
  dropBefore,
  dragging,
  onClick,
  onPointerDown,
}: {
  doc: OpenDoc;
  index: number;
  selected: boolean;
  dropBefore: boolean;
  dragging: boolean;
  onClick: (e: React.MouseEvent) => void;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: "400px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !canvas.current) return;
    void (async () => {
      const page = await doc.pdf.getPage(index + 1);
      const v = page.getViewport({ scale: 1 });
      await renderPage(doc.pdf, index + 1, canvas.current as HTMLCanvasElement, 150 / Math.max(v.width, v.height));
    })().catch(() => undefined);
  }, [visible, doc.pdf, index]);

  return (
    <div
      ref={holder}
      data-tile={index}
      className={["page-tile", selected && "selected", dropBefore && "drop-before", dragging && "dragging"].filter(Boolean).join(" ")}
      onClick={onClick}
      onPointerDown={onPointerDown}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`Page ${index + 1}`}
    >
      <div className="page-tile-paper">{visible && <canvas ref={canvas} />}</div>
      <span className="page-tile-no">{index + 1}</span>
    </div>
  );
}
