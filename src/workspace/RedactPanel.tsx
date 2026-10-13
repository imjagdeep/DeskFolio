// The Redact panel: find words or private details to mark, the list of marked
// areas, and Apply.

import { ask } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import type { OpenDoc } from "../lib/doc";
import type { Kind } from "../lib/pdf/redactfind";
import { toast, toastError } from "../lib/store";
import { setOwnTool, useMarkup } from "./markup";
import { addRedactions, applyRedactions, clearRedactions, findInDocument, removeRedaction, useRedactions } from "./redact";
import { goToPage } from "./viewer";

const KINDS: { id: Kind; label: string }[] = [
  { id: "email", label: "Email addresses" },
  { id: "phone", label: "Phone numbers" },
  { id: "card", label: "Card numbers" },
  { id: "ip", label: "IP addresses" },
];

export function RedactPanel({ doc }: { doc: OpenDoc }) {
  const boxes = useRedactions(doc.id);
  const { tool } = useMarkup();
  const [query, setQuery] = useState("");
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [ocr, setOcr] = useState(true);
  const [busy, setBusy] = useState("");

  const find = async () => {
    setBusy("Searching…");
    try {
      const found = await findInDocument(doc, query, kinds);
      // Skip spots already marked.
      const key = (b: { page: number; rect: number[] }) => `${b.page}:${b.rect.map((v) => Math.round(v)).join(",")}`;
      const have = new Set(boxes.map(key));
      const fresh = found.filter((f) => !have.has(key(f)));
      addRedactions(doc.id, fresh);
      toast(fresh.length ? `Marked ${fresh.length} place${fresh.length === 1 ? "" : "s"}. Check them before applying.` : "Nothing new found.");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy("");
    }
  };

  const apply = async () => {
    const pages = new Set(boxes.map((b) => b.page)).size;
    const ok = await ask(
      `${boxes.length} area${boxes.length === 1 ? "" : "s"} on ${pages} page${pages === 1 ? "" : "s"} will be blacked out for good. Those pages become flat pictures${ocr ? " (text recognition makes the rest searchable again)" : ""}; comments and form fields on them are removed. Undo works until you close the document.`,
      { title: "Apply redactions", kind: "warning", okLabel: "Redact", cancelLabel: "Cancel" },
    );
    if (!ok) return;
    setBusy("Starting…");
    try {
      const n = await applyRedactions({ ocr, onStage: setBusy });
      if (n) toast(`Redacted. ${n} page${n === 1 ? " was" : "s were"} redrawn. Save to keep it.`);
      if (tool === "redact") setOwnTool("redact");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="redact-panel">
      <button className={tool === "redact" ? "redact-mark on" : "redact-mark"} onClick={() => setOwnTool("redact")}>
        {tool === "redact" ? "Drawing areas: drag on the page" : "Mark an area by hand"}
      </button>
      <div className="redact-find">
        <input value={query} placeholder="Words to find and black out" aria-label="Words to redact" onChange={(e) => setQuery(e.target.value)} />
        {KINDS.map((k) => (
          <label key={k.id} className="check-row">
            <input type="checkbox" checked={kinds.includes(k.id)} onChange={(e) => setKinds(e.target.checked ? [...kinds, k.id] : kinds.filter((x) => x !== k.id))} />
            <span>{k.label}</span>
          </label>
        ))}
        <button disabled={!!busy || (!query.trim() && !kinds.length)} onClick={() => void find()}>
          Find and mark
        </button>
      </div>
      <div className="redact-list">
        {!boxes.length && <p className="side-note">Nothing marked yet.</p>}
        {boxes.map((b) => (
          <div key={b.id} className="redact-row">
            <button className="link" onClick={() => goToPage(b.page + 1)}>
              p. {b.page + 1}
            </button>
            <span className="ellipsis">{b.label}</span>
            <button className="icon" aria-label="Don't redact this" title="Don't redact this" onClick={() => removeRedaction(doc.id, b.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
      {boxes.length > 0 && (
        <div className="redact-foot">
          <label className="check-row">
            <input type="checkbox" checked={ocr} onChange={(e) => setOcr(e.target.checked)} />
            <span>Keep the rest of those pages searchable (OCR)</span>
          </label>
          <div className="redact-actions">
            <button disabled={!!busy} onClick={() => clearRedactions(doc.id)}>
              Clear
            </button>
            <button className="primary danger-fill" disabled={!!busy} onClick={() => void apply()}>
              Apply {boxes.length}
            </button>
          </div>
        </div>
      )}
      {busy && <p className="side-note">{busy}</p>}
    </div>
  );
}
