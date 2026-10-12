// Which side panel is open next to the document (remembered between runs).

import { useSyncExternalStore } from "react";
import { createStore } from "../lib/store";

export type PanelId = "pages" | "outline" | "comments" | "search";
const KEY = "deskfolio-panel";

function read(): PanelId | null {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "none") return null;
    return v === "outline" || v === "search" || v === "comments" ? v : "pages";
  } catch {
    // Storage unavailable: show page thumbnails.
    return "pages";
  }
}

const panelStore = createStore<PanelId | null>(read());
export const usePanel = () => useSyncExternalStore(panelStore.subscribe, panelStore.get);
export const currentPanel = () => panelStore.get();

export function setPanel(p: PanelId | null) {
  panelStore.set(p);
  try {
    localStorage.setItem(KEY, p ?? "none");
  } catch {
    // Not remembered; fine.
  }
}

/** F4 / View › Side panel. */
export const togglePanel = () => setPanel(panelStore.get() ? null : "pages");

/** Ctrl+F: open the search panel and put the cursor in its box. */
export function focusSearch() {
  setPanel("search");
  window.setTimeout(() => {
    const el = document.querySelector<HTMLInputElement>(".find-box input");
    el?.focus();
    el?.select();
  }, 30);
}
