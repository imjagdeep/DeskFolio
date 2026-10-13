// Editing what's on the page: click a line of text to change it, click an
// image to move, resize, replace or delete it, or drag an area to add a link
// (click an existing link to remove it). Every change goes into the document
// (Undo takes it back); text edits are checked with pdf.js before they're kept.

import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { applyEdit, currentDoc, flushPending } from "../lib/doc";
import { CantEdit, deleteImage, listImages, moveImage, replaceImage, replaceTextRun, type PageImage, type Run } from "../lib/pdf/editpage";
import { addLink, removeLinksAt } from "../lib/pdf/markup";
import { closePdf, loadPdf } from "../lib/pdfjs";
import { toast, toastError } from "../lib/store";
import { useMarkup } from "./markup";
import { pageOf, toCssRect, toPdfPoint } from "./viewer";

const local = (el: HTMLElement, e: { clientX: number; clientY: number }): [number, number] => {
  const r = el.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
};

/** Upright text runs on a page with their user-space geometry. */
async function pageRuns(pageIndex: number): Promise<(Run & { str: string })[]> {
  const d = currentDoc();
  if (!d) return [];
  const tc = await (await d.pdf.getPage(pageIndex + 1)).getTextContent();
  return tc.items.flatMap((it) => {
    if (!("str" in it) || !it.str.trim()) return [];
    const [a, b, , dd, e, f] = it.transform;
    if (Math.abs(b) > 0.01 * Math.abs(a) || a <= 0 || dd <= 0) return [];
    return [{ str: it.str, x: e, y: f, w: it.width, h: it.height || dd }];
  });
}

interface TextDraft {
  page: number;
  el: HTMLElement;
  run: Run & { str: string };
  css: [number, number, number, number];
}
interface ImgSel {
  page: number;
  el: HTMLElement;
  img: PageImage;
  css: [number, number, number, number];
}
interface LinkDraft {
  page: number;
  el: HTMLElement;
  rect: [number, number, number, number];
  css: [number, number, number, number];
}

export function EditLayer({ container }: { container: React.RefObject<HTMLDivElement | null> }) {
  const { tool } = useMarkup();
  const [text, setText] = useState<TextDraft | null>(null);
  const [value, setValue] = useState("");
  const [img, setImg] = useState<ImgSel | null>(null);
  const [drag, setDrag] = useState<{ dx: number; dy: number; scale: number } | null>(null);
  const [link, setLink] = useState<LinkDraft | null>(null);
  const [linkTo, setLinkTo] = useState("");
  const [box, setBox] = useState<{ el: HTMLElement; x0: number; y0: number; x1: number; y1: number; page: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef(box);
  boxRef.current = box;

  // Leaving the tool drops whatever was half done.
  useEffect(() => {
    setText(null);
    setImg(null);
    setLink(null);
  }, [tool]);

  useEffect(() => {
    const c = container.current;
    if (!c || (tool !== "edittext" && tool !== "editimage" && tool !== "link")) return;

    const down = async (e: PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(".edit-ui")) return;
      const pg = pageOf(target);
      if (!pg) return;
      e.preventDefault();
      e.stopPropagation();
      const [x, y] = local(pg.el, e);
      const pt = toPdfPoint(pg.index, x, y);
      if (!pt) return;
      if (tool === "edittext") {
        const runs = await pageRuns(pg.index);
        const hit = runs.find((r) => pt[0] >= r.x - 1 && pt[0] <= r.x + r.w + 1 && pt[1] >= r.y - r.h * 0.3 && pt[1] <= r.y + r.h);
        if (!hit) return setText(null);
        const css = toCssRect(pg.index, [hit.x, hit.y - hit.h * 0.25, hit.x + hit.w, hit.y + hit.h * 0.95]);
        if (!css) return;
        setValue(hit.str);
        setText({ page: pg.index, el: pg.el, run: hit, css });
      } else if (tool === "editimage") {
        const d = currentDoc();
        if (!d) return;
        const imgs = await listImages(d.bytes, pg.index);
        const hit = [...imgs].reverse().find((i) => pt[0] >= i.box[0] && pt[0] <= i.box[2] && pt[1] >= i.box[1] && pt[1] <= i.box[3]);
        const css = hit ? toCssRect(pg.index, hit.box) : null;
        setImg(hit && css ? { page: pg.index, el: pg.el, img: hit, css } : null);
        setDrag(null);
      } else {
        setLink(null);
        setBox({ el: pg.el, page: pg.index, x0: x, y0: y, x1: x, y1: y });
        c.setPointerCapture(e.pointerId);
      }
    };
    const move = (e: PointerEvent) => {
      const b = boxRef.current;
      if (!b) return;
      const [x, y] = local(b.el, e);
      setBox({ ...b, x1: x, y1: y });
    };
    const up = async () => {
      const b = boxRef.current;
      setBox(null);
      if (!b) return;
      const a = toPdfPoint(b.page, b.x0, b.y0);
      const z = toPdfPoint(b.page, b.x1, b.y1);
      if (!a || !z) return;
      if (Math.hypot(b.x1 - b.x0, b.y1 - b.y0) < 5) {
        // A click: remove a link there, if any.
        const d = currentDoc();
        if (!d) return;
        try {
          await flushPending();
          const cur = currentDoc();
          if (!cur) return;
          const r = await removeLinksAt(cur.bytes, b.page, a[0], a[1]);
          if (r.removed && (await applyEdit(r.bytes, "Removed a link"))) toast(`Removed ${r.removed} link${r.removed === 1 ? "" : "s"}.`);
        } catch (err) {
          toastError(err);
        }
        return;
      }
      const rect: [number, number, number, number] = [Math.min(a[0], z[0]), Math.min(a[1], z[1]), Math.max(a[0], z[0]), Math.max(a[1], z[1])];
      const css = toCssRect(b.page, rect);
      if (!css) return;
      setLinkTo("");
      setLink({ page: b.page, el: b.el, rect, css });
    };
    const onDown = (e: PointerEvent) => void down(e);
    const onUp = () => void up();
    c.addEventListener("pointerdown", onDown, true);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", onUp);
    return () => {
      c.removeEventListener("pointerdown", onDown, true);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", onUp);
    };
  }, [tool, container]);

  const commit = async (bytes: Uint8Array, what: string) => {
    if (await applyEdit(bytes, what)) {
      setText(null);
      setImg(null);
      setLink(null);
    }
  };

  // ---- text ----
  const saveText = async () => {
    if (!text) return;
    if (value === text.run.str) return setText(null);
    setBusy(true);
    try {
      await flushPending();
      const d = currentDoc();
      if (!d) return;
      const out = await replaceTextRun(d.bytes, text.page, text.run, value);
      // Check: the old words are gone from that spot and the new ones are there.
      const pdf = await loadPdf(out.bytes);
      try {
        const tc = await (await pdf.getPage(text.page + 1)).getTextContent();
        const near = tc.items.flatMap((it) => ("str" in it && Math.abs(it.transform[5] - text.run.y) < text.run.h * 0.5 ? [it.str] : [])).join(" ");
        const oldLeft = text.run.str.trim() && near.includes(text.run.str.trim()) && !value.includes(text.run.str.trim());
        const newMissing = value.trim() && !near.replace(/\s+/g, " ").includes(value.trim().replace(/\s+/g, " "));
        if (oldLeft || newMissing) throw new CantEdit("That line couldn't be changed cleanly, so nothing was changed. You can cover it with a text box, or redact it.");
      } finally {
        closePdf(pdf);
      }
      await commit(out.bytes, value ? `Edited text "${value.slice(0, 30)}"` : "Deleted a line of text");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  // ---- images ----
  const imgPointer = (mode: "move" | "resize") => (e: React.PointerEvent) => {
    if (!img) return;
    e.preventDefault();
    e.stopPropagation();
    const start = [e.clientX, e.clientY];
    const [, , w, h] = img.css;
    const moveFn = (ev: PointerEvent) => {
      const dx = ev.clientX - start[0];
      const dy = ev.clientY - start[1];
      if (mode === "move") setDrag({ dx, dy, scale: 1 });
      else setDrag({ dx: 0, dy: 0, scale: Math.max(0.1, Math.min(8, (w + dx * 2) / w, (h + dy * 2) / h)) });
    };
    const upFn = async () => {
      window.removeEventListener("pointermove", moveFn);
      window.removeEventListener("pointerup", upFn);
      setDrag((cur) => {
        if (cur && (Math.abs(cur.dx) > 1 || Math.abs(cur.dy) > 1 || Math.abs(cur.scale - 1) > 0.01)) void applyImageMove(cur);
        return cur;
      });
    };
    window.addEventListener("pointermove", moveFn);
    window.addEventListener("pointerup", upFn);
  };
  const applyImageMove = async (m: { dx: number; dy: number; scale: number }) => {
    if (!img) return;
    // Screen pixels → PDF units, through the page's own conversion.
    const a = toPdfPoint(img.page, img.css[0], img.css[1]);
    const b = toPdfPoint(img.page, img.css[0] + m.dx, img.css[1] + m.dy);
    if (!a || !b) return;
    try {
      await flushPending();
      const d = currentDoc();
      if (!d) return;
      await commit(await moveImage(d.bytes, img.page, img.img.index, b[0] - a[0], b[1] - a[1], m.scale), m.scale !== 1 ? "Resized an image" : "Moved an image");
    } catch (e) {
      toastError(e);
    } finally {
      setDrag(null);
    }
  };
  const imageAction = async (what: "delete" | "replace") => {
    if (!img) return;
    try {
      await flushPending();
      const d = currentDoc();
      if (!d) return;
      if (what === "delete") return void (await commit(await deleteImage(d.bytes, img.page, img.img.index), "Deleted an image"));
      const path = await open({ title: "Replace with", filters: [{ name: "Picture", extensions: ["png", "jpg", "jpeg"] }] });
      if (typeof path !== "string") return;
      const pic = await api.readFile(path);
      await commit(await replaceImage(d.bytes, img.page, img.img.index, pic, /\.png$/i.test(path) ? "image/png" : "image/jpeg"), "Replaced an image");
    } catch (e) {
      toastError(e);
    }
  };

  // ---- links ----
  const saveLink = async () => {
    if (!link) return;
    const t = linkTo.trim();
    const pageNo = /^(?:p(?:age)?\s*)?(\d+)$/i.exec(t);
    try {
      await flushPending();
      const d = currentDoc();
      if (!d) return;
      const target = pageNo ? { page: Number(pageNo[1]) - 1 } : { url: t };
      await commit(await addLink(d.bytes, link.page, link.rect, target), pageNo ? `Link to page ${pageNo[1]}` : "Web link");
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <>
      {text &&
        createPortal(
          <div className="edit-ui text-edit" style={{ left: text.css[0] - 4, top: text.css[1] - 4, minWidth: Math.max(160, text.css[2] + 8) }}>
            <input
              autoFocus
              value={value}
              aria-label="Text"
              style={{ fontSize: Math.max(11, text.css[3] * 0.72) }}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveText();
                if (e.key === "Escape") setText(null);
              }}
            />
            <div className="edit-actions">
              <span className="muted small">Enter to apply · empty deletes the line</span>
              <button onClick={() => setText(null)}>Cancel</button>
              <button className="primary" disabled={busy} onClick={() => void saveText()}>
                Apply
              </button>
            </div>
          </div>,
          text.el,
        )}
      {img &&
        createPortal(
          <div
            className="edit-ui img-sel"
            style={{
              left: img.css[0] + (drag?.dx ?? 0) - (img.css[2] * ((drag?.scale ?? 1) - 1)) / 2,
              top: img.css[1] + (drag?.dy ?? 0) - (img.css[3] * ((drag?.scale ?? 1) - 1)) / 2,
              width: img.css[2] * (drag?.scale ?? 1),
              height: img.css[3] * (drag?.scale ?? 1),
            }}
            onPointerDown={imgPointer("move")}
            title="Drag to move"
          >
            <span className="img-handle" onPointerDown={imgPointer("resize")} title="Drag to resize" />
            <div className="img-tools" onPointerDown={(e) => e.stopPropagation()}>
              <button onClick={() => void imageAction("replace")}>Replace…</button>
              <button className="danger" onClick={() => void imageAction("delete")}>
                Delete
              </button>
            </div>
          </div>,
          img.el,
        )}
      {box &&
        createPortal(
          <div className="link-draft" style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }} />,
          box.el,
        )}
      {link &&
        createPortal(
          <>
            <div className="link-draft" style={{ left: link.css[0], top: link.css[1], width: link.css[2], height: link.css[3] }} />
            <div className="edit-ui link-pop" style={{ left: link.css[0], top: link.css[1] + link.css[3] + 6 }}>
              <input
                autoFocus
                value={linkTo}
                placeholder="https://… or a page number"
                aria-label="Link to"
                onChange={(e) => setLinkTo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveLink();
                  if (e.key === "Escape") setLink(null);
                }}
              />
              <div className="edit-actions">
                <button onClick={() => setLink(null)}>Cancel</button>
                <button className="primary" disabled={!linkTo.trim()} onClick={() => void saveLink()}>
                  Add link
                </button>
              </div>
            </div>
          </>,
          link.el,
        )}
    </>
  );
}

