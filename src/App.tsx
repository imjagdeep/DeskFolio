import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppMenus } from "./appMenu";
import logo from "./assets/logo.png";
import { PasswordDialog, Toasts } from "./components/Common";
import { PAGES, Sidebar, type Page } from "./components/Sidebar";
import { UpdateBanner } from "./components/UpdateBanner";
import { api } from "./lib/api";
import { openPath, useDoc } from "./lib/doc";
import { refreshAppInfo, toast, toastError, useAppInfo, useAutoUpdate, useTheme } from "./lib/store";
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
import { ShellDialogs } from "./shell/Dialogs";
import { MenuBar } from "./shell/MenuBar";
import { applySavedZoom } from "./shell/shell";

export default function App() {
  const [page, setPageRaw] = useState<Page>("home");
  const setPage = useCallback((p: Page) => setPageRaw(p), []);
  const menus = useAppMenus(page, setPage);
  const info = useAppInfo();
  const doc = useDoc();
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

  // The window title follows the open document and page, like any editor.
  useEffect(() => {
    const where = PAGES.find((p) => p.page === page)?.label ?? "";
    const title = doc ? `${doc.dirty ? "• " : ""}${doc.name} — DeskFolio` : page === "home" ? "DeskFolio" : `${where} — DeskFolio`;
    void getCurrentWindow().setTitle(title).catch(() => undefined);
  }, [page, doc]);

  // The zoom chosen last time (View › Zoom).
  useEffect(() => {
    void applySavedZoom().catch(() => undefined);
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
    <div className="app-frame">
      <MenuBar appName="DeskFolio" menus={menus} onError={toastError} />
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
      </div>
      <PasswordDialog />
      <ShellDialogs
        menus={menus}
        onError={toastError}
        about={{
          name: "DeskFolio",
          logo,
          version: info?.version ?? "",
          tagline: "View, organize, sign, compress, convert and OCR your PDFs, all on your own computer.",
          links: [
            { label: "Website", open: () => void api.openLink("site").catch(toastError) },
            { label: "Source code", open: () => void api.openLink("repo").catch(toastError) },
            { label: "What's new", open: () => void api.openLink("releases").catch(toastError) },
            { label: "Report a problem", open: () => void api.openLink("issues").catch(toastError) },
          ],
        }}
      />
      <UpdateBanner app="DeskFolio" />
      <Toasts />
    </div>
  );
}
