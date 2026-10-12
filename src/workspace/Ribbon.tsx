// The ribbon under the tabs, Acrobat/Office style: tool tabs (View, Pages,
// Fill & Sign, Convert), each a row of labelled buttons in groups. Save and
// Undo stay at the right end whatever the tab.

import { useState } from "react";
import {
  ActualSizeIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CompressIcon,
  ConvertIcon,
  ExtractIcon,
  FitPageIcon,
  FitWidthIcon,
  FullScreenIcon,
  MergeIcon,
  MoonIcon,
  OcrIcon,
  OrganizeIcon,
  PanelLeftIcon,
  RotateIcon,
  RotateLeftIcon,
  SaveIcon,
  ScrollIcon,
  SearchIcon,
  SignIcon,
  SinglePageIcon,
  SplitIcon,
  TwoPagesIcon,
  UndoIcon,
  ZoomInIcon,
  ZoomOutIcon,
  type IconType,
} from "../components/Icons";
import type { Page } from "./pages";
import { canUndo, saveAs, saveOver, undo, useDoc } from "../lib/doc";
import { toggleFullscreen } from "../shell/shell";
import { go, usePage } from "./route";
import { setPanel, usePanel } from "./panels";
import { nextPage, rotateView, SCROLL, setDark, setScale, setScroll, setSpread, SPREAD, useView, zoom } from "./viewer";

interface Btn {
  id: string;
  label: string;
  Icon: IconType;
  run: () => void;
  big?: boolean;
  on?: boolean;
  off?: boolean;
  tip?: string;
}
interface Group {
  label: string;
  items: Btn[];
}
type RibbonTab = "view" | "pages" | "sign" | "convert";
const TABS: { id: RibbonTab; label: string }[] = [
  { id: "view", label: "View" },
  { id: "pages", label: "Pages" },
  { id: "sign", label: "Fill & Sign" },
  { id: "convert", label: "Convert" },
];

/** Which ribbon tab belongs to a tool page (so the right one is shown). */
const TAB_OF: Partial<Record<Page, RibbonTab>> = {
  organize: "pages",
  split: "pages",
  merge: "pages",
  compress: "pages",
  sign: "sign",
  convert: "convert",
  ocr: "convert",
};

export function Ribbon() {
  const doc = useDoc();
  const page = usePage();
  const view = useView();
  const panel = usePanel();
  const [chosen, setChosen] = useState<RibbonTab>("view");
  const [lastPage, setLastPage] = useState(page);
  // Opening a tool from elsewhere (menu, Home) shows its ribbon tab.
  if (page !== lastPage) {
    setLastPage(page);
    const t = TAB_OF[page];
    if (t && t !== chosen) setChosen(t);
  }
  const reading = page === "view";
  const tool = (p: Page) => () => go(page === p ? "view" : p);

  const groups: Record<RibbonTab, Group[]> = {
    view: [
      {
        label: "Pages",
        items: [
          { id: "prev", label: "Previous", Icon: ChevronLeftIcon, run: () => nextPage(-1), off: !reading || view.page <= 1, tip: "Previous page (Page Up)" },
          { id: "next", label: "Next", Icon: ChevronRightIcon, run: () => nextPage(1), off: !reading || view.page >= view.pages, tip: "Next page (Page Down)" },
        ],
      },
      {
        label: "Zoom",
        items: [
          { id: "zoom-out", label: "Zoom out", Icon: ZoomOutIcon, run: () => zoom(-1), off: !reading, tip: "Zoom out (Ctrl+-)" },
          { id: "zoom-in", label: "Zoom in", Icon: ZoomInIcon, run: () => zoom(1), off: !reading, tip: "Zoom in (Ctrl+=)" },
          { id: "fit-width", label: "Fit width", Icon: FitWidthIcon, run: () => setScale("page-width"), on: view.preset === "page-width", off: !reading },
          { id: "fit-page", label: "Fit page", Icon: FitPageIcon, run: () => setScale("page-fit"), on: view.preset === "page-fit", off: !reading },
          { id: "actual", label: "Actual size", Icon: ActualSizeIcon, run: () => setScale("page-actual"), on: view.preset === "page-actual", off: !reading },
        ],
      },
      {
        label: "Layout",
        items: [
          {
            id: "single",
            label: "Single page",
            Icon: SinglePageIcon,
            run: () => (setSpread(SPREAD.none), setScroll(SCROLL.vertical)),
            on: view.spread === SPREAD.none && view.scroll === SCROLL.vertical,
            off: !reading,
          },
          {
            id: "two",
            label: "Two pages",
            Icon: TwoPagesIcon,
            run: () => (setSpread(SPREAD.odd), setScroll(SCROLL.vertical)),
            on: view.spread !== SPREAD.none,
            off: !reading,
          },
          {
            id: "page-by-page",
            label: "Page by page",
            Icon: ScrollIcon,
            run: () => setScroll(view.scroll === SCROLL.page ? SCROLL.vertical : SCROLL.page),
            on: view.scroll === SCROLL.page,
            off: !reading,
          },
          { id: "rot-left", label: "Rotate left", Icon: RotateLeftIcon, run: () => rotateView(-1), off: !reading, tip: "Turn the view (the file is not changed)" },
          { id: "rot-right", label: "Rotate right", Icon: RotateIcon, run: () => rotateView(1), off: !reading, tip: "Turn the view (the file is not changed)" },
        ],
      },
      {
        label: "Show",
        items: [
          { id: "panel", label: "Side panel", Icon: PanelLeftIcon, run: () => setPanel(panel ? null : "pages"), on: panel !== null, off: !reading, tip: "Pages, bookmarks and search (F4)" },
          { id: "find", label: "Find", Icon: SearchIcon, run: () => setPanel("search"), on: panel === "search", off: !reading, tip: "Find text (Ctrl+F)" },
          { id: "dark", label: "Reading mode", Icon: MoonIcon, run: () => setDark(!view.dark), on: view.dark, off: !reading, tip: "Light text on dark pages, easier at night" },
          { id: "full", label: "Full screen", Icon: FullScreenIcon, run: () => void toggleFullscreen(), tip: "Full screen (F11)" },
        ],
      },
    ],
    pages: [
      {
        label: "Arrange",
        items: [
          { id: "organize", label: "Organize pages", Icon: OrganizeIcon, run: tool("organize"), big: true, on: page === "organize", tip: "Reorder, rotate, delete, insert and extract pages" },
          { id: "extract", label: "Extract pages", Icon: ExtractIcon, run: () => go("organize"), tip: "Select pages in Organize, then Extract" },
        ],
      },
      {
        label: "Files",
        items: [
          { id: "split", label: "Split", Icon: SplitIcon, run: tool("split"), big: true, on: page === "split", tip: "Split into several PDFs" },
          { id: "merge", label: "Merge", Icon: MergeIcon, run: tool("merge"), big: true, on: page === "merge", tip: "Join this PDF with others" },
          { id: "compress", label: "Compress", Icon: CompressIcon, run: tool("compress"), big: true, on: page === "compress", tip: "Make the file smaller" },
        ],
      },
    ],
    sign: [
      {
        label: "Fill & Sign",
        items: [{ id: "sign", label: "Fill & Sign", Icon: SignIcon, run: tool("sign"), big: true, on: page === "sign", tip: "Fill in forms, add text, dates, ticks and your signature" }],
      },
    ],
    convert: [
      {
        label: "Export",
        items: [{ id: "convert", label: "Convert", Icon: ConvertIcon, run: tool("convert"), big: true, on: page === "convert", tip: "To Word, Excel, text or images; Office files and images to PDF" }],
      },
      {
        label: "Scans",
        items: [{ id: "ocr", label: "Recognise text", Icon: OcrIcon, run: tool("ocr"), big: true, on: page === "ocr", tip: "OCR: make scanned pages searchable" }],
      },
    ],
  };

  if (!doc) return null;
  return (
    <div className="ribbon">
      <div className="ribbon-tabs" role="tablist" aria-label="Tools">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={chosen === t.id} className={chosen === t.id ? "ribbon-tab active" : "ribbon-tab"} onClick={() => setChosen(t.id)}>
            {t.label}
          </button>
        ))}
        <div className="ribbon-tabs-end">
          <button className="ribbon-quick" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!canUndo()} onClick={() => void undo()}>
            <UndoIcon size={15} />
          </button>
          {doc.dirty && (
            <button className="ribbon-quick text" title="Save over the original file (Ctrl+Shift+S)" onClick={() => void saveOver()}>
              Save
            </button>
          )}
          <button className="ribbon-quick text primary" title="Save as a new file (Ctrl+S)" onClick={() => void saveAs()}>
            <SaveIcon size={14} /> Save as…
          </button>
        </div>
      </div>
      <div className="ribbon-body" role="toolbar" aria-label={TABS.find((t) => t.id === chosen)?.label}>
        {groups[chosen].map((g) => (
          <div className="ribbon-group" key={g.label}>
            <div className="ribbon-items">
              {g.items.map((b) => (
                <button
                  key={b.id}
                  className={`ribbon-btn${b.big ? " big" : ""}${b.on ? " on" : ""}`}
                  disabled={b.off}
                  title={b.tip ?? b.label}
                  aria-pressed={b.on}
                  onClick={b.run}
                >
                  <b.Icon size={b.big ? 22 : 18} />
                  <span>{b.label}</span>
                </button>
              ))}
            </div>
            <div className="ribbon-group-label">{g.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
