// The Bookmarks panel: the PDF's outline to jump around in, and an editor to
// add (for the page on screen), rename, delete, reorder and nest bookmarks,
// saved into the document (Undo takes it back).

import { useEffect, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon, TrashIcon } from "../components/Icons";
import { applyEdit, type OpenDoc } from "../lib/doc";
import { addAfter, flatten, indent, move, outdent, removeAt, rename, samePath, type Path } from "../lib/pdf/bookmarks";
import { writeBookmarks, type Bookmark } from "../lib/pdf/pagetools";
import type { PDFDocumentProxy } from "../lib/pdfjs";
import { toastError } from "../lib/store";
import { goToPage, useView } from "./viewer";

/** pdf.js outline items → bookmarks with page numbers (0-based; unknown targets go to page 1). */
async function readOutline(pdf: PDFDocumentProxy): Promise<Bookmark[]> {
  const outline = await pdf.getOutline();
  const pageOf = async (dest: unknown): Promise<number> => {
    try {
      const arr = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
      if (!Array.isArray(arr) || !arr.length) return 0;
      const target: unknown = arr[0];
      if (typeof target === "number") return target;
      if (target && typeof target === "object" && "num" in target && "gen" in target && typeof target.num === "number" && typeof target.gen === "number") {
        return await pdf.getPageIndex({ num: target.num, gen: target.gen });
      }
    } catch {
      // A broken destination: treat as the first page.
    }
    return 0;
  };
  const walk = async (items: { title: string; dest: unknown; items: unknown[] }[]): Promise<Bookmark[]> => {
    const out: Bookmark[] = [];
    for (const it of items) {
      const kids = Array.isArray(it.items) ? it.items.filter(isItem) : [];
      out.push({ title: it.title, page: await pageOf(it.dest), children: await walk(kids) });
    }
    return out;
  };
  return walk((outline ?? []).filter(isItem));
}

function isItem(x: unknown): x is { title: string; dest: unknown; items: unknown[] } {
  return !!x && typeof x === "object" && "title" in x && typeof x.title === "string" && "items" in x;
}

export function Bookmarks({ doc }: { doc: OpenDoc }) {
  const view = useView();
  const [tree, setTree] = useState<Bookmark[] | null>(null);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState<Bookmark[] | null>(null);
  const [sel, setSel] = useState<Path | null>(null);
  const [renaming, setRenaming] = useState<Path | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setTree(null);
    setEditing(null);
    readOutline(doc.pdf)
      .then((t) => live && setTree(t))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [doc.pdf]);

  if (error) return <p className="side-note">The bookmarks in this PDF couldn't be read.</p>;
  if (tree === null) return <p className="side-note">Reading bookmarks…</p>;

  if (!editing) {
    return (
      <div className="bookmarks">
        {tree.length ? (
          <ul className="outline" role="tree">
            {tree.map((b, i) => (
              <OutlineNode key={i} item={b} depth={0} />
            ))}
          </ul>
        ) : (
          <p className="side-note">This PDF has no bookmarks.</p>
        )}
        <div className="bookmarks-foot">
          <button
            onClick={() => {
              setEditing(tree);
              setSel(null);
            }}
          >
            {tree.length ? "Edit bookmarks" : "Add bookmarks"}
          </button>
        </div>
      </div>
    );
  }

  const rows = flatten(editing);
  const act = (r: { tree: Bookmark[]; path: Path }) => {
    setEditing(r.tree);
    setSel(r.path);
  };
  const add = () => {
    const r = addAfter(editing, sel, { title: `Page ${view.page}`, page: view.page - 1, children: [] });
    act(r);
    setRenaming(r.path);
  };
  const save = async () => {
    setBusy(true);
    try {
      if (await applyEdit(await writeBookmarks(doc.bytes, editing, { password: doc.password }), "Bookmarks")) setEditing(null);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bookmarks editing">
      <div className="bm-tools" role="toolbar" aria-label="Edit bookmarks">
        <button className="icon" title={`Add a bookmark for page ${view.page}`} aria-label="Add bookmark" onClick={add}>
          <PlusIcon size={14} />
        </button>
        <button className="icon" title="Move up" aria-label="Move up" disabled={!sel} onClick={() => sel && act(move(editing, sel, -1))}>
          <ArrowUpIcon size={14} />
        </button>
        <button className="icon" title="Move down" aria-label="Move down" disabled={!sel} onClick={() => sel && act(move(editing, sel, 1))}>
          <ArrowDownIcon size={14} />
        </button>
        <button className="icon" title="Out a level" aria-label="Out a level" disabled={!sel || sel.length < 2} onClick={() => sel && act(outdent(editing, sel))}>
          <ChevronLeftIcon size={14} />
        </button>
        <button className="icon" title="Under the one above" aria-label="In a level" disabled={!sel} onClick={() => sel && act(indent(editing, sel))}>
          <ChevronRightIcon size={14} />
        </button>
        <button
          className="icon danger"
          title="Delete (with what's under it)"
          aria-label="Delete bookmark"
          disabled={!sel}
          onClick={() => {
            if (!sel) return;
            setEditing(removeAt(editing, sel));
            setSel(null);
          }}
        >
          <TrashIcon size={14} />
        </button>
      </div>
      <div className="bm-list">
        {!rows.length && <p className="side-note">Go to a page and press + to bookmark it.</p>}
        {rows.map(({ item, path, depth }) => (
          <div
            key={path.join(".")}
            className={samePath(sel, path) ? "bm-row on" : "bm-row"}
            style={{ paddingLeft: 6 + depth * 14 }}
            onClick={() => setSel(path)}
            onDoubleClick={() => setRenaming(path)}
          >
            {samePath(renaming, path) ? (
              <input
                autoFocus
                defaultValue={item.title}
                aria-label="Bookmark name"
                onBlur={(e) => {
                  setEditing(rename(editing, path, e.target.value.trim() || item.title));
                  setRenaming(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setRenaming(null);
                }}
              />
            ) : (
              <>
                <span className="ellipsis">{item.title}</span>
                <button className="link small" title="Go to this page" onClick={() => goToPage(item.page + 1)}>
                  p. {item.page + 1}
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      <p className="muted small bm-hint">Double-click to rename. New bookmarks point at the page on screen.</p>
      <div className="bookmarks-foot">
        <button onClick={() => setEditing(null)}>Cancel</button>
        <button className="primary" disabled={busy} onClick={() => void save()}>
          Save bookmarks
        </button>
      </div>
    </div>
  );
}

function OutlineNode({ item, depth }: { item: Bookmark; depth: number }) {
  const [open, setOpen] = useState(depth === 0 && item.children.length < 12);
  return (
    <li role="treeitem" aria-expanded={item.children.length ? open : undefined}>
      <div className="outline-row" style={{ paddingLeft: 4 + depth * 14 }}>
        {item.children.length > 0 ? (
          <button className={open ? "outline-twisty open" : "outline-twisty"} aria-label={open ? "Collapse" : "Expand"} onClick={() => setOpen(!open)}>
            <ChevronRightIcon size={12} />
          </button>
        ) : (
          <span className="outline-twisty" />
        )}
        <button className="outline-title" onClick={() => goToPage(item.page + 1)} title={item.title}>
          {item.title}
        </button>
      </div>
      {open && item.children.length > 0 && (
        <ul role="group">
          {item.children.map((c, i) => (
            <OutlineNode key={i} item={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
