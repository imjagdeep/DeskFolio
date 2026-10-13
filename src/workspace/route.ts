// What each tab shows. A document tab shows the document (the "view" page)
// or one tool working on it (Organize, Fill & Sign...); the Home tab shows
// the start screen or a tool that starts from files (Merge, Settings...).

import { useSyncExternalStore } from "react";
import type { Page } from "./pages";
import { activate, currentDoc, useDoc } from "../lib/doc";
import { createStore } from "../lib/store";

interface Route {
  home: Page;
  /** Per document tab id. */
  docs: Record<number, Page>;
}

const routeStore = createStore<Route>({ home: "home", docs: {} });
const useRoute = () => useSyncExternalStore(routeStore.subscribe, routeStore.get);

/** The page the active tab shows. */
export function usePage(): Page {
  const doc = useDoc();
  const r = useRoute();
  return doc ? (r.docs[doc.id] ?? "view") : r.home;
}

export function currentPage(): Page {
  const doc = currentDoc();
  const r = routeStore.get();
  return doc ? (r.docs[doc.id] ?? "view") : r.home;
}

/** Pages that only make sense on the Home tab. */
const HOME_ONLY: Page[] = ["home", "settings", "digitalids", "account", "agreements"];

/**
 * Show a page. Home and Settings switch to the Home tab; everything else
 * runs in the active document tab, or on the Home tab when none is open.
 */
export function go(page: Page) {
  const r = routeStore.get();
  const doc = currentDoc();
  if (HOME_ONLY.includes(page) || !doc) {
    if (HOME_ONLY.includes(page)) activate(null);
    routeStore.set({ ...r, home: page === "view" ? "home" : page });
    return;
  }
  routeStore.set({ ...r, docs: { ...r.docs, [doc.id]: page } });
}

/** Back from a tool to reading the document (or to the start screen). */
export function back() {
  go(currentDoc() ? "view" : "home");
}
