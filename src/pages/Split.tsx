import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { Empty, PageHeader } from "../components/Common";
import { SplitIcon } from "../components/Icons";
import { api } from "../lib/api";
import { loadWithPassword, pickPdfs, useDoc } from "../lib/doc";
import { fileName, parentDir, plural } from "../lib/format";
import { closePdf } from "../lib/pdfjs";
import { everyN, parseRanges, split } from "../lib/pdf/ops";
import { toast, toastError } from "../lib/store";

type Mode = "ranges" | "every" | "each";

interface Source {
  path: string;
  name: string;
  bytes: Uint8Array;
  pages: number;
  password?: string;
}

export function Split() {
  const doc = useDoc();
  const [picked, setPicked] = useState<Source | null>(null);
  const src: Source | null = picked ?? (doc ? { path: doc.path, name: doc.name, bytes: doc.bytes, pages: doc.pages, password: doc.password } : null);
  const [mode, setMode] = useState<Mode>("ranges");
  const [ranges, setRanges] = useState("");
  const [n, setN] = useState(1);
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    try {
      const [path] = await pickPdfs(false, "PDF to split");
      if (!path) return;
      const bytes = await api.readFile(path);
      const loaded = await loadWithPassword(bytes, fileName(path));
      if (!loaded) return;
      setPicked({ path, name: fileName(path), bytes, pages: loaded.pdf.numPages, password: loaded.password });
      closePdf(loaded.pdf);
    } catch (e) {
      toastError(e);
    }
  };

  let groups: number[][] = [];
  let problem = "";
  if (src) {
    try {
      groups = mode === "ranges" ? (ranges.trim() ? parseRanges(ranges, src.pages) : []) : everyN(src.pages, mode === "each" ? 1 : n);
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
  }

  const run = async () => {
    if (!src) return;
    setBusy(true);
    try {
      const folder = await open({ directory: true, title: "Save the parts in…", defaultPath: parentDir(src.path) });
      if (typeof folder !== "string") return;
      const parts = await split(src.bytes, groups, { password: src.password });
      const stem = src.name.replace(/\.pdf$/i, "");
      const sep = folder.includes("\\") ? "\\" : "/";
      const names = groups.map((g) => {
        const label = g.length === 1 ? `page ${g[0] + 1}` : `pages ${g[0] + 1}-${g[g.length - 1] + 1}`;
        return `${folder}${sep}${stem} (${label}).pdf`;
      });
      for (let i = 0; i < parts.length; i++) await api.writeFile(names[i], parts[i]);
      toast(`Saved ${plural(parts.length, "PDF")} in ${fileName(folder)}`);
      await api.revealFile(names[0]);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title="Split" subtitle="Cut a PDF into several smaller ones.">
        {src && <button onClick={() => void pick()}>Choose another PDF…</button>}
      </PageHeader>

      {!src ? (
        <Empty Icon={SplitIcon} title="Choose the PDF to split">
          <button className="primary" onClick={() => void pick()}>
            Choose a PDF…
          </button>
        </Empty>
      ) : (
        <>
          <div className="card">
            <div className="ellipsis">
              <strong>{src.name}</strong> <span className="muted">· {plural(src.pages, "page")}</span>
            </div>
          </div>
          <div className="card">
            <h2>How to split</h2>
            <div className="segmented" role="group" aria-label="Split mode">
              <button className={mode === "ranges" ? "active" : ""} onClick={() => setMode("ranges")}>
                By page ranges
              </button>
              <button className={mode === "every" ? "active" : ""} onClick={() => setMode("every")}>
                Every N pages
              </button>
              <button className={mode === "each" ? "active" : ""} onClick={() => setMode("each")}>
                One file per page
              </button>
            </div>
            {mode === "ranges" && (
              <label className="field">
                <span>One PDF for each part, e.g. 1-3, 4-10, 11-</span>
                <input value={ranges} onChange={(e) => setRanges(e.target.value)} placeholder="1-3, 4-10, 11-" />
              </label>
            )}
            {mode === "every" && (
              <label className="field">
                <span>Pages per file</span>
                <input type="number" min={1} max={src.pages} value={n} onChange={(e) => setN(Math.max(1, Number(e.target.value) || 1))} />
              </label>
            )}
            {problem && <p className="error-text small">{problem}</p>}
          </div>
          <div className="action-bar">
            <span className="muted">{groups.length ? `${plural(groups.length, "PDF")} will be saved` : "Type the page ranges"}</span>
            <button className="primary" disabled={busy || !groups.length || !!problem} onClick={() => void run()}>
              {busy ? "Splitting…" : "Split and save…"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
