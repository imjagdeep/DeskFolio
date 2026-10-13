// Batch processing: pick PDFs (or a folder), tick the steps, run them on
// every file. Originals are never changed; each result is a new file.

import { open } from "@tauri-apps/plugin-dialog";
import { useRef, useState } from "react";
import { PageHeader } from "../components/Common";
import { CloseIcon } from "../components/Icons";
import { api } from "../lib/api";
import { runBatch, type BatchPlan, type FileState, type OutputFormat } from "../lib/batch";
import { pickPdfs } from "../lib/doc";
import { fileName, humanSize, parentDir, plural } from "../lib/format";
import type { Spot, TextOverlay } from "../lib/pdf/pagetools";
import { ALL_ALLOWED } from "../lib/pdf/protect";
import { toast, toastError } from "../lib/store";

interface Settings {
  ocr: boolean;
  watermark: boolean;
  watermarkText: string;
  numbers: boolean;
  numbersKind: "page" | "bates";
  numbersSpot: Spot;
  batesPrefix: string;
  batesDigits: number;
  batesStart: number;
  clean: boolean;
  cleanComments: boolean;
  compress: boolean;
  preset: "light" | "balanced" | "strong";
  format: OutputFormat;
  protect: boolean;
  where: "next" | "folder";
  outDir: string;
  suffix: string;
}

const DEFAULTS: Settings = {
  ocr: false,
  watermark: false,
  watermarkText: "CONFIDENTIAL",
  numbers: false,
  numbersKind: "page",
  numbersSpot: "bc",
  batesPrefix: "DOC",
  batesDigits: 6,
  batesStart: 1,
  clean: false,
  cleanComments: false,
  compress: true,
  preset: "balanced",
  format: "pdf",
  protect: false,
  where: "next",
  outDir: "",
  suffix: "batch",
};

const KEY = "deskfolio-batch";
function readSettings(): Settings {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" ? { ...DEFAULTS, ...v } : DEFAULTS;
  } catch {
    // Unreadable: start from the defaults.
    return DEFAULTS;
  }
}

const SPOTS: { id: Spot; label: string }[] = [
  { id: "bc", label: "Bottom centre" },
  { id: "br", label: "Bottom right" },
  { id: "bl", label: "Bottom left" },
  { id: "tc", label: "Top centre" },
  { id: "tr", label: "Top right" },
  { id: "tl", label: "Top left" },
];

const FORMATS: { id: OutputFormat; label: string }[] = [
  { id: "pdf", label: "PDF" },
  { id: "docx", label: "Word (.docx)" },
  { id: "xlsx", label: "Excel (.xlsx)" },
  { id: "txt", label: "Text (.txt)" },
];

const text = (t: string, spot: Spot, o: Partial<TextOverlay> = {}): TextOverlay => ({
  kind: "text",
  text: t,
  spot,
  font: "Helvetica",
  size: 10,
  color: [0.2, 0.2, 0.2],
  opacity: 1,
  angle: 0,
  margin: 24,
  behind: false,
  ...o,
});

function toPlan(s: Settings, password: string, inputPassword: string): BatchPlan {
  return {
    ocr: s.ocr,
    watermark: s.watermark && s.watermarkText.trim() ? text(s.watermarkText.trim(), "mc", { font: "Helvetica-Bold", size: 60, color: [0.6, 0.6, 0.6], opacity: 0.25, angle: 45, margin: 0 }) : null,
    stamp: s.numbers
      ? s.numbersKind === "bates"
        ? { overlay: text("{bates}", s.numbersSpot), bates: { prefix: s.batesPrefix, digits: Math.min(10, Math.max(1, s.batesDigits)), start: Math.max(0, s.batesStart) } }
        : { overlay: text("Page {page} of {pages}", s.numbersSpot), bates: null }
      : null,
    clean: s.clean ? { metadata: true, attachments: true, scripts: true, comments: s.cleanComments } : null,
    compress: s.compress ? s.preset : null,
    format: s.format,
    protect: s.format === "pdf" && s.protect && password ? { openPassword: password, ownerPassword: password, permissions: ALL_ALLOWED } : null,
    inputPassword,
  };
}

const STATE_LABEL: Record<FileState["state"], string> = { waiting: "Waiting", working: "Working…", done: "Done", failed: "Failed", skipped: "Not done" };

export function Batch() {
  const [files, setFiles] = useState<string[]>([]);
  const [s, setS] = useState<Settings>(readSettings);
  const [password, setPassword] = useState("");
  const [inputPassword, setInputPassword] = useState("");
  const [subfolders, setSubfolders] = useState(false);
  const [states, setStates] = useState<FileState[] | null>(null);
  const [running, setRunning] = useState(false);
  const stop = useRef<AbortController | null>(null);

  const set = (patch: Partial<Settings>) => {
    const next = { ...s, ...patch };
    setS(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Not remembered; fine.
    }
  };
  const add = (paths: string[]) => {
    setStates(null);
    setFiles((old) => [...old, ...paths.filter((p) => !old.includes(p))]);
  };
  const addFiles = async () => add(await pickPdfs(true, "PDFs to process"));
  const addFolder = async () => {
    const dir = await open({ directory: true, title: "Folder of PDFs" });
    if (typeof dir !== "string") return;
    try {
      const found = await api.batchListPdfs(dir, subfolders);
      if (!found.length) toast(`No PDFs in ${fileName(dir) || dir}${subfolders ? " or its subfolders" : ""}.`);
      add(found);
    } catch (e) {
      toastError(e);
    }
  };
  const pickOut = async () => {
    const dir = await open({ directory: true, title: "Save the results in" });
    if (typeof dir === "string") set({ outDir: dir, where: "folder" });
  };

  const anyStep = s.ocr || s.watermark || s.numbers || s.clean || s.compress || s.format !== "pdf" || s.protect;
  const problems = [
    !files.length && "Add some PDFs.",
    !anyStep && "Choose at least one step.",
    s.format === "pdf" && s.protect && password.length < 6 && "Use a password of at least 6 characters.",
    s.where === "folder" && !s.outDir && "Choose the folder for the results.",
    s.watermark && !s.watermarkText.trim() && "Type the watermark text.",
  ].filter((x): x is string => typeof x === "string");

  const run = async () => {
    const ctl = new AbortController();
    stop.current = ctl;
    setRunning(true);
    setStates(files.map(() => ({ state: "waiting" })));
    try {
      const r = await runBatch(
        files,
        toPlan(s, password, inputPassword),
        { dir: s.where === "folder" ? s.outDir : null, suffix: s.suffix },
        (i, st) => setStates((old) => (old ? old.map((x, j) => (j === i ? st : x)) : old)),
        ctl.signal,
      );
      toast(ctl.signal.aborted ? `Stopped: ${plural(r.done, "file")} done.` : r.failed ? `${plural(r.done, "file")} done, ${r.failed} failed.` : `All ${plural(r.done, "file")} done.`);
    } catch (e) {
      toastError(e);
    } finally {
      setRunning(false);
      stop.current = null;
    }
  };

  const firstOutput = states?.find((x): x is Extract<FileState, { state: "done" }> => x.state === "done")?.output;
  const totals = states?.reduce((t, x) => (x.state === "done" ? { before: t.before + x.before, after: t.after + x.after } : t), { before: 0, after: 0 });

  return (
    <div className="page wide batch-page">
      <PageHeader title="Batch" subtitle="Run the same steps on many PDFs. Your originals stay as they are; each result is a new file.">
        {running ? (
          <button className="danger" onClick={() => stop.current?.abort()}>
            Stop
          </button>
        ) : (
          <button className="primary" disabled={problems.length > 0} title={problems[0]} onClick={() => void run()}>
            Process {files.length ? plural(files.length, "file") : "files"}
          </button>
        )}
      </PageHeader>

      <div className="batch-grid">
        <section className="card">
          <h2>Files</h2>
          <div className="form-row">
            <button onClick={() => void addFiles()} disabled={running}>
              Add PDFs…
            </button>
            <button onClick={() => void addFolder()} disabled={running}>
              Add a folder…
            </button>
            <label className="check-row">
              <input type="checkbox" checked={subfolders} onChange={(e) => setSubfolders(e.target.checked)} />
              <span>Include subfolders</span>
            </label>
            {files.length > 0 && !running && (
              <button className="link" onClick={() => (setFiles([]), setStates(null))}>
                Clear all
              </button>
            )}
          </div>
          {files.length === 0 ? (
            <p className="muted small">No files yet. Add PDFs one by one or a whole folder.</p>
          ) : (
            <ul className="batch-files">
              {files.map((f, i) => {
                const st = states?.[i];
                return (
                  <li key={f} className={`batch-file ${st?.state ?? ""}`}>
                    <div className="batch-file-main">
                      <strong className="ellipsis">{fileName(f)}</strong>
                      <span className="muted small ellipsis">{parentDir(f)}</span>
                      {st?.state === "done" && (
                        <span className="small">
                          {humanSize(st.before)} → {humanSize(st.after)}
                          {st.notes.length ? ` · ${st.notes.join(" · ")}` : ""}
                        </span>
                      )}
                      {st?.state === "failed" && <span className="small error-text">{st.error}</span>}
                    </div>
                    {st ? (
                      <span className={`batch-state ${st.state}`}>{STATE_LABEL[st.state]}</span>
                    ) : (
                      <button className="icon" aria-label={`Remove ${fileName(f)}`} title="Remove" onClick={() => setFiles(files.filter((x) => x !== f))}>
                        <CloseIcon size={12} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <label className="field">
            <span>Password for protected files (optional)</span>
            <input type="password" value={inputPassword} autoComplete="off" onChange={(e) => setInputPassword(e.target.value)} />
          </label>
          {states && totals && !running && (
            <div className="action-bar">
              <span className="muted small">
                {totals.before > 0 && `${humanSize(totals.before)} in → ${humanSize(totals.after)} out`}
              </span>
              {firstOutput && <button onClick={() => void api.revealFile(firstOutput)}>Show results</button>}
            </div>
          )}
        </section>

        <section className="card">
          <h2>Steps</h2>
          <p className="muted small">They run in this order on every file.</p>
          <label className="check-row">
            <input type="checkbox" checked={s.ocr} onChange={(e) => set({ ocr: e.target.checked })} />
            <span>
              Recognise text (OCR)
              <span className="muted small block">Makes scanned pages searchable; pages that already have text are left alone. English, offline.</span>
            </span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={s.watermark} onChange={(e) => set({ watermark: e.target.checked })} />
            <span>Watermark</span>
          </label>
          {s.watermark && (
            <div className="batch-sub">
              <input value={s.watermarkText} aria-label="Watermark text" onChange={(e) => set({ watermarkText: e.target.value })} />
              <span className="muted small">Light grey, diagonal, across every page.</span>
            </div>
          )}
          <label className="check-row">
            <input type="checkbox" checked={s.numbers} onChange={(e) => set({ numbers: e.target.checked })} />
            <span>Page numbers or Bates numbers</span>
          </label>
          {s.numbers && (
            <div className="batch-sub form-row">
              <select value={s.numbersKind} aria-label="Numbering" onChange={(e) => set({ numbersKind: e.target.value === "bates" ? "bates" : "page" })}>
                <option value="page">Page 1 of 5</option>
                <option value="bates">Bates numbers (continue across files)</option>
              </select>
              <select value={s.numbersSpot} aria-label="Position" onChange={(e) => set({ numbersSpot: SPOTS.find((x) => x.id === e.target.value)?.id ?? "bc" })}>
                {SPOTS.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </select>
              {s.numbersKind === "bates" && (
                <>
                  <label className="field compact">
                    <span>Prefix</span>
                    <input value={s.batesPrefix} onChange={(e) => set({ batesPrefix: e.target.value })} />
                  </label>
                  <label className="field compact">
                    <span>Digits</span>
                    <input type="number" min={1} max={10} value={s.batesDigits} onChange={(e) => set({ batesDigits: Number(e.target.value) || 6 })} />
                  </label>
                  <label className="field compact">
                    <span>Start at</span>
                    <input type="number" min={0} value={s.batesStart} onChange={(e) => set({ batesStart: Number(e.target.value) || 0 })} />
                  </label>
                  <span className="muted small">
                    First page: {s.batesPrefix}
                    {String(s.batesStart).padStart(s.batesDigits, "0")}
                  </span>
                </>
              )}
            </div>
          )}
          <label className="check-row">
            <input type="checkbox" checked={s.clean} onChange={(e) => set({ clean: e.target.checked })} />
            <span>
              Remove hidden information
              <span className="muted small block">Title/author details, attached files and scripts.</span>
            </span>
          </label>
          {s.clean && (
            <label className="check-row batch-sub">
              <input type="checkbox" checked={s.cleanComments} onChange={(e) => set({ cleanComments: e.target.checked })} />
              <span>Also remove comments and markup</span>
            </label>
          )}
          <label className="check-row">
            <input type="checkbox" checked={s.compress} onChange={(e) => set({ compress: e.target.checked })} />
            <span>Compress</span>
          </label>
          {s.compress && (
            <div className="batch-sub">
              <select value={s.preset} aria-label="Compression" onChange={(e) => set({ preset: e.target.value === "light" ? "light" : e.target.value === "strong" ? "strong" : "balanced" })}>
                <option value="light">Light: big images only</option>
                <option value="balanced">Balanced: good for email</option>
                <option value="strong">Strong: smallest, for screens</option>
              </select>
            </div>
          )}
        </section>

        <section className="card">
          <h2>Save</h2>
          <label className="field">
            <span>Save as</span>
            <select value={s.format} onChange={(e) => set({ format: FORMATS.find((f) => f.id === e.target.value)?.id ?? "pdf" })}>
              {FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          {s.format === "pdf" ? (
            <>
              <label className="check-row">
                <input type="checkbox" checked={s.protect} onChange={(e) => set({ protect: e.target.checked })} />
                <span>
                  Protect with a password
                  <span className="muted small block">AES-256; the same password for every file. Without it, protected files keep their own protection.</span>
                </span>
              </label>
              {s.protect && (
                <label className="field batch-sub">
                  <span>Password (at least 6 characters)</span>
                  <input type="password" value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
                </label>
              )}
            </>
          ) : (
            <p className="muted small">Converted copies are not password-protected.</p>
          )}
          <label className="check-row">
            <input type="radio" name="where" checked={s.where === "next"} onChange={() => set({ where: "next" })} />
            <span>Next to each original</span>
          </label>
          <label className="check-row">
            <input type="radio" name="where" checked={s.where === "folder"} onChange={() => (s.outDir ? set({ where: "folder" }) : void pickOut())} />
            <span>
              In one folder
              {s.outDir && <span className="muted small block ellipsis">{s.outDir}</span>}
            </span>
          </label>
          {s.where === "folder" && (
            <button className="batch-sub" onClick={() => void pickOut()}>
              {s.outDir ? "Change folder…" : "Choose folder…"}
            </button>
          )}
          <label className="field">
            <span>Add to each name</span>
            <input value={s.suffix} onChange={(e) => set({ suffix: e.target.value.replace(/[\\/:*?"<>|]/g, "") })} />
          </label>
          <p className="muted small">
            Example: {files[0] ? fileName(files[0]).replace(/\.pdf$/i, "") : "report"}
            {s.suffix.trim() ? ` (${s.suffix.trim()})` : ""}.{s.format}. Existing files are never replaced; a number is added instead.
          </p>
        </section>
      </div>
      {problems.length > 0 && files.length > 0 && !running && <p className="muted small">{problems[0]}</p>}
    </div>
  );
}
