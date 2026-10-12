// The main area: the Home tab (start screen and file tools) or a document tab
// (ribbon, side panel, the document, status bar), or a tool working on that
// document with a way back to it.

import { useEffect, useRef } from "react";
import { ChevronLeftIcon } from "../components/Icons";
import { PAGES, type Page } from "./pages";
import { cycleTab, useDoc } from "../lib/doc";
import { textFieldFocused } from "../shell/shell";
import { Compress } from "../pages/Compress";
import { Convert } from "../pages/Convert";
import { Home } from "../pages/Home";
import { Merge } from "../pages/Merge";
import { Ocr } from "../pages/Ocr";
import { Organize } from "../pages/Organize";
import { SettingsPage } from "../pages/Settings";
import { Sign } from "../pages/Sign";
import { Split } from "../pages/Split";
import { DocView } from "./DocView";
import { Ribbon } from "./Ribbon";
import { back, go, usePage } from "./route";
import { SidePanel } from "./SidePanel";
import { StatusBar } from "./StatusBar";
import { goToPage, nextPage, useView } from "./viewer";

function ToolPage({ page }: { page: Page }) {
  switch (page) {
    case "home":
      return <Home onNavigate={go} onOpened={() => undefined} />;
    case "organize":
      return <Organize />;
    case "sign":
      return <Sign />;
    case "merge":
      return <Merge />;
    case "split":
      return <Split />;
    case "compress":
      return <Compress />;
    case "convert":
      return <Convert />;
    case "ocr":
      return <Ocr />;
    case "settings":
      return <SettingsPage />;
    case "view":
      return null;
  }
}

export function Workspace() {
  const doc = useDoc();
  const page = usePage();
  const view = useView();
  const content = useRef<HTMLElement>(null);

  // Each tool opens at the top.
  useEffect(() => {
    content.current?.scrollTo(0, 0);
  }, [page, doc?.id]);

  // Keys a PDF reader is expected to have.
  const keys = useRef({ page: view.page, pages: view.pages, reading: false });
  keys.current = { page: view.page, pages: view.pages, reading: !!doc && page === "view" };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab" && e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        cycleTab(e.shiftKey ? -1 : 1);
        return;
      }
      const k = keys.current;
      if (!k.reading || textFieldFocused() || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "PageDown") nextPage(1);
      else if (e.key === "PageUp") nextPage(-1);
      else if (e.key === "Home" && e.target === document.body) goToPage(1);
      else if (e.key === "End" && e.target === document.body) goToPage(k.pages);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const label = PAGES.find((p) => p.page === page)?.label ?? "";
  if (!doc) {
    return (
      <div className="task">
        {page !== "home" && (
          <div className="task-bar">
            <button className="with-icon" onClick={back}>
              <ChevronLeftIcon size={14} /> Home
            </button>
            <strong className="task-title">{label}</strong>
          </div>
        )}
        <main className="content" ref={content}>
          <ToolPage page={page} />
        </main>
      </div>
    );
  }

  return (
    <div className="workspace">
      <Ribbon />
      {page === "view" ? (
        <>
          <div className="work-area">
            <SidePanel doc={doc} />
            <DocView doc={doc} />
          </div>
          <StatusBar doc={doc} />
        </>
      ) : (
        <div className="task">
          <div className="task-bar">
            <button className="with-icon" onClick={back}>
              <ChevronLeftIcon size={14} /> Back to {doc.name}
            </button>
            <strong className="task-title">{label}</strong>
          </div>
          <main className="content" ref={content}>
            <ToolPage page={page} />
          </main>
        </div>
      )}
    </div>
  );
}
