import { PageHeader } from "../components/Common";
import {
  CompressIcon,
  ConvertIcon,
  DropIcon,
  FileIcon,
  MergeIcon,
  OcrIcon,
  OrganizeIcon,
  SignIcon,
  SplitIcon,
  type IconType,
} from "../components/Icons";
import type { Page } from "../components/Sidebar";
import { forgetRecent, openDialog, openPath, useDoc, useRecent } from "../lib/doc";
import { fileName, parentDir } from "../lib/format";

type Tile = { page: Page; title: string; text: string; Icon: IconType; needsDoc?: boolean };
const TILES: Tile[] = [
  { page: "organize", title: "Organize pages", text: "Reorder, rotate, delete, insert", Icon: OrganizeIcon, needsDoc: true },
  { page: "sign", title: "Fill & Sign", text: "Fill forms, sign, add text", Icon: SignIcon, needsDoc: true },
  { page: "merge", title: "Merge", text: "Join PDFs into one", Icon: MergeIcon },
  { page: "split", title: "Split", text: "By ranges or every N pages", Icon: SplitIcon },
  { page: "compress", title: "Compress", text: "Make a PDF smaller", Icon: CompressIcon },
  { page: "convert", title: "Convert", text: "To and from Word, Excel, images", Icon: ConvertIcon },
  { page: "ocr", title: "OCR", text: "Make scans searchable", Icon: OcrIcon },
];

export function Home({ onNavigate, onOpened }: { onNavigate: (p: Page) => void; onOpened: () => void }) {
  const doc = useDoc();
  const recent = useRecent();

  return (
    <div className="page">
      <PageHeader title="DeskFolio" subtitle="Your PDFs, on your computer. Nothing is uploaded." />

      <button className="dropzone" onClick={() => void openDialog().then((ok) => ok && onOpened())}>
        <span className="dropzone-icon">
          <DropIcon size={26} />
        </span>
        <strong>Open a PDF</strong>
        <span className="muted small">or drop one anywhere on this window · Ctrl+O</span>
      </button>

      {doc && (
        <div className="card current-doc">
          <FileIcon size={20} />
          <div className="grow">
            <div className="ellipsis">
              <strong>{doc.name}</strong>
              {doc.dirty && <span className="badge warn">edited</span>}
            </div>
            <div className="muted small">
              {doc.pages} page{doc.pages === 1 ? "" : "s"} · open now
            </div>
          </div>
          <button className="primary" onClick={() => onNavigate("view")}>
            View
          </button>
        </div>
      )}

      <h3>Tools</h3>
      <div className="tool-tiles">
        {TILES.map(({ page, title, text, Icon, needsDoc }) => (
          <button
            key={page}
            className="tool-tile"
            disabled={needsDoc && !doc}
            title={needsDoc && !doc ? "Open a PDF first" : undefined}
            onClick={() => onNavigate(page)}
          >
            <span className="tool-tile-icon">
              <Icon size={20} />
            </span>
            <span className="tool-tile-text">
              <strong>{title}</strong>
              <span className="muted small">{text}</span>
            </span>
          </button>
        ))}
      </div>

      {recent.length > 0 && (
        <>
          <h3>Recent</h3>
          <div className="card list">
            {recent.map((p) => (
              <div className="list-row recent-row" key={p}>
                <FileIcon size={16} />
                <button className="recent-open" title={p} onClick={() => void openPath(p).then((ok) => ok && onOpened())}>
                  <span className="ellipsis">{fileName(p)}</span>
                  <span className="muted small ellipsis">{parentDir(p)}</span>
                </button>
                <button className="link" onClick={() => forgetRecent(p)} title="Remove from this list">
                  Remove
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
