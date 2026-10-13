// The document view: pdf.js's own viewer (continuous scroll, text selection,
// links, search highlights, and its annotation editor for highlights, text
// boxes, drawings and images), driven from DeskFolio's ribbon, status bar and
// side panels through this one controller. One viewer exists at a time: the
// active tab's. Each tab remembers its page, zoom and tool for when it comes
// back.
//
// Marks made with the editor live in pdf.js until they are written into the
// document's bytes: when the viewer closes (tab switch, opening a tool), and
// before saving, closing or quitting (doc.ts calls the registered flush).

import { AnnotationEditorParamsType, AnnotationEditorType, AnnotationMode } from "pdfjs-dist";
import { EventBus, GenericL10n, PDFFindController, PDFLinkService, PDFViewer, type PDFPageView } from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
import { useSyncExternalStore } from "react";
import { applyEdit, flushPending, setPendingFlush } from "../lib/doc";
import type { PDFDocumentProxy } from "../lib/pdfjs";
import { createStore, toastError } from "../lib/store";

/** "page-width" etc. are pdf.js's own preset names. */
export type ScaleValue = "page-width" | "page-fit" | "page-actual" | "auto" | number;
/** pdf.js ScrollMode / SpreadMode values. */
export const SCROLL = { vertical: 0, horizontal: 1, wrapped: 2, page: 3 } as const;
export const SPREAD = { none: 0, odd: 1, even: 2 } as const;
/** The pdf.js editor tools DeskFolio offers (NONE = select / read). */
export const EDIT = {
  none: AnnotationEditorType.NONE,
  highlight: AnnotationEditorType.HIGHLIGHT,
  text: AnnotationEditorType.FREETEXT,
  draw: AnnotationEditorType.INK,
  image: AnnotationEditorType.STAMP,
} as const;
export const PARAM = AnnotationEditorParamsType;

/** Highlight colours offered (pdf.js's own palette, as name=hex pairs). */
export const HIGHLIGHT_COLORS = "yellow=#FFFF98,green=#53FFBC,blue=#80EBFF,pink=#FFCBE6,red=#FF4F5F";

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
  /** The editor tool in use (EDIT.none = reading). */
  mode: number;
  /** Marks made but not yet written into the document. */
  pendingMarks: boolean;
  marks: { canUndo: boolean; canRedo: boolean; selected: boolean };
}

const initial: ViewState = {
  ready: false,
  page: 1,
  pages: 0,
  scale: 1,
  preset: "auto",
  rotation: 0,
  scroll: SCROLL.vertical,
  spread: SPREAD.none,
  dark: false,
  find: { query: "", current: 0, total: 0, state: "idle" },
  mode: EDIT.none,
  pendingMarks: false,
  marks: { canUndo: false, canRedo: false, selected: false },
};

const viewStore = createStore<ViewState>(initial);
export const useView = () => useSyncExternalStore(viewStore.subscribe, viewStore.get);
const patch = (p: Partial<ViewState>) => viewStore.set({ ...viewStore.get(), ...p });

/** Where each tab was: page, zoom, layout, tool (restored when it is shown again). */
const remembered = new Map<number, { page: number; scale: string; rotation: number; scroll: number; spread: number; mode: number }>();

let viewer: PDFViewer | null = null;
let bus: EventBus | null = null;
let tab: number | null = null;
/** pdf.js creates its editor after the first page loads; a tool chosen before that waits here. */
let editorReady = false;
let wantedMode: number | null = null;

const ZOOMS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6.4, 8];
const MARKS_EDIT = "Comments and markup";

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
    // NONE (not DISABLE) turns the editor on, with no tool chosen yet.
    annotationEditorMode: AnnotationEditorType.NONE,
    annotationEditorHighlightColors: HIGHLIGHT_COLORS,
    textLayerMode: 1,
  });
  linkService.setViewer(v);
  viewer = v;
  bus = eventBus;
  tab = tabId;
  editorReady = false;
  wantedMode = null;
  eventBus.on("annotationeditoruimanager", () => {
    editorReady = true;
    if (wantedMode !== null && wantedMode !== EDIT.none) applyMode(wantedMode);
    wantedMode = null;
  });

  // Track marks that aren't in the file yet.
  let flushed = false;
  const storage = pdf.annotationStorage;
  // Entries in pdf.js's storage = marks added or changed in this viewer.
  const pending = () => storage.size > 0;
  const refreshPending = () => {
    if (viewStore.get().pendingMarks !== pending()) patch({ pendingMarks: pending() });
  };
  const writeMarks = async () => {
    if (flushed || !pending()) return;
    flushed = true;
    try {
      const bytes = await pdf.saveDocument();
      await applyEdit(bytes, MARKS_EDIT, tabId);
    } catch (e) {
      flushed = false;
      toastError(e);
    }
  };
  setPendingFlush(writeMarks);

  const keep = remembered.get(tabId);
  eventBus.on("pagesinit", () => {
    v.currentScaleValue = keep?.scale ?? "auto";
    if (keep) {
      v.pagesRotation = keep.rotation;
      v.scrollMode = keep.scroll;
      v.spreadMode = keep.spread;
      v.currentPageNumber = Math.min(keep.page, v.pagesCount);
      if (keep.mode !== EDIT.none) setEditMode(keep.mode);
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
  eventBus.on("annotationeditormodechanged", (e: { mode: number }) => patch({ mode: e.mode }));
  eventBus.on("editingstateschanged", (e: { details: { hasSomethingToUndo?: boolean; hasSomethingToRedo?: boolean; hasSelectedEditor?: boolean } }) =>
    patch({ marks: { canUndo: !!e.details.hasSomethingToUndo, canRedo: !!e.details.hasSomethingToRedo, selected: !!e.details.hasSelectedEditor }, pendingMarks: pending() }),
  );
  eventBus.on("annotationeditorlayerrendered", refreshPending);
  eventBus.on("switchannotationeditorparams", () => window.setTimeout(refreshPending, 0));
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
  patch({ ready: false, pages: pdf.numPages, mode: EDIT.none, pendingMarks: false, marks: { canUndo: false, canRedo: false, selected: false } });

  return () => {
    remembered.set(tabId, {
      page: v.currentPageNumber,
      scale: v.currentScaleValue,
      rotation: v.pagesRotation,
      scroll: v.scrollMode,
      spread: v.spreadMode,
      mode: viewStore.get().mode,
    });
    // Leaving with marks not yet in the file: write them now. pdf.js reads
    // the marks as saveDocument() is called, so the viewer can go right after.
    if (!flushed && pending()) {
      flushed = true;
      pdf
        .saveDocument()
        .then((bytes) => applyEdit(bytes, MARKS_EDIT, tabId))
        .catch(toastError);
    }
    setPendingFlush(null);
    v.setDocument(null);
    linkService.setDocument(null, null);
    if (viewer === v) {
      viewer = null;
      bus = null;
      tab = null;
      patch({ ready: false, mode: EDIT.none, pendingMarks: false, find: { ...viewStore.get().find, current: 0, total: 0, state: "idle" } });
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
export const viewMode = () => viewStore.get().mode;
export const viewPage = () => viewStore.get().page;
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

// ---------- markup (pdf.js editor) ----------

/** Choose an editor tool; choosing the active one again goes back to reading. */
export function setEditMode(mode: number) {
  if (!viewer) return;
  const next = viewStore.get().mode === mode && mode !== EDIT.none ? EDIT.none : mode;
  if (!editorReady) {
    wantedMode = next;
    return;
  }
  applyMode(next);
}

function applyMode(mode: number) {
  if (!viewer) return;
  try {
    viewer.annotationEditorMode = { mode };
  } catch (e) {
    toastError(e);
  }
}

/** Colour, thickness, size... for the active tool (and the selected mark). */
export function setEditorParam(type: number, value: string | number | boolean) {
  bus?.dispatch("switchannotationeditorparams", { source: null, type, value });
}

/** Undo / redo / delete / select all, inside the editor. */
export function editAction(name: "undo" | "redo" | "delete" | "selectAll") {
  bus?.dispatch("editingaction", { source: null, name });
}

/** Write the marks into the document now (Done button). */
export async function commitMarks(): Promise<void> {
  await flushPending();
}

// ---------- screen ↔ PDF positions (for DeskFolio's own markup tools) ----------

/** The page under an element, as its 0-based index and its element. */
export function pageOf(el: Element | null): { index: number; el: HTMLElement } | null {
  const page = el?.closest<HTMLElement>(".pdfViewer .page[data-page-number]");
  if (!page) return null;
  const no = Number(page.dataset.pageNumber);
  return Number.isInteger(no) && no >= 1 ? { index: no - 1, el: page } : null;
}

/** A point in a page element's CSS pixels (from its top-left) → PDF user space. */
export function toPdfPoint(pageIndex: number, x: number, y: number): [number, number] | null {
  if (!viewer) return null;
  const view: PDFPageView | undefined = viewer.getPageView(pageIndex);
  if (!view) return null;
  const [px, py]: number[] = view.viewport.convertToPdfPoint(x, y);
  return Number.isFinite(px) && Number.isFinite(py) ? [px, py] : null;
}

/** The page's scale in CSS pixels per PDF point (for line widths). */
export function pageScale(pageIndex: number): number {
  const view: PDFPageView | undefined = viewer?.getPageView(pageIndex);
  return view?.viewport.scale ?? 1;
}

/** A PDF user-space rectangle → CSS box inside its page element (left, top, width, height). */
export function toCssRect(pageIndex: number, rect: [number, number, number, number]): [number, number, number, number] | null {
  const view: PDFPageView | undefined = viewer?.getPageView(pageIndex);
  if (!view) return null;
  const [x1, y1]: number[] = view.viewport.convertToViewportPoint(rect[0], rect[1]);
  const [x2, y2]: number[] = view.viewport.convertToViewportPoint(rect[2], rect[3]);
  return [Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)];
}
