// DeskFolio's menus: File, Edit, View, Tools, Help.

import { exit } from "@tauri-apps/plugin-process";
import { useEffect, useMemo, useState } from "react";
import { PAGES, type Page } from "./components/Sidebar";
import { api, type LabTool } from "./lib/api";
import { canUndo, closeDoc, currentDoc, forgetRecent, openDialog, openPath, saveAs, saveOver, undo, useDoc, useRecent } from "./lib/doc";
import { setTheme, toastError, useTheme, type Theme } from "./lib/store";
import { checkAndDownload } from "./lib/updates";
import type { Entry, MenuDef } from "./shell/menu";
import {
  editCommand,
  isCompactSidebar,
  openShellDialog,
  pasteText,
  textFieldFocused,
  toggleFullscreen,
  toggleSidebar,
  useCompactSidebar,
  zoomStep,
  setZoom,
} from "./shell/shell";

const LAB_NAMES: Record<string, string> = { deskzero: "DeskZero", deskmedic: "DeskMedic" };
const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

export function useAppMenus(page: Page, go: (p: Page) => void): MenuDef[] {
  const doc = useDoc();
  const recent = useRecent();
  const theme = useTheme();
  const compact = useCompactSidebar();
  const [lab, setLab] = useState<LabTool[]>([]);
  useEffect(() => {
    api.desklabTools().then(setLab).catch(toastError);
  }, []);

  return useMemo(() => {
    const hasDoc = () => currentDoc() !== null;
    const viewer = (what: string) => window.dispatchEvent(new CustomEvent("viewer-command", { detail: what }));
    const recentItems: Entry[] = recent.length
      ? [
          ...recent.slice(0, 10).map((p, i) => ({
            id: `recent-${i}`,
            label: fileName(p),
            hidden: true,
            run: async () => {
              if (await openPath(p)) go("view");
              else forgetRecent(p);
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
        { id: "open", label: "Open…", accel: "Mod+O", run: async () => (await openDialog()) && go("view") },
        { label: "Open recent", items: recentItems },
        "-",
        { id: "save-as", label: "Save as…", accel: "Mod+S", enabled: hasDoc, run: () => void saveAs() },
        { id: "save-over", label: "Save over original…", accel: "Mod+Shift+S", enabled: () => !!currentDoc()?.dirty, run: () => void saveOver() },
        { id: "reveal", label: "Show in folder", enabled: hasDoc, run: () => api.revealFile(currentDoc()?.path ?? "") },
        "-",
        { id: "close", label: "Close document", accel: "Mod+W", enabled: hasDoc, run: () => (closeDoc(), go("home")) },
        "-",
        { id: "settings", label: "Settings…", accel: "Mod+,", run: () => go("settings") },
        "-",
        { id: "exit", label: "Exit", run: () => exit(0) },
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
        { id: "find", label: "Find in document…", accel: "Mod+F", enabled: hasDoc, run: () => (go("view"), setTimeout(() => viewer("find"), 50)) },
      ],
    };

    const view: MenuDef = {
      label: "View",
      items: [
        { id: "sidebar", label: "Compact sidebar", accel: "Mod+B", checked: () => isCompactSidebar(), run: toggleSidebar },
        "-",
        // On the View page these zoom the PDF; elsewhere the whole window.
        { id: "zoom-in", label: "Zoom in", accel: "Mod+=", run: () => (page === "view" ? viewer("zoom-in") : zoomStep(1)) },
        { id: "zoom-out", label: "Zoom out", accel: "Mod+-", run: () => (page === "view" ? viewer("zoom-out") : zoomStep(-1)) },
        { id: "zoom-reset", label: page === "view" ? "Fit to width" : "Actual size", accel: "Mod+0", run: () => (page === "view" ? viewer("fit") : setZoom(1)) },
        "-",
        { label: "Theme", items: [themeItem("system", "Match system"), themeItem("light", "Light"), themeItem("dark", "Dark")] },
        { id: "fullscreen", label: "Full screen", accel: "F11", run: toggleFullscreen },
      ],
    };

    const tools: MenuDef = {
      label: "Tools",
      items: PAGES.filter((p) => p.page !== "settings").map((p, i) => ({
        id: `go-${p.page}`,
        label: p.label,
        accel: i < 9 ? `Mod+${i + 1}` : undefined,
        enabled: () => !p.needsDoc || hasDoc(),
        run: () => go(p.page),
      })),
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
    return [file, edit, view, tools, help];
    // `compact` and `doc` re-create the menus so checks and greyed items stay current.
  }, [page, go, recent, theme, lab, compact, doc]);
}
