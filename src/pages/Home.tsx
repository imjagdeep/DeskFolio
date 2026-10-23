import {
  BatchIcon,
  InboxIcon,
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
import type { Page } from "../workspace/pages";
import { activate, forgetRecent, openDialog, openPath, useRecent, useTabs } from "../lib/doc";
import { fileName, parentDir } from "../lib/format";
import { dismissNews, newsText, openAgreement, useAgreementNews } from "../lib/sign/watch";

type Tile = { page: Page; title: string; text: string; Icon: IconType; needsDoc?: boolean };
const TILES: Tile[] = [
  { page: "sign", title: "Fill & Sign", text: "Fill forms, sign, add text", Icon: SignIcon, needsDoc: true },
  { page: "organize", title: "Organize pages", text: "Reorder, rotate, delete, insert", Icon: OrganizeIcon, needsDoc: true },
  { page: "merge", title: "Merge", text: "Join PDFs into one", Icon: MergeIcon },
  { page: "split", title: "Split", text: "By ranges or every N pages", Icon: SplitIcon },
  { page: "compress", title: "Compress", text: "Make a PDF smaller", Icon: CompressIcon },
  { page: "convert", title: "Convert", text: "To and from Word, Excel, images", Icon: ConvertIcon },
  { page: "ocr", title: "Recognise text", text: "Make scans searchable (OCR)", Icon: OcrIcon },
  { page: "batch", title: "Batch", text: "Same steps on many PDFs", Icon: BatchIcon },
  { page: "agreements", title: "Agreements", text: "Sent for signature: status, signed copies", Icon: InboxIcon },
];

/** The Home tab: open files, start a tool, pick up where you left off. */
export function Home({ onNavigate }: { onNavigate: (p: Page) => void; onOpened: () => void }) {
  const recent = useRecent();
  const { docs } = useTabs();
  const news = useAgreementNews();

  // Tools that work on a document ask for one first, then open in its tab.
  const startTool = async (t: Tile) => {
    if (t.needsDoc && !(await openDialog())) return;
    onNavigate(t.page);
  };

  return (
    <div className="page home-page">
      <section className="home-hero">
        <div>
          <h1>Your PDFs, on your computer.</h1>
          <p className="muted">Read, sign, organize, compress and convert. Nothing is uploaded.</p>
        </div>
        <button className="dropzone" onClick={() => void openDialog()}>
          <span className="dropzone-icon">
            <DropIcon size={26} />
          </span>
          <strong>Open PDFs</strong>
          <span className="muted small">or drop them anywhere on this window · Ctrl+O</span>
        </button>
      </section>

      {news.length > 0 && (
        <section className="card home-news" aria-label="Agreements news">
          <div className="home-news-head">
            <InboxIcon size={18} />
            <strong>Agreements</strong>
            <button className="link" onClick={() => dismissNews()}>
              Dismiss all
            </button>
          </div>
          <ul>
            {news.map((n) => (
              <li key={n.id} className={`home-news-item ${n.kind}`}>
                <span>{newsText(n)}</span>
                <span className="home-news-actions">
                  <button
                    className={n.kind === "completed" ? "primary" : undefined}
                    onClick={() => {
                      openAgreement(n.id);
                      onNavigate("agreements");
                    }}
                  >
                    {n.kind === "completed" ? "Get the signed copy" : "See it"}
                  </button>
                  <button className="link" onClick={() => dismissNews(n.id)} aria-label={`Dismiss: ${n.title}`}>
                    Dismiss
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <h3>Tools</h3>
      <div className="tool-tiles">
        {TILES.map((t) => (
          <button key={t.page} className="tool-tile" onClick={() => void startTool(t)} title={t.needsDoc ? "Choose a PDF, then the tool opens" : undefined}>
            <span className="tool-tile-icon">
              <t.Icon size={20} />
            </span>
            <span className="tool-tile-text">
              <strong>{t.title}</strong>
              <span className="muted small">{t.text}</span>
            </span>
          </button>
        ))}
      </div>

      {docs.length > 0 && (
        <>
          <h3>Open now</h3>
          <div className="card list">
            {docs.map((d) => (
              <div className="list-row recent-row" key={d.id}>
                <FileIcon size={16} />
                <button className="recent-open" title={d.path} onClick={() => activate(d.id)}>
                  <span className="ellipsis">
                    {d.name}
                    {d.dirty && <span className="badge warn">edited</span>}
                  </span>
                  <span className="muted small ellipsis">
                    {d.pages} page{d.pages === 1 ? "" : "s"} · {parentDir(d.path)}
                  </span>
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {recent.length > 0 && (
        <>
          <h3>Recent</h3>
          <div className="card list">
            {recent.map((p) => (
              <div className="list-row recent-row" key={p}>
                <FileIcon size={16} />
                <button className="recent-open" title={p} onClick={() => void openPath(p)}>
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
