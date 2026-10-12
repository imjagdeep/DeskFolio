// DeskFolio's menus: File, Edit, View, Tools, Window, Help.

import { exit } from "@tauri-apps/plugin-process";
import { useEffect, useMemo, useState } from "react";
import { PAGES, type Page } from "./workspace/pages";
import { api, type LabTool } from "./lib/api";
import {
  activate,
  canUndo,
  closeDoc,
  currentDoc,
  cycleTab,
  forgetRecent,
  okToQuit,
  openDialog,
  openPath,
  saveAs,
  saveOver,
  undo,
  useDoc,
  useRecent,
  useTabs,
} from "./lib/doc";
import { setTheme, toastError, useTheme, type Theme } from "./lib/store";
import { checkAndDownload } from "./lib/updates";
import type { Entry, MenuDef } from "./shell/menu";
import { editCommand, openShellDialog, pasteText, setZoom, textFieldFocused, toggleFullscreen, zoomStep } from "./shell/shell";
import { focusSearch, togglePanel, usePanel } from "./workspace/panels";
import { forgetView, rotateView, SCROLL, setDark, setScale, setScroll, setSpread, SPREAD, useView, zoom, goToPage } from "./workspace/viewer";

const LAB_NAMES: Record<string, string> = { deskzero: "DeskZero", deskmedic: "DeskMedic" };
const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

export function useAppMenus(page: Page, go: (p: Page) => void): MenuDef[] {
  const doc = useDoc();
  const tabs = useTabs();
  const recent = useRecent();
  const theme = useTheme();
  const panel = usePanel();
  const view = useView();
  const [lab, setLab] = useState<LabTool[]>([]);
  useEffect(() => {
    api.desklabTools().then(setLab).catch(toastError);
  }, []);

  return useMemo(() => {
    const hasDoc = () => currentDoc() !== null;
    // The document is on screen (not a tool, not Home).
    const reading = () => currentDoc() !== null && page === "view";
    const closeTab = (id: number | null) =>
      void closeDoc(id).then((closed) => {
        if (closed && id !== null) forgetView(id);
      });
    const recentItems: Entry[] = recent.length
      ? [
          ...recent.slice(0, 10).map((p, i) => ({
            id: `recent-${i}`,
            label: fileName(p),
            hidden: true,
            run: async () => {
              if (!(await openPath(p))) forgetRecent(p);
            },
          })),
          "-",
          { id: "recent-clear", label: "Clear list", hidden: true, run: () => recent.forEach(forgetRecent) },
        ]
      : [{ id: "recent-none", label: "No recent files", enabled: () => false, run: () => undefined }];
    const themeItem = (t: Theme, label: string) => ({
      id: `theme-${t}`,
      label,
      checked: () => theme === t,
      run: () => setTheme(t),
    });

    const file: MenuDef = {
      label: "File",
      items: [
        { id: "open", label: "Open…", accel: "Mod+O", run: () => void openDialog() },
        { label: "Open recent", items: recentItems },
        "-",
        { id: "save-as", label: "Save as…", accel: "Mod+S", enabled: hasDoc, run: () => void saveAs() },
        { id: "save-over", label: "Save over original…", accel: "Mod+Shift+S", enabled: () => !!currentDoc()?.dirty, run: () => void saveOver() },
        { id: "reveal", label: "Show in folder", enabled: hasDoc, run: () => api.revealFile(currentDoc()?.path ?? "") },
        "-",
        { id: "close", label: "Close tab", accel: "Mod+W", enabled: hasDoc, run: () => closeTab(currentDoc()?.id ?? null) },
        {
          id: "close-all",
          label: "Close all tabs",
          enabled: () => tabs.docs.length > 0,
          run: async () => {
            for (const d of [...tabs.docs]) {
              if (!(await closeDoc(d.id))) break;
              forgetView(d.id);
            }
          },
        },
        "-",
        { id: "settings", label: "Settings…", accel: "Mod+,", run: () => go("settings") },
        "-",
        { id: "exit", label: "Exit", run: async () => (await okToQuit()) && exit(0) },
      ],
    };

    const edit: MenuDef = {
      label: "Edit",
      items: [
        {
          id: "undo",
          label: "Undo",
          accel: "Mod+Z",
          enabled: () => textFieldFocused() || canUndo(),
          run: () => (textFieldFocused() ? editCommand("undo") : undo()),
        },
        { id: "redo", label: "Redo", accel: "Mod+Y", native: "redo", hidden: true, run: () => editCommand("redo") },
        "-",
        { id: "cut", label: "Cut", accel: "Mod+X", native: "cut", hidden: true, run: () => editCommand("cut") },
        { id: "copy", label: "Copy", accel: "Mod+C", native: "copy", hidden: true, run: () => editCommand("copy") },
        { id: "paste", label: "Paste", accel: "Mod+V", native: "paste", hidden: true, run: pasteText },
        { id: "select-all", label: "Select all", accel: "Mod+A", native: "selectAll", hidden: true, run: () => editCommand("selectAll") },
        "-",
        { id: "find", label: "Find in document…", accel: "Mod+F", enabled: hasDoc, run: () => (go("view"), focusSearch()) },
      ],
    };

    // While reading a document the zoom keys zoom the pages; elsewhere the window.
    const view_: MenuDef = {
      label: "View",
      items: [
        { id: "side-panel", label: "Side panel", accel: "F4", enabled: reading, checked: () => panel !== null, run: togglePanel },
        "-",
        { id: "zoom-in", label: "Zoom in", accel: "Mod+=", run: () => (reading() ? zoom(1) : zoomStep(1)) },
        { id: "zoom-out", label: "Zoom out", accel: "Mod+-", run: () => (reading() ? zoom(-1) : zoomStep(-1)) },
        { id: "zoom-reset", label: reading() ? "Fit width" : "Actual size", accel: "Mod+0", run: () => (reading() ? setScale("page-width") : setZoom(1)) },
        { id: "fit-page", label: "Fit page", accel: "Mod+2", enabled: reading, run: () => setScale("page-fit") },
        { id: "actual-size", label: "Actual size", accel: "Mod+1", enabled: reading, run: () => setScale("page-actual") },
        "-",
        {
          label: "Page layout",
          items: [
            {
              id: "layout-single",
              label: "Single page, continuous",
              enabled: reading,
              checked: () => view.spread === SPREAD.none && view.scroll === SCROLL.vertical,
              run: () => (setSpread(SPREAD.none), setScroll(SCROLL.vertical)),
            },
            {
              id: "layout-two",
              label: "Two pages, continuous",
              enabled: reading,
              checked: () => view.spread !== SPREAD.none && view.scroll === SCROLL.vertical,
              run: () => (setSpread(SPREAD.odd), setScroll(SCROLL.vertical)),
            },
            { id: "layout-page", label: "Page by page", enabled: reading, checked: () => view.scroll === SCROLL.page, run: () => setScroll(SCROLL.page) },
            { id: "layout-wrapped", label: "Wrapped", enabled: reading, checked: () => view.scroll === SCROLL.wrapped, run: () => setScroll(SCROLL.wrapped) },
          ],
        },
        { id: "rotate-left", label: "Rotate view left", enabled: reading, run: () => rotateView(-1) },
        { id: "rotate-right", label: "Rotate view right", enabled: reading, run: () => rotateView(1) },
        "-",
        { id: "first-page", label: "First page", enabled: reading, run: () => goToPage(1) },
        { id: "last-page", label: "Last page", enabled: reading, run: () => goToPage(view.pages) },
        "-",
        { id: "reading-mode", label: "Reading mode (dark pages)", enabled: reading, checked: () => view.dark, run: () => setDark(!view.dark) },
        { label: "Theme", items: [themeItem("system", "Match system"), themeItem("light", "Light"), themeItem("dark", "Dark")] },
        { id: "fullscreen", label: "Full screen", accel: "F11", run: toggleFullscreen },
      ],
    };

    const tools: MenuDef = {
      label: "Tools",
      items: PAGES.filter((p) => p.page !== "settings" && p.page !== "home" && p.page !== "view").map((p) => ({
        id: `go-${p.page}`,
        label: p.label,
        checked: () => page === p.page,
        enabled: () => !p.needsDoc || hasDoc(),
        run: () => go(p.page),
      })),
    };

    const windowMenu: MenuDef = {
      label: "Window",
      items: [
        { id: "next-tab", label: "Next tab", accel: "Mod+PageDown", run: () => cycleTab(1) },
        { id: "prev-tab", label: "Previous tab", accel: "Mod+PageUp", run: () => cycleTab(-1) },
        "-",
        { id: "tab-home", label: "Home", checked: () => tabs.active === null, run: () => (activate(null), go("home")) },
        ...tabs.docs.slice(0, 9).map((d, i) => ({
          id: `tab-${d.id}`,
          label: `${d.dirty ? "• " : ""}${d.name}`,
          accel: `Alt+${i + 1}`,
          checked: () => tabs.active === d.id,
          run: () => activate(d.id),
        })),
      ],
    };

    const help: MenuDef = {
      label: "Help",
      items: [
        { id: "palette", label: "Search commands…", accel: "Mod+K", run: () => openShellDialog("palette") },
        { id: "shortcuts", label: "Keyboard shortcuts", accel: "F1", run: () => openShellDialog("shortcuts") },
        "-",
        { id: "updates", label: "Check for updates…", run: () => (go("settings"), void checkAndDownload(true)) },
        { id: "whats-new", label: "What's new", run: () => api.openLink("releases") },
        { id: "report", label: "Report a problem…", run: () => api.openLink("issues") },
        {
          label: "More DeskLab tools",
          items: lab.map((t) => ({
            id: `lab-${t.id}`,
            label: t.installed ? `Open ${LAB_NAMES[t.id] ?? t.id}` : `Get ${LAB_NAMES[t.id] ?? t.id}`,
            run: () => (t.installed ? api.openTool(t.id) : api.openLink(t.id)),
          })),
        },
        "-",
        { id: "about", label: "About DeskFolio", run: () => openShellDialog("about") },
      ],
    };
    return [file, edit, view_, tools, windowMenu, help];
    // `tabs`, `panel`, `view` and `doc` re-create the menus so checks and greyed items stay current.
  }, [page, go, recent, theme, lab, tabs, panel, view, doc]);
}
