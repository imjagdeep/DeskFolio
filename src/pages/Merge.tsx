import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useState } from "react";
import { Empty, PageHeader } from "../components/Common";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, MergeIcon, PlusIcon } from "../components/Icons";
import { api } from "../lib/api";
import { loadWithPassword, openPath, pickPdfs, saveBytes, useDoc } from "../lib/doc";
import { fileName, humanSize, parentDir, plural } from "../lib/format";
import { closePdf } from "../lib/pdfjs";
import { merge, parseRanges } from "../lib/pdf/ops";
import { toast, toastError } from "../lib/store";

interface Item {
  key: number;
  path: string;
  name: string;
  bytes: Uint8Array;
  pages: number;
  password?: string;
  /** Empty = all pages. */
  range: string;
}

let nextKey = 1;

export function Merge() {
  const doc = useDoc();
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);

  const add = async (paths: string[]) => {
    const added: Item[] = [];
    for (const path of paths) {
      try {
        const bytes = await api.readFile(path);
        const loaded = await loadWithPassword(bytes, fileName(path));
        if (!loaded) continue;
        added.push({ key: nextKey++, path, name: fileName(path), bytes, pages: loaded.pdf.numPages, password: loaded.password, range: "" });
        closePdf(loaded.pdf);
      } catch (e) {
        toastError(e);
      }
    }
    if (added.length) setItems((cur) => [...cur, ...added]);
  };

  // Files dropped on this page join the list instead of opening.
  useEffect(() => {
    document.body.dataset.dropTarget = "merge";
    const un = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type !== "drop") return;
      const pdfs = e.payload.paths.filter((p) => p.toLowerCase().endsWith(".pdf"));
      if (pdfs.length) void add(pdfs);
    });
    return () => {
      delete document.body.dataset.dropTarget;
      void un.then((f) => f());
    };
  }, []);

  const addOpenDoc = () => {
    if (!doc) return;
    setItems((cur) => [
      ...cur,
      { key: nextKey++, path: doc.path, name: doc.name, bytes: doc.bytes, pages: doc.pages, password: doc.password, range: "" },
    ]);
  };

  const moveItem = (i: number, by: number) =>
    setItems((cur) => {
      const next = [...cur];
      const [it] = next.splice(i, 1);
      next.splice(Math.max(0, Math.min(next.length, i + by)), 0, it);
      return next;
    });

  const total = items.reduce((n, it) => {
    try {
      return n + (it.range.trim() ? parseRanges(it.range, it.pages).flat().length : it.pages);
    } catch {
      return n;
    }
  }, 0);

  const run = async () => {
    setBusy(true);
    try {
      const inputs = items.map((it) => ({
        bytes: it.bytes,
        password: it.password,
        pages: it.range.trim() ? parseRanges(it.range, it.pages).flat() : undefined,
      }));
      const out = await merge(inputs);
      const first = items[0];
      const target = await saveBytes(out, `${parentDir(first.path)}${first.path.includes("\\") ? "\\" : "/"}Merged.pdf`);
      if (target) {
        toast(`Merged ${plural(items.length, "file")} into ${fileName(target)} (${humanSize(out.length)})`);
        await openPath(target);
      }
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title="Merge" subtitle="Join PDFs into one, in the order below.">
        {doc && (
          <button onClick={addOpenDoc} title={`Add ${doc.name}`}>
            Add the open PDF
          </button>
        )}
        {items.length > 0 && (
          <button className="with-icon" onClick={() => void pickPdfs(true, "Add PDFs").then(add).catch(toastError)}>
            <PlusIcon size={14} /> Add PDFs…
          </button>
        )}
      </PageHeader>

      {items.length === 0 ? (
        <Empty Icon={MergeIcon} title="Add the PDFs to join" text="Use Add PDFs, or drop files on this window.">
          <button className="primary" onClick={() => void pickPdfs(true, "Add PDFs").then(add).catch(toastError)}>
            Add PDFs…
          </button>
        </Empty>
      ) : (
        <>
          <div className="card list">
            {items.map((it, i) => {
              let rangeError = "";
              if (it.range.trim()) {
                try {
                  parseRanges(it.range, it.pages);
                } catch (e) {
                  rangeError = e instanceof Error ? e.message : String(e);
                }
              }
              return (
                <div className="list-row merge-row" key={it.key}>
                  <span className="merge-no">{i + 1}</span>
                  <div className="grow">
                    <div className="ellipsis" title={it.path}>
                      <strong>{it.name}</strong>
                    </div>
                    <div className="muted small">
                      {plural(it.pages, "page")} · {humanSize(it.bytes.length)}
                    </div>
                  </div>
                  <label className="range-field">
                    <span className="muted small">Pages</span>
                    <input
                      value={it.range}
                      placeholder="all"
                      aria-invalid={!!rangeError}
                      title={rangeError || "e.g. 1-3, 5, 8-"}
                      onChange={(e) => setItems((cur) => cur.map((x) => (x.key === it.key ? { ...x, range: e.target.value } : x)))}
                    />
                  </label>
                  <button className="icon" title="Move up" disabled={i === 0} onClick={() => moveItem(i, -1)}>
                    <ChevronLeftIcon size={15} className="rot-90" />
                  </button>
                  <button className="icon" title="Move down" disabled={i === items.length - 1} onClick={() => moveItem(i, 1)}>
                    <ChevronRightIcon size={15} className="rot-90" />
                  </button>
                  <button className="icon" title="Remove" onClick={() => setItems((cur) => cur.filter((x) => x.key !== it.key))}>
                    <CloseIcon size={15} />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="action-bar">
            <span className="muted">
              {plural(items.length, "file")} · {plural(total, "page")} in the result
            </span>
            <button className="primary" disabled={busy || items.length < 2} onClick={() => void run()}>
              {busy ? "Merging…" : "Merge and save…"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
