import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { useAppMenus } from "./appMenu";
import logo from "./assets/logo.png";
import { PasswordDialog, Toasts } from "./components/Common";
import { PAGES } from "./workspace/pages";
import { UpdateBanner } from "./components/UpdateBanner";
import { api } from "./lib/api";
import { okToQuit, openPath, useDoc } from "./lib/doc";
import { refreshAppInfo, toast, toastError, useAppInfo, useAutoUpdate, useTheme } from "./lib/store";
import { checkAndDownload, dailyCheckDue } from "./lib/updates";
import { ShellDialogs } from "./shell/Dialogs";
import { MenuBar } from "./shell/MenuBar";
import { applySavedZoom } from "./shell/shell";
import { go, usePage } from "./workspace/route";
import { TabStrip } from "./workspace/TabStrip";
import { Workspace } from "./workspace/Workspace";

export default function App() {
  const page = usePage();
  const menus = useAppMenus(page, go);
  const info = useAppInfo();
  const doc = useDoc();
  const theme = useTheme();
  const autoUpdate = useAutoUpdate();

  useEffect(() => {
    void refreshAppInfo();
    // Started with PDFs ("Open with DeskFolio", double-click): one tab each.
    api
      .takeStartupPaths()
      .then(async (paths) => {
        for (const p of paths) await openPath(p);
      })
      .catch(() => undefined);
    // PDFs opened while DeskFolio is running.
    const unOpen = listen<string[]>("open-paths", async (e) => {
      for (const p of e.payload) await openPath(p);
    });
    // Dropped onto the window: each PDF opens in a tab; the Merge page takes its own drops.
    const unDrop = getCurrentWebview().onDragDropEvent(async (e) => {
      if (e.payload.type !== "drop") return;
      if (document.body.dataset.dropTarget === "merge") return;
      const pdfs = e.payload.paths.filter((p) => p.toLowerCase().endsWith(".pdf"));
      if (!pdfs.length && e.payload.paths.length) toast("Drop a PDF file to open it.", true);
      for (const p of pdfs) await openPath(p);
    });
    return () => {
      void unOpen.then((f) => f());
      void unDrop.then((f) => f());
    };
  }, []);

  // Closing the window asks first when a tab has unsaved changes.
  useEffect(() => {
    const un = getCurrentWindow().onCloseRequested(async (e) => {
      e.preventDefault();
      if (await okToQuit()) await getCurrentWindow().destroy();
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // The window title follows the active tab, like any editor.
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

  return (
    <div className="app-frame">
      <div className="top-row">
        <MenuBar appName="DeskFolio" menus={menus} onError={toastError} compact />
        <TabStrip />
      </div>
      <div className="app app-workspace">
        <Workspace />
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
