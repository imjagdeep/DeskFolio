import { useEffect, useRef, useState } from "react";
import { Empty, PageHeader } from "../components/Common";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, SignIcon } from "../components/Icons";
import { deleteSignature, SignaturePad, useSignatures, type Signature } from "../components/SignaturePad";
import { applyEdit, openDialog, useDoc } from "../lib/doc";
import { plural } from "../lib/format";
import { fillForm, listFields, type FormField } from "../lib/pdf/forms";
import { applyStamps, unsupportedChars, type Stamp } from "../lib/pdf/stamp";
import { renderPage, type PDFDocumentProxy } from "../lib/pdfjs";
import { toast, toastError } from "../lib/store";

/** A placed item, in page points as seen on screen (top-left origin). */
interface Placed {
  id: number;
  page: number;
  kind: "text" | "check" | "cross" | "image";
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  fontSize?: number;
  dataUrl?: string;
}

type Tool = "text" | "date" | "check" | "cross" | { sig: Signature } | null;
let nextId = 1;

function today() {
  return new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function dataUrlBytes(url: string): Uint8Array {
  const b64 = url.slice(url.indexOf(",") + 1);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function Sign() {
  const doc = useDoc();
  const sigs = useSignatures();
  const [pageNo, setPageNo] = useState(1);
  const [scale, setScale] = useState(1);
  const [fields, setFields] = useState<FormField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [tool, setTool] = useState<Tool>(null);
  const [pad, setPad] = useState(false);
  const [flatten, setFlatten] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<{ w: number; h: number } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const area = useRef<HTMLDivElement>(null);

  // Form fields of this version of the document.
  useEffect(() => {
    if (!doc) return;
    let live = true;
    listFields(doc.bytes, { password: doc.password })
      .then((f) => {
        if (!live) return;
        setFields(f);
        setValues(Object.fromEntries(f.map((x) => [x.name, x.value])));
      })
      .catch(() => {
        // Damaged or unusual form: the page still works for text and signatures.
        if (live) setFields([]);
      });
    setPlaced([]);
    return () => {
      live = false;
    };
  }, [doc?.bytes]);

  useEffect(() => setPageNo((n) => Math.min(n, doc?.pages ?? 1)), [doc?.pages]);

  // Draw the page at a width that fits.
  useEffect(() => {
    const pdf = doc?.pdf;
    const box = area.current;
    const cv = canvas.current;
    if (!pdf || !box || !cv) return;
    let cancelled = false;
    void (async () => {
      const page = await pdf.getPage(pageNo);
      const v1 = page.getViewport({ scale: 1 });
      const s = Math.min(1.6, Math.max(0.5, (box.clientWidth - 40) / v1.width));
      if (cancelled) return;
      setScale(s);
      setView({ w: v1.width, h: v1.height });
      await renderPage(pdf, pageNo, cv, s);
    })().catch((e: unknown) => {
      if (!cancelled) toastError(e);
    });
    return () => {
      cancelled = true;
    };
  }, [doc?.pdf, pageNo]);

  if (!doc) {
    return (
      <div className="page">
        <Empty Icon={SignIcon} title="No PDF open" text="Open a PDF to fill in its form, sign it or add text.">
          <button className="primary" onClick={() => void openDialog()}>
            Open a PDF…
          </button>
        </Empty>
      </div>
    );
  }

  const placeAt = (e: React.MouseEvent) => {
    if (!tool || (e.target as HTMLElement).closest(".placed, .field-input")) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = (e.clientX - r.left) / scale;
    const y = (e.clientY - r.top) / scale;
    let item: Placed;
    if (tool === "text" || tool === "date") {
      item = { id: nextId++, page: pageNo, kind: "text", x, y: y - 8, w: 180, h: 20, text: tool === "date" ? today() : "", fontSize: 12 };
    } else if (tool === "check" || tool === "cross") {
      item = { id: nextId++, page: pageNo, kind: tool, x: x - 7, y: y - 7, w: 14, h: 14 };
    } else {
      const w = 150;
      const h = (w * tool.sig.h) / tool.sig.w;
      item = { id: nextId++, page: pageNo, kind: "image", x: x - w / 2, y: y - h / 2, w, h, dataUrl: tool.sig.dataUrl };
    }
    setPlaced((p) => [...p, item]);
    if (tool !== "text") setTool(null);
  };

  const update = (id: number, patch: Partial<Placed>) => setPlaced((p) => p.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  // Drag to move, or resize from the corner handle.
  const drag = (it: Placed, mode: "move" | "resize", e: React.PointerEvent) => {
    if ((e.target as HTMLElement).tagName === "TEXTAREA" && mode === "move") return;
    e.preventDefault();
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY, ox: it.x, oy: it.y, ow: it.w, oh: it.h };
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / scale;
      const dy = (ev.clientY - start.y) / scale;
      if (mode === "move") update(it.id, { x: start.ox + dx, y: start.oy + dy });
      else {
        const w = Math.max(10, start.ow + dx);
        // Images and marks keep their shape; text boxes grow freely.
        update(it.id, it.kind === "text" ? { w, h: Math.max(14, start.oh + dy) } : { w, h: (w * start.oh) / start.ow });
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const fieldChanges = fields.filter((f) => !f.readOnly && values[f.name] !== f.value).length;
  const items = placed.filter((p) => p.kind !== "text" || (p.text ?? "").trim());

  const apply = async () => {
    setBusy(true);
    try {
      const bad = items.flatMap((p) => (p.kind === "text" ? unsupportedChars(p.text ?? "") : []));
      if (bad.length) throw new Error(`These characters can't be added yet: ${[...new Set(bad)].join(" ")}`);
      let bytes = doc.bytes;
      if (fields.length && (fieldChanges || flatten)) bytes = await fillForm(bytes, values, flatten, { password: doc.password });
      if (items.length) {
        const stamps: Stamp[] = [];
        for (const p of items) {
          const page = await doc.pdf.getPage(p.page);
          const v = page.getViewport({ scale: 1 });
          // Visual bottom-left of the item, in PDF user space.
          const [x, y] = v.convertToPdfPoint(p.x, p.y + p.h);
          const base = { page: p.page - 1, x, y, width: p.w, height: p.h, pageRotation: page.rotate };
          if (p.kind === "text") stamps.push({ ...base, kind: "text", text: p.text ?? "", fontSize: p.fontSize ?? 12 });
          else if (p.kind === "image") stamps.push({ ...base, kind: "image", bytes: dataUrlBytes(p.dataUrl ?? ""), type: "image/png" });
          else stamps.push({ ...base, kind: p.kind });
        }
        bytes = await applyStamps(bytes, stamps, { password: doc.password });
      }
      const what = [
        fieldChanges ? `filled ${plural(fieldChanges, "field")}` : "",
        items.length ? `added ${plural(items.length, "item")}` : "",
        flatten ? "locked the form" : "",
      ]
        .filter(Boolean)
        .join(", ");
      if (await applyEdit(bytes, what.charAt(0).toUpperCase() + what.slice(1))) {
        toast("Done. Save it from View when you're happy with it.");
      }
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const pageFields = fields.flatMap((f) => f.widgets.filter((w) => w.page === pageNo - 1).map((w) => ({ f, w })));
  const toolIs = (t: string) => tool === t;
  const sigActive = (s: Signature) => typeof tool === "object" && tool !== null && tool.sig.id === s.id;

  return (
    <div className="page wide sign-page">
      <PageHeader
        title="Fill & Sign"
        subtitle={fields.length ? `${doc.name} · this PDF has ${plural(fields.length, "form field")}` : doc.name}
      >
        <button className="primary" disabled={busy || (!items.length && !fieldChanges && !flatten)} onClick={() => void apply()}>
          {busy ? "Applying…" : "Apply to document"}
        </button>
      </PageHeader>

      <div className="sign-toolbar">
        <div className="segmented">
          <button className={toolIs("text") ? "active" : ""} onClick={() => setTool(toolIs("text") ? null : "text")}>
            Text
          </button>
          <button className={toolIs("date") ? "active" : ""} onClick={() => setTool("date")}>
            Date
          </button>
          <button className={toolIs("check") ? "active" : ""} onClick={() => setTool("check")} aria-label="Check mark">
            ✓
          </button>
          <button className={toolIs("cross") ? "active" : ""} onClick={() => setTool("cross")} aria-label="Cross">
            ✕
          </button>
        </div>
        <div className="sig-strip">
          {sigs.map((s) => (
            <span key={s.id} className={sigActive(s) ? "sig-chip active" : "sig-chip"}>
              <button title="Place this signature" onClick={() => setTool({ sig: s })}>
                <img src={s.dataUrl} alt="Saved signature" />
              </button>
              <button className="sig-del" title="Delete this signature" onClick={() => deleteSignature(s.id)}>
                <CloseIcon size={10} />
              </button>
            </span>
          ))}
          <button onClick={() => setPad(true)}>{sigs.length ? "New signature…" : "Create signature…"}</button>
        </div>
        {fields.length > 0 && (
          <label className="check-row inline">
            <input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} />
            <span>Lock the form after filling</span>
          </label>
        )}
      </div>
      <p className="muted small">
        {tool
          ? "Click on the page to place it. Drag to move, use the corner to resize."
          : "Pick Text, Date, a mark or a signature, then click on the page. Form fields can be typed into directly."}
      </p>

      <div className="sign-nav">
        <button className="icon" disabled={pageNo <= 1} onClick={() => setPageNo(pageNo - 1)} title="Previous page">
          <ChevronLeftIcon size={16} />
        </button>
        <span className="small">
          Page {pageNo} of {doc.pages}
        </span>
        <button className="icon" disabled={pageNo >= doc.pages} onClick={() => setPageNo(pageNo + 1)} title="Next page">
          <ChevronRightIcon size={16} />
        </button>
      </div>

      <div className="sign-area" ref={area}>
        <div
          className={tool ? "sign-sheet placing" : "sign-sheet"}
          style={view ? { width: view.w * scale, height: view.h * scale } : undefined}
          onClick={placeAt}
        >
          <canvas ref={canvas} />
          {view &&
            pageFields.map(({ f, w }, i) => (
              <FieldInput
                key={`${f.name}-${i}`}
                field={f}
                widget={w}
                value={values[f.name] ?? ""}
                scale={scale}
                pdf={doc.pdf}
                pageNo={pageNo}
                onChange={(v) => setValues((cur) => ({ ...cur, [f.name]: v }))}
              />
            ))}
          {placed
            .filter((p) => p.page === pageNo)
            .map((p) => (
              <div
                key={p.id}
                className={`placed placed-${p.kind}`}
                style={{ left: p.x * scale, top: p.y * scale, width: p.w * scale, height: p.h * scale, fontSize: p.h * scale }}
                onPointerDown={(e) => drag(p, "move", e)}
              >
                {p.kind === "text" && (
                  <textarea
                    autoFocus={!p.text}
                    value={p.text}
                    placeholder="Type here"
                    style={{ fontSize: (p.fontSize ?? 12) * scale }}
                    onChange={(e) => update(p.id, { text: e.target.value })}
                  />
                )}
                {p.kind === "image" && <img src={p.dataUrl} alt="" draggable={false} />}
                {p.kind === "check" && <span className="mark">✓</span>}
                {p.kind === "cross" && <span className="mark">✕</span>}
                <button
                  className="placed-del"
                  title="Remove"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setPlaced((all) => all.filter((x) => x.id !== p.id))}
                >
                  <CloseIcon size={10} />
                </button>
                <span className="placed-resize" onPointerDown={(e) => drag(p, "resize", e)} />
              </div>
            ))}
        </div>
      </div>

      {pad && (
        <SignaturePad
          onCancel={() => setPad(false)}
          onDone={(s) => {
            setPad(false);
            setTool({ sig: s });
          }}
        />
      )}
    </div>
  );
}

/** A form field drawn as a real input on top of the page. */
function FieldInput({
  field,
  widget,
  value,
  scale,
  pdf,
  pageNo,
  onChange,
}: {
  field: FormField;
  widget: FormField["widgets"][number];
  value: string;
  scale: number;
  pdf: PDFDocumentProxy;
  pageNo: number;
  onChange: (v: string) => void;
}) {
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useEffect(() => {
    let live = true;
    pdf
      .getPage(pageNo)
      .then((page) => {
        const v = page.getViewport({ scale });
        const [x, y, w, h] = widget.rect;
        const [x1, y1] = v.convertToViewportPoint(x, y);
        const [x2, y2] = v.convertToViewportPoint(x + w, y + h);
        if (live) setBox({ left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) });
      })
      .catch(() => {
        // Page gone (document replaced): nothing to draw.
      });
    return () => {
      live = false;
    };
  }, [pdf, pageNo, scale, widget]);
  if (!box) return null;
  const style = { ...box, fontSize: Math.max(9, Math.min(14, box.height * 0.62)) };
  const ro = field.readOnly;
  if (field.kind === "checkbox") {
    return (
      <input
        type="checkbox"
        className="field-input field-check"
        style={box}
        disabled={ro}
        checked={value === "true"}
        onChange={(e) => onChange(String(e.target.checked))}
        aria-label={field.name}
      />
    );
  }
  if (field.kind === "radio") {
    return (
      <input
        type="radio"
        className="field-input field-radio"
        style={box}
        disabled={ro}
        checked={value === widget.option}
        onChange={() => onChange(widget.option ?? "")}
        aria-label={`${field.name}: ${widget.option ?? ""}`}
      />
    );
  }
  if (field.kind === "dropdown" || field.kind === "list") {
    return (
      <select className="field-input" style={style} disabled={ro} value={value.split("\n")[0]} onChange={(e) => onChange(e.target.value)} aria-label={field.name}>
        <option value="" />
        {field.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  return field.multiline ? (
    <textarea className="field-input" style={style} disabled={ro} value={value} onChange={(e) => onChange(e.target.value)} aria-label={field.name} />
  ) : (
    <input className="field-input" style={style} disabled={ro} value={value} onChange={(e) => onChange(e.target.value)} aria-label={field.name} />
  );
}
