// Which languages OCR reads: English (built in) plus downloaded packs. Adding a
// language that isn't downloaded yet asks first, then fetches it once (Rust side,
// size + SHA-256 checked). The choice is remembered for every OCR run.

import { useEffect, useState } from "react";
import { api, errorText, type OcrLangInfo } from "../lib/api";
import { humanSize } from "../lib/format";
import { MAX_OCR_LANGS, setOcrLangs, useOcrLangs } from "../lib/ocr";
import { toast, toastError } from "../lib/store";

export function OcrLanguages({ disabled }: { disabled?: boolean }) {
  const chosen = useOcrLangs();
  const [packs, setPacks] = useState<OcrLangInfo[] | null>(null);
  const [busy, setBusy] = useState("");

  const refresh = async () => {
    try {
      setPacks(await api.ocrLangs());
    } catch (e) {
      toastError(e);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const nameOf = (code: string) => (code === "eng" ? "English" : packs?.find((p) => p.code === code)?.name ?? code);
  // a downloaded pack that has since been removed can't be used
  const missing = packs ? chosen.filter((c) => c !== "eng" && !packs.find((p) => p.code === c)?.installed) : [];

  const add = async (code: string) => {
    const pack = packs?.find((p) => p.code === code);
    if (!pack || chosen.includes(code)) return;
    if (!pack.installed) {
      const { ask } = await import("@tauri-apps/plugin-dialog");
      const ok = await ask(
        `Download the ${pack.name} text model (${humanSize(pack.size)})? It comes from tesseract.js's official models on jsDelivr, is checked against a fixed checksum, and stays on this computer - documents are never sent anywhere.`,
        { title: "Add an OCR language", kind: "info", okLabel: "Download", cancelLabel: "Cancel" },
      );
      if (!ok) return;
      setBusy(code);
      try {
        await api.ocrLangDownload(code);
        toast(`${pack.name} downloaded`);
      } catch (e) {
        toast(errorText(e), true);
        setBusy("");
        return;
      }
      setBusy("");
      await refresh();
    }
    setOcrLangs([...chosen, code]);
  };

  const remove = (code: string) => setOcrLangs(chosen.filter((c) => c !== code));

  const deletePack = async (code: string) => {
    try {
      await api.ocrLangRemove(code);
      setOcrLangs(chosen.filter((c) => c !== code));
      await refresh();
    } catch (e) {
      toastError(e);
    }
  };

  const full = chosen.length >= MAX_OCR_LANGS;
  const addable = (packs ?? []).filter((p) => !chosen.includes(p.code));
  const downloaded = (packs ?? []).filter((p) => p.installed);

  return (
    <div className="ocr-langs">
      <div className="ocr-langs-row">
        <span className="muted small">Read in:</span>
        {chosen.map((c) => (
          <span key={c} className={`lang-chip${missing.includes(c) ? " bad" : ""}`} title={missing.includes(c) ? "Not downloaded any more" : undefined}>
            {nameOf(c)}
            {chosen.length > 1 && (
              <button className="icon-btn tiny" aria-label={`Stop reading ${nameOf(c)}`} disabled={disabled} onClick={() => remove(c)}>
                ×
              </button>
            )}
          </span>
        ))}
        <select
          aria-label="Add a language"
          value=""
          disabled={disabled || full || !!busy || !packs}
          onChange={(e) => void add(e.target.value)}
        >
          <option value="">{busy ? `Downloading ${nameOf(busy)}…` : full ? `Up to ${MAX_OCR_LANGS} languages` : "Add a language…"}</option>
          {addable.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
              {p.installed ? "" : ` - download ${humanSize(p.size)}`}
            </option>
          ))}
        </select>
      </div>
      <p className="muted small">
        Pick the languages the document is written in - each extra one makes reading a little slower. English is built in;
        others are downloaded once, on request.
        {missing.length > 0 && <strong> Add {missing.map(nameOf).join(", ")} again - it isn't downloaded any more.</strong>}
      </p>
      {downloaded.length > 0 && (
        <details className="small">
          <summary className="muted">Downloaded languages ({downloaded.length})</summary>
          <ul className="plain-list">
            {downloaded.map((p) => (
              <li key={p.code}>
                {p.name} <span className="muted">· {humanSize(p.size)}</span>{" "}
                <button className="link" disabled={disabled} onClick={() => void deletePack(p.code)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
