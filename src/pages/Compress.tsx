import { useState } from "react";
import { Empty, PageHeader } from "../components/Common";
import { CompressIcon } from "../components/Icons";
import { api } from "../lib/api";
import { applyEdit, currentDoc, loadWithPassword, pickPdfs, saveBytes, useDoc } from "../lib/doc";
import { fileName, humanSize, siblingPath } from "../lib/format";
import { closePdf } from "../lib/pdfjs";
import { toastError } from "../lib/store";

type Preset = "light" | "balanced" | "strong";
const PRESETS: { id: Preset; title: string; text: string }[] = [
  { id: "light", title: "Light", text: "Big images only, hardly any visible change." },
  { id: "balanced", title: "Balanced", text: "Good for email and sharing." },
  { id: "strong", title: "Strong", text: "Smallest file; fine for reading on screen." },
];

interface Source {
  path: string;
  name: string;
  bytes: Uint8Array;
  password?: string;
  /** It is the document open in DeskFolio. */
  isOpenDoc: boolean;
}

export function Compress() {
  const doc = useDoc();
  const [picked, setPicked] = useState<Source | null>(null);
  const src: Source | null =
    picked ?? (doc ? { path: doc.path, name: doc.name, bytes: doc.bytes, password: doc.password, isOpenDoc: true } : null);
  const [preset, setPreset] = useState<Preset>("balanced");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ bytes: Uint8Array; before: number; preset: Preset } | null>(null);

  const pick = async () => {
    try {
      const [path] = await pickPdfs(false, "PDF to compress");
      if (!path) return;
      const bytes = await api.readFile(path);
      const loaded = await loadWithPassword(bytes, fileName(path));
      if (!loaded) return;
      closePdf(loaded.pdf);
      setPicked({ path, name: fileName(path), bytes, password: loaded.password, isOpenDoc: false });
      setResult(null);
    } catch (e) {
      toastError(e);
    }
  };

  const run = async () => {
    if (!src) return;
    setBusy(true);
    setResult(null);
    try {
      const out = await api.compressPdf(src.bytes, preset, src.password);
      setResult({ bytes: out, before: src.bytes.length, preset });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const saved = result ? result.before - result.bytes.length : 0;
  const pct = result && result.before ? Math.round((saved / result.before) * 100) : 0;

  return (
    <div className="page">
      <PageHeader title="Compress" subtitle="Make a PDF smaller. Text and drawings stay sharp; photos are re-saved at a lower size.">
        <button onClick={() => void pick()}>{src ? "Choose another PDF…" : "Choose a PDF…"}</button>
      </PageHeader>

      {!src ? (
        <Empty Icon={CompressIcon} title="Choose the PDF to compress">
          <button className="primary" onClick={() => void pick()}>
            Choose a PDF…
          </button>
        </Empty>
      ) : (
        <>
          <div className="card">
            <div className="ellipsis">
              <strong>{src.name}</strong> <span className="muted">· {humanSize(src.bytes.length)}</span>
            </div>
          </div>
          <div className="preset-grid" role="radiogroup" aria-label="How much">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                role="radio"
                aria-checked={preset === p.id}
                className={preset === p.id ? "preset active" : "preset"}
                onClick={() => {
                  setPreset(p.id);
                  setResult(null);
                }}
              >
                <strong>{p.title}</strong>
                <span className="muted small">{p.text}</span>
              </button>
            ))}
          </div>

          {result && (
            <div className={result.bytes.length < result.before ? "card result good" : "card result"}>
              {result.bytes.length < result.before ? (
                <>
                  <div className="result-big">
                    {humanSize(result.before)} → <strong>{humanSize(result.bytes.length)}</strong>
                  </div>
                  <div className="muted small">
                    {pct}% smaller ({humanSize(saved)} saved). Open the new file and check the pictures before you
                    send it.
                  </div>
                </>
              ) : (
                <div>
                  This PDF is already as small as this setting can make it. {result.preset !== "strong" && "Try Strong, or "}
                  it may be mostly text, which is already compact.
                </div>
              )}
            </div>
          )}

          <div className="action-bar">
            <span className="muted">The original file is not changed.</span>
            <div className="page-actions">
              {result && result.bytes.length < result.before ? (
                <>
                  {src.isOpenDoc && currentDoc() && (
                    <button disabled={busy} onClick={() => void applyEdit(result.bytes, `Compressed (${preset})`)}>
                      Keep editing the smaller one
                    </button>
                  )}
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void saveBytes(result.bytes, siblingPath(src.path, "compressed"))}
                  >
                    Save as…
                  </button>
                </>
              ) : (
                <button className="primary" disabled={busy} onClick={() => void run()}>
                  {busy ? "Compressing…" : "Compress"}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
