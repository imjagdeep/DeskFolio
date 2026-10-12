import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { PageHeader } from "../components/Common";
import { api } from "../lib/api";
import { pageImage, toDocx, toText, toXlsx } from "../lib/convert/fromPdf";
import { loadWithPassword, openPath, pickPdfs, pickSavePath, saveBytes, useDoc } from "../lib/doc";
import { fileName, humanSize, parentDir, plural, siblingPath } from "../lib/format";
import { imagesToPdf, parseRanges, type ImageInput, type PageSizeChoice } from "../lib/pdf/ops";
import { closePdf, type PDFDocumentProxy } from "../lib/pdfjs";
import { toast, toastError } from "../lib/store";

type Target = "word" | "excel" | "text" | "images" | "fromImages" | "fromOffice";

const TARGETS: { id: Target; title: string; text: string; group: "from" | "to" }[] = [
  { id: "word", title: "PDF → Word", text: "Editable .docx with headings, paragraphs and simple tables", group: "from" },
  { id: "excel", title: "PDF → Excel", text: "Tables into a .xlsx, one sheet per page", group: "from" },
  { id: "text", title: "PDF → Text", text: "All the text as a plain .txt file", group: "from" },
  { id: "images", title: "PDF → Images", text: "Each page as a PNG or JPG picture", group: "from" },
  { id: "fromImages", title: "Images → PDF", text: "Photos and scans into one PDF", group: "to" },
  { id: "fromOffice", title: "Office → PDF", text: "Word, Excel or PowerPoint files", group: "to" },
];

interface Source {
  path: string;
  name: string;
  pdf: PDFDocumentProxy;
  /** Loaded here (not the open document), so it must be closed here. */
  own: boolean;
}

const IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "gif", "bmp"];

/** PNG/JPEG pass through; other image types are redrawn as PNG. */
async function asPdfImage(path: string): Promise<ImageInput> {
  const bytes = await api.readFile(path);
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "png") return { bytes, type: "image/png" };
  if (ext === "jpg" || ext === "jpeg") return { bytes, type: "image/jpeg" };
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext("2d")?.drawImage(bmp, 0, 0);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error(`${fileName(path)} couldn't be read as a picture.`);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: "image/png" };
}

export function Convert() {
  const doc = useDoc();
  const [target, setTarget] = useState<Target>("word");
  const [picked, setPicked] = useState<Source | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // PDF → Images
  const [imgType, setImgType] = useState<"image/png" | "image/jpeg">("image/png");
  const [dpi, setDpi] = useState(150);
  const [range, setRange] = useState("");
  // Images → PDF
  const [images, setImages] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState<PageSizeChoice>("a4");
  // Office → PDF
  const [converters, setConverters] = useState<{ office: string[]; libreoffice: string | null } | null>(null);

  const src: Source | null = picked ?? (doc ? { path: doc.path, name: doc.name, pdf: doc.pdf, own: false } : null);
  const fromPdf = TARGETS.find((t) => t.id === target)?.group === "from";

  // A PDF chosen here is closed when replaced or when leaving the page.
  useEffect(
    () => () => {
      if (picked?.own) closePdf(picked.pdf);
    },
    [picked],
  );

  useEffect(() => {
    if (target !== "fromOffice" || converters) return;
    api
      .officeConverters()
      .then(setConverters)
      .catch(() => setConverters({ office: [], libreoffice: null }));
  }, [target, converters]);

  const choosePdf = async () => {
    try {
      const [path] = await pickPdfs(false, "PDF to convert");
      if (!path) return;
      const loaded = await loadWithPassword(await api.readFile(path), fileName(path));
      if (!loaded) return;
      setPicked({ path, name: fileName(path), pdf: loaded.pdf, own: true });
    } catch (e) {
      toastError(e);
    }
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setProgress(null);
    try {
      await work();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };
  const onProgress = (done: number, total: number) => setProgress({ done, total });

  const convertPdf = () =>
    run(async () => {
      if (!src) return;
      if (target === "word") {
        const { bytes, picturePages } = await toDocx(src.pdf, onProgress);
        const saved = await saveBytes(bytes, siblingPath(src.path, "", "docx"), "Word document", "docx");
        if (saved && picturePages) {
          toast(`${plural(picturePages, "page")} had no text (likely scanned) and went in as pictures. Run OCR first to get editable text.`);
        }
      } else if (target === "excel") {
        const { bytes, tables } = await toXlsx(src.pdf, onProgress);
        const saved = await saveBytes(bytes, siblingPath(src.path, "", "xlsx"), "Excel workbook", "xlsx");
        if (saved && !tables) toast("No tables were found, so each line of text is in its own row.");
      } else if (target === "text") {
        const { text, emptyPages } = await toText(src.pdf, onProgress);
        const saved = await saveBytes(new TextEncoder().encode(text), siblingPath(src.path, "", "txt"), "Text", "txt");
        if (saved && emptyPages) toast(`${plural(emptyPages, "page")} had no text (likely scanned). OCR can read them.`);
      } else if (target === "images") {
        const pages = range.trim()
          ? parseRanges(range, src.pdf.numPages).flat()
          : Array.from({ length: src.pdf.numPages }, (_, i) => i);
        const folder = await open({ directory: true, title: "Save the pictures in…", defaultPath: parentDir(src.path) });
        if (typeof folder !== "string") return;
        const ext = imgType === "image/png" ? "png" : "jpg";
        const stem = src.name.replace(/\.pdf$/i, "");
        const sep = folder.includes("\\") ? "\\" : "/";
        let first = "";
        for (let i = 0; i < pages.length; i++) {
          const { bytes } = await pageImage(src.pdf, pages[i] + 1, dpi, imgType);
          const path = `${folder}${sep}${stem} - page ${pages[i] + 1}.${ext}`;
          await api.writeFile(path, bytes);
          if (!first) first = path;
          onProgress(i + 1, pages.length);
        }
        toast(`Saved ${plural(pages.length, "picture")}.`);
        if (first) await api.revealFile(first);
      }
    });

  const addImages = async () => {
    try {
      const r = await open({ multiple: true, title: "Pictures to put in a PDF", filters: [{ name: "Images", extensions: IMAGE_EXT }] });
      const list = Array.isArray(r) ? r : typeof r === "string" ? [r] : [];
      if (list.length) setImages((cur) => [...cur, ...list.filter((p) => !cur.includes(p))]);
    } catch (e) {
      toastError(e);
    }
  };

  const makeFromImages = () =>
    run(async () => {
      const inputs: ImageInput[] = [];
      for (let i = 0; i < images.length; i++) {
        inputs.push(await asPdfImage(images[i]));
        onProgress(i + 1, images.length);
      }
      const bytes = await imagesToPdf(inputs, pageSize);
      const saved = await saveBytes(bytes, siblingPath(images[0], "", "pdf"));
      if (saved) await openPath(saved);
    });

  const fromOffice = () =>
    run(async () => {
      const r = await open({
        title: "Office file to turn into a PDF",
        filters: [{ name: "Office documents", extensions: ["docx", "doc", "rtf", "odt", "xlsx", "xls", "csv", "ods", "pptx", "ppt", "odp"] }],
      });
      if (typeof r !== "string") return;
      const bytes = await api.officeToPdf(r);
      const out = await pickSavePath(siblingPath(r, "", "pdf"));
      if (!out) return;
      await api.writeFile(out, bytes);
      toast(`Saved ${fileName(out)} (${humanSize(bytes.length)}).`);
      await openPath(out);
    });

  const moveImage = (i: number, by: number) =>
    setImages((cur) => {
      const next = [...cur];
      const [x] = next.splice(i, 1);
      next.splice(Math.max(0, Math.min(next.length, i + by)), 0, x);
      return next;
    });

  const hasConverter = !!converters && (converters.office.length > 0 || !!converters.libreoffice);
  const officeNames = (converters?.office ?? []).map((a) => (a === "powerpoint" ? "PowerPoint" : a[0].toUpperCase() + a.slice(1)));

  return (
    <div className="page">
      <PageHeader title="Convert" subtitle="Everything happens on this computer. The original file is never changed." />

      {(["from", "to"] as const).map((g) => (
        <section key={g}>
          <h3 className="section-label">{g === "from" ? "From PDF" : "To PDF"}</h3>
          <div className="preset-grid">
            {TARGETS.filter((t) => t.group === g).map((t) => (
              <button
                key={t.id}
                className={target === t.id ? "preset active" : "preset"}
                aria-pressed={target === t.id}
                disabled={busy}
                onClick={() => setTarget(t.id)}
              >
                <strong>{t.title}</strong>
                <span className="muted small">{t.text}</span>
              </button>
            ))}
          </div>
        </section>
      ))}

      <div className="card convert-panel">
        {fromPdf ? (
          <>
            <div className="row-between">
              <div className="ellipsis wide-ellipsis">
                {src ? (
                  <>
                    <strong>{src.name}</strong> <span className="muted">· {plural(src.pdf.numPages, "page")}</span>
                  </>
                ) : (
                  <span className="muted">Choose the PDF to convert.</span>
                )}
              </div>
              <button disabled={busy} onClick={() => void choosePdf()}>
                {src ? "Choose another PDF…" : "Choose a PDF…"}
              </button>
            </div>
            {target === "images" && (
              <div className="convert-options">
                <label>
                  Format
                  <select value={imgType} onChange={(e) => setImgType(e.target.value as typeof imgType)}>
                    <option value="image/png">PNG (sharp, larger)</option>
                    <option value="image/jpeg">JPG (smaller)</option>
                  </select>
                </label>
                <label>
                  Quality
                  <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
                    <option value={72}>Screen (72 dpi)</option>
                    <option value={150}>Standard (150 dpi)</option>
                    <option value={300}>Print (300 dpi)</option>
                  </select>
                </label>
                <label>
                  Pages
                  <input value={range} placeholder="All, or e.g. 1-3, 5" onChange={(e) => setRange(e.target.value)} />
                </label>
              </div>
            )}
            {target === "word" && (
              <p className="muted small">
                Keeps text, headings and simple tables. Complex layouts and fonts won't match exactly; pages without text become pictures.
              </p>
            )}
            {target === "excel" && (
              <p className="muted small">Finds rows and columns from how the text lines up. Numbers become real numbers you can add up.</p>
            )}
            {target === "text" && <p className="muted small">Text in reading order, with tables as tab-separated columns.</p>}
          </>
        ) : target === "fromImages" ? (
          <>
            <div className="row-between">
              <span className="muted">
                {images.length ? `${plural(images.length, "picture")}, one page each, in this order:` : "PNG, JPG, WebP, GIF or BMP."}
              </span>
              <button disabled={busy} onClick={() => void addImages()}>
                Add pictures…
              </button>
            </div>
            {images.length > 0 && (
              <ul className="file-list">
                {images.map((p, i) => (
                  <li key={p}>
                    <span className="ellipsis wide-ellipsis">{fileName(p)}</span>
                    <span className="grow" />
                    <button className="icon" disabled={i === 0} title="Move up" onClick={() => moveImage(i, -1)}>
                      ↑
                    </button>
                    <button className="icon" disabled={i === images.length - 1} title="Move down" onClick={() => moveImage(i, 1)}>
                      ↓
                    </button>
                    <button className="link" onClick={() => setImages((cur) => cur.filter((x) => x !== p))}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="convert-options">
              <label>
                Page size
                <select value={pageSize} onChange={(e) => setPageSize(e.target.value as PageSizeChoice)}>
                  <option value="a4">A4</option>
                  <option value="letter">Letter</option>
                  <option value="fit">Same as each picture</option>
                </select>
              </label>
            </div>
          </>
        ) : !converters ? (
          <span className="muted">Looking for Microsoft Office or LibreOffice…</span>
        ) : hasConverter ? (
          <p>
            Will use <strong>{officeNames.length ? `Microsoft Office (${officeNames.join(", ")})` : "LibreOffice"}</strong>
            {officeNames.length > 0 && converters.libreoffice ? ", with LibreOffice for the rest" : ""}. It runs hidden and can take
            up to a minute.
          </p>
        ) : (
          <p>
            This needs <strong>Microsoft Office</strong> or the free <strong>LibreOffice</strong> (libreoffice.org) on this computer.
            Neither was found; install one, then come back.
          </p>
        )}
      </div>

      <div className="action-bar">
        <span className="muted">
          {busy ? (progress && progress.total ? `Working… ${progress.done} of ${progress.total}` : "Working…") : "You choose where the result is saved."}
        </span>
        <div className="page-actions">
          {fromPdf && (
            <button className="primary" disabled={busy || !src} onClick={() => void convertPdf()}>
              Convert
            </button>
          )}
          {target === "fromImages" && (
            <button className="primary" disabled={busy || !images.length} onClick={() => void makeFromImages()}>
              Make PDF
            </button>
          )}
          {target === "fromOffice" && (
            <button className="primary" disabled={busy || !hasConverter} onClick={() => void fromOffice()}>
              Choose a file…
            </button>
          )}
        </div>
      </div>
      {busy && progress && progress.total > 0 && (
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
          <div style={{ width: `${(progress.done / progress.total) * 100}%` }} />
        </div>
      )}
    </div>
  );
}
