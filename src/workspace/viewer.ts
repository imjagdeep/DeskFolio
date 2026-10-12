// The document view: pdf.js's own viewer (continuous scroll, text selection,
// links, search highlights), driven from DeskFolio's ribbon, status bar and
// side panels through this one controller. One viewer exists at a time: the
// active tab's. Each tab remembers its page and zoom for when it comes back.

import { AnnotationEditorType, AnnotationMode } from "pdfjs-dist";
import { EventBus, GenericL10n, PDFFindController, PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
import { useSyncExternalStore } from "react";
import type { PDFDocumentProxy } from "../lib/pdfjs";
import { createStore } from "../lib/store";

/** "page-width" etc. are pdf.js's own preset names. */
export type ScaleValue = "page-width" | "page-fit" | "page-actual" | "auto" | number;
/** pdf.js ScrollMode / SpreadMode values. */
export const SCROLL = { vertical: 0, horizontal: 1, wrapped: 2, page: 3 } as const;
export const SPREAD = { none: 0, odd: 1, even: 2 } as const;

export interface ViewState {
  ready: boolean;
  page: number;
  pages: number;
  /** Current zoom as a factor (1 = 100%). */
  scale: number;
  /** The preset in use, if any ("page-width", "page-fit"...). */
  preset: string | null;
  rotation: number;
  scroll: number;
  spread: number;
  /** Pages drawn light-on-dark for reading at night. */
  dark: boolean;
  find: { query: string; current: number; total: number; state: "idle" | "found" | "not-found" | "pending" };
}

const initial: ViewState = {
  ready: false,
  page: 1,
  pages: 0,
  scale: 1,
  preset: "page-width",
  rotation: 0,
  scroll: SCROLL.vertical,
  spread: SPREAD.none,
  dark: false,
  find: { query: "", current: 0, total: 0, state: "idle" },
};

const viewStore = createStore<ViewState>(initial);
export const useView = () => useSyncExternalStore(viewStore.subscribe, viewStore.get);
const patch = (p: Partial<ViewState>) => viewStore.set({ ...viewStore.get(), ...p });

/** Where each tab was: page, zoom, layout (restored when it is shown again). */
const remembered = new Map<number, { page: number; scale: string; rotation: number; scroll: number; spread: number }>();

let viewer: PDFViewer | null = null;
let link: PDFLinkService | null = null;
let bus: EventBus | null = null;
let tab: number | null = null;

const ZOOMS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6.4, 8];

/**
 * Start a viewer in `container` (must be position: absolute, with `inner`
 * inside it) for one tab's document. Returns a function that stops it.
 */
export function mountViewer(container: HTMLDivElement, inner: HTMLDivElement, tabId: number, pdf: PDFDocumentProxy): () => void {
  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus });
  const findController = new PDFFindController({ eventBus, linkService });
  const v = new PDFViewer({
    container,
    viewer: inner,
    eventBus,
    linkService,
    findController,
    l10n: new GenericL10n("en-us"),
    // Show links and existing annotations; filling forms happens in Fill & Sign.
    annotationMode: AnnotationMode.ENABLE,
    annotationEditorMode: AnnotationEditorType.DISABLE,
    textLayerMode: 1,
  });
  linkService.setViewer(v);
  viewer = v;
  link = linkService;
  bus = eventBus;
  tab = tabId;

  const keep = remembered.get(tabId);
  eventBus.on("pagesinit", () => {
    v.currentScaleValue = keep?.scale ?? "page-width";
    if (keep) {
      v.pagesRotation = keep.rotation;
      v.scrollMode = keep.scroll;
      v.spreadMode = keep.spread;
      v.currentPageNumber = Math.min(keep.page, v.pagesCount);
    }
    patch({
      ready: true,
      pages: v.pagesCount,
      page: v.currentPageNumber,
      scale: v.currentScale,
      preset: isPreset(v.currentScaleValue) ? v.currentScaleValue : null,
      rotation: v.pagesRotation,
      scroll: v.scrollMode,
      spread: v.spreadMode,
    });
  });
  eventBus.on("pagechanging", (e: { pageNumber: number }) => patch({ page: e.pageNumber }));
  eventBus.on("scalechanging", (e: { scale: number; presetValue?: string }) =>
    patch({ scale: e.scale, preset: e.presetValue && isPreset(e.presetValue) ? e.presetValue : null }),
  );
  eventBus.on("rotationchanging", (e: { pagesRotation: number }) => patch({ rotation: e.pagesRotation }));
  eventBus.on("scrollmodechanged", (e: { mode: number }) => patch({ scroll: e.mode }));
  eventBus.on("spreadmodechanged", (e: { mode: number }) => patch({ spread: e.mode }));
  eventBus.on("updatefindmatchescount", (e: { matchesCount: { current: number; total: number } }) =>
    patchFind({ current: e.matchesCount.current, total: e.matchesCount.total }),
  );
  eventBus.on("updatefindcontrolstate", (e: { state: number; matchesCount: { current: number; total: number } }) =>
    // FindState: 0 found, 1 not found, 2 wrapped, 3 pending.
    patchFind({
      state: e.state === 1 ? "not-found" : e.state === 3 ? "pending" : "found",
      current: e.matchesCount.current,
      total: e.matchesCount.total,
    }),
  );

  v.setDocument(pdf);
  linkService.setDocument(pdf, null);
  patch({ ready: false, pages: pdf.numPages });

  return () => {
    remembered.set(tabId, {
      page: v.currentPageNumber,
      scale: v.currentScaleValue,
      rotation: v.pagesRotation,
      scroll: v.scrollMode,
      spread: v.spreadMode,
    });
    v.setDocument(null);
    linkService.setDocument(null, null);
    if (viewer === v) {
      viewer = null;
      link = null;
      bus = null;
      tab = null;
      patch({ ready: false, find: { ...viewStore.get().find, current: 0, total: 0, state: "idle" } });
    }
  };
}

/** A tab was closed: nothing to remember for it any more. */
export const forgetView = (tabId: number) => remembered.delete(tabId);

function isPreset(v: string): v is "page-width" | "page-fit" | "page-actual" | "auto" {
  return v === "page-width" || v === "page-fit" || v === "page-actual" || v === "auto";
}
function patchFind(p: Partial<ViewState["find"]>) {
  patch({ find: { ...viewStore.get().find, ...p } });
}

export const hasViewer = () => viewer !== null;
export const activeViewerTab = () => tab;

// ---------- commands (ribbon, status bar, menus, keys) ----------

export function setScale(v: ScaleValue) {
  if (viewer) viewer.currentScaleValue = String(v);
}

export function zoom(dir: 1 | -1) {
  if (!viewer) return;
  const now = viewer.currentScale;
  const next = dir > 0 ? ZOOMS.find((z) => z > now + 0.005) : [...ZOOMS].reverse().find((z) => z < now - 0.005);
  viewer.currentScaleValue = String(next ?? (dir > 0 ? ZOOMS[ZOOMS.length - 1] : ZOOMS[0]));
}

export function goToPage(n: number) {
  if (viewer && n >= 1 && n <= viewer.pagesCount) viewer.currentPageNumber = n;
}

export function nextPage(dir: 1 | -1) {
  if (viewer) goToPage(viewer.currentPageNumber + dir);
}

/** Turn the view (not the file) by 90° steps. */
export function rotateView(dir: 1 | -1) {
  if (viewer) viewer.pagesRotation = (viewer.pagesRotation + dir * 90 + 360) % 360;
}

export function setScroll(mode: number) {
  if (viewer) viewer.scrollMode = mode;
}

export function setSpread(mode: number) {
  if (viewer) viewer.spreadMode = mode;
}

export function setDark(on: boolean) {
  patch({ dark: on });
}

/** Jump to a destination from the outline (bookmarks). */
export function goToDest(dest: string | unknown[] | null) {
  if (link && dest) void link.goToDestination(dest);
}

export interface FindOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
}

/** Search the document, highlighting every match; `again` steps to the next. */
export function find(query: string, again = false, previous = false, opts: FindOptions = {}) {
  if (!bus) return;
  patchFind({ query, state: query ? "pending" : "idle" });
  bus.dispatch("find", {
    source: null,
    type: again ? "again" : "",
    query,
    caseSensitive: !!opts.caseSensitive,
    entireWord: !!opts.wholeWord,
    highlightAll: true,
    findPrevious: previous,
    matchDiacritics: false,
  });
}

export function closeFind() {
  bus?.dispatch("findbarclose", { source: null });
  patchFind({ query: "", current: 0, total: 0, state: "idle" });
}
