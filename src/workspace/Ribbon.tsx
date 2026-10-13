// The ribbon under the tabs, Acrobat/Office style: tool tabs (View, Comment,
// Pages, Fill & Sign, Convert), each a row of labelled buttons in groups.
// Save and Undo stay at the right end whatever the tab.

import { useState } from "react";
import {
  ActualSizeIcon,
  ImageEditIcon,
  LinkIcon,
  TextEditIcon,
  EraserIcon,
  LockIcon,
  RedactIcon,
  BlankPageIcon,
  CropIcon,
  HeaderFooterIcon,
  InfoIcon,
  WatermarkIcon,
  ArrowIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CompareIcon,
  CompressIcon,
  ConvertIcon,
  CursorIcon,
  EllipseIcon,
  ExtractIcon,
  FitPageIcon,
  FitWidthIcon,
  FullScreenIcon,
  HighlightIcon,
  ImageIcon,
  LineIcon,
  MergeIcon,
  MoonIcon,
  NoteIcon,
  OcrIcon,
  OrganizeIcon,
  PanelLeftIcon,
  PrintIcon,
  PenIcon,
  RectIcon,
  RedoIcon,
  RotateIcon,
  RotateLeftIcon,
  SaveIcon,
  ScrollIcon,
  SearchIcon,
  SendIcon,
  InboxIcon,
  SignIcon,
  SinglePageIcon,
  SplitIcon,
  StampIcon,
  StrikeIcon,
  TextBoxIcon,
  TrashIcon,
  TwoPagesIcon,
  UnderlineIcon,
  UndoIcon,
  ZoomInIcon,
  ZoomOutIcon,
  type IconType,
} from "../components/Icons";
import { applyEdit, canUndo, currentDoc, saveAs, saveOver, undo, useDoc } from "../lib/doc";
import { insertBlank } from "../lib/pdf/pagetools";
import { toastError } from "../lib/store";
import { STAMPS } from "../lib/pdf/markup";
import { toggleFullscreen } from "../shell/shell";
import { clearOwnTool, HEX_RGB, RGB_HEX, setMarkup, setOwnTool, useMarkup, type OwnTool } from "./markup";
import type { Page } from "./pages";
import { setPanel, usePanel } from "./panels";
import { printDocument } from "./print";
import { go, usePage } from "./route";
import {
  commitMarks,
  EDIT,
  editAction,
  HIGHLIGHT_COLORS,
  nextPage,
  PARAM,
  rotateView,
  SCROLL,
  setDark,
  setEditMode,
  setEditorParam,
  setScale,
  setScroll,
  setSpread,
  SPREAD,
  useView,
  viewPage,
  zoom,
} from "./viewer";

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
  /** Controls that aren't buttons (colours, sizes). */
  extra?: React.ReactNode;
}
type RibbonTab = "view" | "comment" | "edit" | "pages" | "protect" | "sign" | "convert";
const TABS: { id: RibbonTab; label: string }[] = [
  { id: "view", label: "View" },
  { id: "comment", label: "Comment" },
  { id: "edit", label: "Edit" },
  { id: "pages", label: "Pages" },
  { id: "protect", label: "Protect" },
  { id: "sign", label: "Fill & Sign" },
  { id: "convert", label: "Convert" },
];

/** Which ribbon tab belongs to a tool page (so the right one is shown). */
const TAB_OF: Partial<Record<Page, RibbonTab>> = {
  organize: "pages",
  watermark: "pages",
  headerfooter: "pages",
  crop: "pages",
  properties: "pages",
  compare: "pages",
  protect: "protect",
  split: "pages",
  merge: "pages",
  compress: "pages",
  sign: "sign",
  convert: "convert",
  ocr: "convert",
};

/** Ink and text colours offered (highlights have their own palette). */
const PALETTE = ["#dc2626", "#ea580c", "#eab308", "#16a34a", "#2563eb", "#7c3aed", "#111111"];
const HIGHLIGHTS = HIGHLIGHT_COLORS.split(",").map((p) => {
  const [name, hex] = p.split("=");
  return { name, hex };
});
const WIDTHS = [1, 2, 3, 5, 8];
const TEXT_SIZES = [8, 10, 12, 14, 18, 24, 32];

/** Insert a blank page after the page on screen. */
async function addBlank() {
  const d = currentDoc();
  if (!d) return;
  try {
    const at = Math.min(d.pages, viewPage());
    await applyEdit(await insertBlank(d.bytes, at, 1, { password: d.password }), `Blank page after page ${at}`);
  } catch (e) {
    toastError(e);
  }
}

export function Ribbon() {
  const doc = useDoc();
  const page = usePage();
  const view = useView();
  const panel = usePanel();
  const markup = useMarkup();
  const [chosen, setChosen] = useState<RibbonTab>("view");
  const [lastPage, setLastPage] = useState(page);
  const [hl, setHl] = useState(HIGHLIGHTS[0].hex);
  const [textSize, setTextSize] = useState(12);
  // Opening a tool from elsewhere (menu, Home) shows its ribbon tab.
  if (page !== lastPage) {
    setLastPage(page);
    const t = TAB_OF[page];
    if (t && t !== chosen) setChosen(t);
  }
  const reading = page === "view";
  const tool = (p: Page) => () => go(page === p ? "view" : p);

  // pdf.js tools: switch ours off, then hand it the current colour/size.
  const pdfTool = (mode: number) => () => {
    clearOwnTool();
    const turningOn = view.mode !== mode;
    setEditMode(mode);
    if (!turningOn) return;
    window.setTimeout(() => {
      const hex = RGB_HEX(markup.color);
      if (mode === EDIT.highlight) setEditorParam(PARAM.HIGHLIGHT_COLOR, hl);
      if (mode === EDIT.draw) {
        setEditorParam(PARAM.INK_COLOR, hex);
        setEditorParam(PARAM.INK_THICKNESS, markup.width);
      }
      if (mode === EDIT.text) {
        setEditorParam(PARAM.FREETEXT_COLOR, hex);
        setEditorParam(PARAM.FREETEXT_SIZE, textSize);
      }
    }, 60);
  };
  const ownTool = (t: OwnTool) => () => setOwnTool(t);
  const isOwn = (t: OwnTool) => markup.tool === t;
  const pdfOn = (mode: number) => view.mode === mode && !markup.tool;

  // A colour pick goes to whichever tool is active (and the selected mark).
  const pickColor = (hex: string) => {
    setMarkup({ color: HEX_RGB(hex) });
    if (view.mode === EDIT.draw) setEditorParam(PARAM.INK_COLOR, hex);
    if (view.mode === EDIT.text) setEditorParam(PARAM.FREETEXT_COLOR, hex);
  };
  const pickWidth = (w: number) => {
    setMarkup({ width: w });
    if (view.mode === EDIT.draw) setEditorParam(PARAM.INK_THICKNESS, w);
  };

  const styleControls = (() => {
    if (view.mode === EDIT.highlight && !markup.tool) {
      return (
        <div className="swatches" role="radiogroup" aria-label="Highlight colour">
          {HIGHLIGHTS.map((h) => (
            <button
              key={h.hex}
              role="radio"
              aria-checked={hl === h.hex}
              aria-label={h.name}
              title={h.name}
              className={hl === h.hex ? "swatch on" : "swatch"}
              style={{ background: h.hex }}
              onClick={() => {
                setHl(h.hex);
                setEditorParam(PARAM.HIGHLIGHT_COLOR, h.hex);
              }}
            />
          ))}
        </div>
      );
    }
    const current = RGB_HEX(markup.color);
    return (
      <div className="style-controls">
        <div className="swatches" role="radiogroup" aria-label="Colour">
          {PALETTE.map((hex) => (
            <button key={hex} role="radio" aria-checked={current === hex} aria-label={hex} className={current === hex ? "swatch on" : "swatch"} style={{ background: hex }} onClick={() => pickColor(hex)} />
          ))}
          <label className="swatch custom" title="Other colour">
            <input type="color" value={current} aria-label="Other colour" onChange={(e) => pickColor(e.target.value)} />
          </label>
        </div>
        {view.mode === EDIT.text && !markup.tool ? (
          <label className="style-field">
            Size
            <select
              value={textSize}
              onChange={(e) => {
                const v = Number(e.target.value);
                setTextSize(v);
                setEditorParam(PARAM.FREETEXT_SIZE, v);
              }}
            >
              {TEXT_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s} pt
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="style-field">
            Line
            <select value={markup.width} onChange={(e) => pickWidth(Number(e.target.value))}>
              {WIDTHS.map((w) => (
                <option key={w} value={w}>
                  {w} pt
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    );
  })();

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
          { id: "fit-width", label: "Fit width", Icon: FitWidthIcon, run: () => setScale("page-width"), on: view.preset === "page-width", off: !reading, tip: "Fit width (Ctrl+0)" },
          { id: "fit-page", label: "Fit page", Icon: FitPageIcon, run: () => setScale("page-fit"), on: view.preset === "page-fit", off: !reading, tip: "Fit page (Ctrl+2)" },
          { id: "actual", label: "Actual size", Icon: ActualSizeIcon, run: () => setScale("page-actual"), on: view.preset === "page-actual", off: !reading, tip: "Actual size (Ctrl+1)" },
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
          { id: "panel", label: "Side panel", Icon: PanelLeftIcon, run: () => setPanel(panel ? null : "pages"), on: panel !== null, off: !reading, tip: "Pages, bookmarks, comments and search (F4)" },
          { id: "find", label: "Find", Icon: SearchIcon, run: () => setPanel("search"), on: panel === "search", off: !reading, tip: "Find text (Ctrl+F)" },
          { id: "dark", label: "Reading mode", Icon: MoonIcon, run: () => setDark(!view.dark), on: view.dark, off: !reading, tip: "Light text on dark pages, easier at night" },
          { id: "full", label: "Full screen", Icon: FullScreenIcon, run: () => void toggleFullscreen(), tip: "Full screen (F11)" },
          { id: "print", label: "Print", Icon: PrintIcon, run: () => { if (doc) void printDocument(doc); }, tip: "Print (Ctrl+P)" },
        ],
      },
    ],
    comment: [
      {
        label: "Mark up",
        items: [
          { id: "select", label: "Select", Icon: CursorIcon, run: () => (clearOwnTool(), setEditMode(EDIT.none)), on: view.mode === EDIT.none && !markup.tool, off: !reading, tip: "Read and select text; click a mark to change it" },
          { id: "highlight", label: "Highlight", Icon: HighlightIcon, run: pdfTool(EDIT.highlight), on: pdfOn(EDIT.highlight), off: !reading, tip: "Select text to highlight it, or drag anywhere" },
          { id: "underline", label: "Underline", Icon: UnderlineIcon, run: ownTool("underline"), on: isOwn("underline"), off: !reading, tip: "Select text to underline it" },
          { id: "strike", label: "Strike out", Icon: StrikeIcon, run: ownTool("strikeout"), on: isOwn("strikeout"), off: !reading, tip: "Select text to cross it out" },
        ],
      },
      {
        label: "Add",
        items: [
          { id: "note", label: "Sticky note", Icon: NoteIcon, run: ownTool("note"), on: isOwn("note"), off: !reading, tip: "Click where the note goes" },
          { id: "textbox", label: "Text box", Icon: TextBoxIcon, run: pdfTool(EDIT.text), on: pdfOn(EDIT.text), off: !reading, tip: "Click and type" },
          { id: "draw", label: "Draw", Icon: PenIcon, run: pdfTool(EDIT.draw), on: pdfOn(EDIT.draw), off: !reading, tip: "Draw freehand" },
          { id: "image", label: "Image", Icon: ImageIcon, run: pdfTool(EDIT.image), on: pdfOn(EDIT.image), off: !reading, tip: "Add a picture to the page" },
        ],
      },
      {
        label: "Shapes",
        items: [
          { id: "rect", label: "Rectangle", Icon: RectIcon, run: ownTool("square"), on: isOwn("square"), off: !reading },
          { id: "ellipse", label: "Ellipse", Icon: EllipseIcon, run: ownTool("circle"), on: isOwn("circle"), off: !reading },
          { id: "line", label: "Line", Icon: LineIcon, run: ownTool("line"), on: isOwn("line"), off: !reading },
          { id: "arrow", label: "Arrow", Icon: ArrowIcon, run: ownTool("arrow"), on: isOwn("arrow"), off: !reading },
        ],
      },
      {
        label: "Stamp",
        items: [{ id: "stamp", label: "Stamp", Icon: StampIcon, run: ownTool("stamp"), on: isOwn("stamp"), off: !reading, tip: "Choose a stamp, then click the page" }],
        extra: (
          <div className="style-controls stamp-controls">
            <select aria-label="Stamp" value={markup.stamp} onChange={(e) => {
                setMarkup({ stamp: Number(e.target.value) });
                if (markup.tool !== "stamp") setOwnTool("stamp");
              }}>
              {STAMPS.map((s, i) => (
                <option key={s.label} value={i}>
                  {s.label}
                </option>
              ))}
            </select>
            <label className="style-field">
              <input type="checkbox" checked={markup.stampDate} onChange={(e) => setMarkup({ stampDate: e.target.checked })} /> Date
            </label>
          </div>
        ),
      },
      { label: "Style", items: [], extra: styleControls },
      {
        label: "Marks",
        items: [
          { id: "mark-undo", label: "Undo", Icon: UndoIcon, run: () => editAction("undo"), off: !reading || !view.marks.canUndo, tip: "Undo the last mark (Ctrl+Z)" },
          { id: "mark-redo", label: "Redo", Icon: RedoIcon, run: () => editAction("redo"), off: !reading || !view.marks.canRedo, tip: "Redo (Ctrl+Y)" },
          { id: "mark-delete", label: "Delete", Icon: TrashIcon, run: () => editAction("delete"), off: !reading || !view.marks.selected, tip: "Delete the selected mark (Delete)" },
          {
            id: "mark-done",
            label: "Done",
            Icon: CheckIcon,
            run: () => void commitMarks().then(() => (clearOwnTool(), setEditMode(EDIT.none))),
            off: !reading || (!view.pendingMarks && view.mode === EDIT.none && !markup.tool),
            tip: "Put the marks into the document (they can still be undone)",
          },
        ],
      },
    ],
    edit: [
      {
        label: "Text",
        items: [
          { id: "edit-text", label: "Edit text", Icon: TextEditIcon, run: ownTool("edittext"), on: isOwn("edittext"), off: !reading, big: true, tip: "Click a line to change its words" },
          { id: "add-text", label: "Add text", Icon: TextBoxIcon, run: pdfTool(EDIT.text), on: pdfOn(EDIT.text), off: !reading, tip: "Click anywhere and type" },
        ],
      },
      {
        label: "Images",
        items: [
          { id: "edit-image", label: "Edit images", Icon: ImageEditIcon, run: ownTool("editimage"), on: isOwn("editimage"), off: !reading, big: true, tip: "Click an image to move, resize, replace or delete it" },
          { id: "add-image", label: "Add image", Icon: ImageIcon, run: pdfTool(EDIT.image), on: pdfOn(EDIT.image), off: !reading, tip: "Put a picture on the page" },
        ],
      },
      {
        label: "Links",
        items: [{ id: "link", label: "Link", Icon: LinkIcon, run: ownTool("link"), on: isOwn("link"), off: !reading, big: true, tip: "Drag an area to link it; click a link to remove it" }],
      },
      { label: "Style", items: [], extra: markup.tool === null && view.mode === EDIT.text ? styleControls : null },
    ],
    pages: [
      {
        label: "Arrange",
        items: [
          { id: "organize", label: "Organize pages", Icon: OrganizeIcon, run: tool("organize"), big: true, on: page === "organize", tip: "Reorder, rotate, delete, insert and extract pages" },
          { id: "blank", label: "Blank page", Icon: BlankPageIcon, run: () => void addBlank(), off: !reading, tip: "Insert a blank page after this one" },
          { id: "extract", label: "Extract pages", Icon: ExtractIcon, run: () => go("organize"), tip: "Select pages in Organize, then Extract" },
        ],
      },
      {
        label: "Page marks",
        items: [
          { id: "watermark", label: "Watermark", Icon: WatermarkIcon, run: tool("watermark"), on: page === "watermark", tip: "DRAFT, CONFIDENTIAL or a picture across pages" },
          { id: "headerfooter", label: "Header & footer", Icon: HeaderFooterIcon, run: tool("headerfooter"), on: page === "headerfooter", tip: "Page numbers, dates, Bates numbers" },
          { id: "crop", label: "Crop", Icon: CropIcon, run: tool("crop"), on: page === "crop", tip: "Trim page edges" },
        ],
      },
      {
        label: "Document",
        items: [
          { id: "properties", label: "Properties", Icon: InfoIcon, run: tool("properties"), on: page === "properties", tip: "Title, author, keywords" },
          { id: "compare", label: "Compare", Icon: CompareIcon, run: tool("compare"), on: page === "compare", tip: "What changed between two versions" },
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
    protect: [
      {
        label: "Redact",
        items: [
          { id: "redact-mark", label: "Mark area", Icon: RedactIcon, run: () => (setOwnTool("redact"), setPanel("redact")), on: isOwn("redact"), off: !reading, tip: "Drag over what must go" },
          { id: "redact-find", label: "Find & redact", Icon: SearchIcon, run: () => setPanel("redact"), on: panel === "redact", off: !reading, tip: "Words, emails, phone and card numbers" },
        ],
      },
      {
        label: "Security",
        items: [
          { id: "protect", label: "Password & permissions", Icon: LockIcon, run: tool("protect"), big: true, on: page === "protect", tip: "Ask for a password to open; limit printing, copying, editing" },
          { id: "clean", label: "Remove hidden info", Icon: EraserIcon, run: tool("protect"), tip: "Metadata, attached files, scripts, comments" },
        ],
      },
    ],
    sign: [
      {
        label: "Fill & Sign",
        items: [{ id: "sign", label: "Fill & Sign", Icon: SignIcon, run: tool("sign"), big: true, on: page === "sign", tip: "Fill in forms, add text, dates, ticks and your signature" }],
      },
      {
        label: "Send for signature",
        items: [
          { id: "request", label: "Request signatures", Icon: SendIcon, run: tool("request"), big: true, on: page === "request", tip: "Send this PDF to people to sign in their browser" },
          { id: "agreements", label: "Agreements", Icon: InboxIcon, run: () => go("agreements"), tip: "Documents you sent: who signed, the signed copies" },
        ],
      },
      {
        label: "Digital signature",
        items: [
          {
            id: "digisign",
            label: "Sign with digital ID",
            Icon: LockIcon,
            run: () => (go("view"), setOwnTool("digisign")),
            on: isOwn("digisign"),
            big: true,
            tip: "Draw the signature box, then sign with your certificate (proves the PDF wasn't changed)",
          },
          { id: "sig-panel", label: "Check signatures", Icon: CheckIcon, run: () => (go("view"), setPanel("signatures")), tip: "See who signed and whether anything changed since" },
          { id: "ids", label: "Digital IDs", Icon: SignIcon, run: () => go("digitalids"), tip: "Create, import or back up the IDs you sign with" },
        ],
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
          {view.pendingMarks && <span className="pending-note" title="Marks are added to the document when you press Done, save, or switch tabs">Unsaved marks</span>}
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
        {groups[chosen].filter((g) => g.items.length || g.extra).map((g) => (
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
              {g.extra}
            </div>
            <div className="ribbon-group-label">{g.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
