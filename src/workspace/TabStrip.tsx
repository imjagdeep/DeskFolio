// The tab strip under the menu bar: Home, then one tab per open PDF (drag to
// reorder, middle-click or × to close), then + to open more.

import { useState } from "react";
import { CloseIcon, HomeIcon, PlusIcon } from "../components/Icons";
import { activate, closeDoc, moveTab, openDialog, useTabs } from "../lib/doc";
import { forgetView } from "./viewer";

export function TabStrip() {
  const { docs, active } = useTabs();
  const [drag, setDrag] = useState<number | null>(null);

  const close = (id: number) =>
    void closeDoc(id).then((closed) => {
      if (closed) forgetView(id);
    });

  return (
    <div className="tabstrip" role="tablist" aria-label="Open documents">
      <button
        role="tab"
        aria-selected={active === null}
        className={active === null ? "doc-tab home-tab active" : "doc-tab home-tab"}
        onClick={() => activate(null)}
        title="Home: recent files and tools"
      >
        <HomeIcon size={15} />
        <span>Home</span>
      </button>
      {docs.map((d, i) => (
        <div
          key={d.id}
          role="tab"
          tabIndex={0}
          aria-selected={active === d.id}
          className={`doc-tab${active === d.id ? " active" : ""}${drag === d.id ? " dragging" : ""}`}
          title={d.path}
          draggable
          onDragStart={(e) => {
            setDrag(d.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={() => setDrag(null)}
          onDragOver={(e) => {
            if (drag !== null && drag !== d.id) {
              e.preventDefault();
              moveTab(drag, i);
            }
          }}
          onClick={() => activate(d.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") activate(d.id);
          }}
          onAuxClick={(e) => {
            if (e.button === 1) close(d.id);
          }}
        >
          <span className="doc-tab-name">{d.name.replace(/\.pdf$/i, "")}</span>
          {d.dirty && <span className="doc-tab-dirty" title="Unsaved changes" />}
          <button
            className="doc-tab-close"
            title="Close (Ctrl+W)"
            aria-label={`Close ${d.name}`}
            onClick={(e) => {
              e.stopPropagation();
              close(d.id);
            }}
          >
            <CloseIcon size={12} />
          </button>
        </div>
      ))}
      <button className="tab-add" title="Open a PDF (Ctrl+O)" aria-label="Open a PDF" onClick={() => void openDialog()}>
        <PlusIcon size={15} />
      </button>
    </div>
  );
}
