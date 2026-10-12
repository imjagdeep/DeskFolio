import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useRef, useState } from "react";
import { PasswordDialog, Toasts } from "./components/Common";
import { Sidebar, type Page } from "./components/Sidebar";
import { UpdateBanner } from "./components/UpdateBanner";
import { api } from "./lib/api";
import { currentDoc, openDialog, openPath, saveAs, undo } from "./lib/doc";
import { refreshAppInfo, toast, useAutoUpdate, useTheme } from "./lib/store";
import { checkAndDownload, dailyCheckDue } from "./lib/updates";
import { Compress } from "./pages/Compress";
import { Convert } from "./pages/Convert";
import { Home } from "./pages/Home";
import { Merge } from "./pages/Merge";
import { Ocr } from "./pages/Ocr";
import { Organize } from "./pages/Organize";
import { SettingsPage } from "./pages/Settings";
import { Sign } from "./pages/Sign";
import { Split } from "./pages/Split";
import { Viewer } from "./pages/Viewer";

export default function App() {
  const [page, setPage] = useState<Page>("home");
  const content = useRef<HTMLElement>(null);
  const theme = useTheme();
  const autoUpdate = useAutoUpdate();

  // Open a PDF and show it.
  const openAndView = async (path: string) => {
    if (await openPath(path)) setPage("view");
  };

  useEffect(() => {
    void refreshAppInfo();
    // Started with a PDF ("Open with DeskFolio", double-click).
    api
      .takeStartupPaths()
      .then((paths) => {
        if (paths[0]) void openAndView(paths[0]);
      })
      .catch(() => undefined);
    // A PDF opened while DeskFolio is running.
    const unOpen = listen<string[]>("open-paths", (e) => {
      if (e.payload[0]) void openAndView(e.payload[0]);
    });
    // Dropped onto the window: a PDF opens; the Merge page takes its own drops.
    const unDrop = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type !== "drop") return;
      if (document.body.dataset.dropTarget === "merge") return;
      const pdf = e.payload.paths.find((p) => p.toLowerCase().endsWith(".pdf"));
      if (pdf) void openAndView(pdf);
      else if (e.payload.paths.length) toast("Drop a PDF file to open it.", true);
    });
    return () => {
      void unOpen.then((f) => f());
      void unDrop.then((f) => f());
    };
  }, []);

  // Keyboard: Ctrl/Cmd+O open, +S save as, +Z undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "o") {
        e.preventDefault();
        void openDialog().then((ok) => ok && setPage("view"));
      } else if (k === "s" && currentDoc()) {
        e.preventDefault();
        void saveAs();
      } else if (k === "z" && currentDoc() && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        void undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Automatic updates: soon after start, then daily. Same as the sister apps.
  useEffect(() => {
    if (!autoUpdate) return;
    const run = () => {
      if (!dailyCheckDue()) return;
      void checkAndDownload(false).then((v) => {
        if (v) void api.notifyUpdate(v).catch(() => undefined);
      });
    };
    const first = window.setTimeout(run, 30_000);
    const every = window.setInterval(run, 3 * 3600 * 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, [autoUpdate]);

  // "system" leaves the attribute off so the CSS media query decides.
  useEffect(() => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Each page opens at the top.
  useEffect(() => {
    content.current?.scrollTo(0, 0);
  }, [page]);

  return (
    <div className="app">
      <Sidebar page={page} onNavigate={setPage} />
      <main className={page === "view" ? "content content-viewer" : "content"} ref={content}>
        {page === "home" && <Home onNavigate={setPage} onOpened={() => setPage("view")} />}
        {page === "view" && <Viewer onNavigate={setPage} />}
        {page === "organize" && <Organize />}
        {page === "sign" && <Sign />}
        {page === "merge" && <Merge />}
        {page === "split" && <Split />}
        {page === "compress" && <Compress />}
        {page === "convert" && <Convert />}
        {page === "ocr" && <Ocr />}
        {page === "settings" && <SettingsPage />}
      </main>
      <PasswordDialog />
      <UpdateBanner app="DeskFolio" />
      <Toasts />
    </div>
  );
}
