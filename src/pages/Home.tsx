import { useState } from "react";
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
  SendIcon,
  SignIcon,
  SplitIcon,
  type IconType,
} from "../components/Icons";
import type { Page } from "../workspace/pages";
import { activate, forgetRecent, openDialog, openPath, useRecent, useTabs } from "../lib/doc";
import { fileName, parentDir } from "../lib/format";
import { dismissNews, newsText, openAgreement, useAgreementNews } from "../lib/sign/watch";

type Group = "pages" | "sign" | "files";
type Tile = { page: Page; title: string; text: string; Icon: IconType; group: Group; needsDoc?: boolean };
const TILES: Tile[] = [
  { page: "sign", title: "Fill & Sign", text: "Fill forms, sign, add text", Icon: SignIcon, group: "sign", needsDoc: true },
  { page: "organize", title: "Organize pages", text: "Reorder, rotate, delete, insert", Icon: OrganizeIcon, group: "pages", needsDoc: true },
  { page: "merge", title: "Merge", text: "Join PDFs into one", Icon: MergeIcon, group: "pages" },
  { page: "split", title: "Split", text: "By ranges or every N pages", Icon: SplitIcon, group: "pages" },
  { page: "compress", title: "Compress", text: "Make a PDF smaller", Icon: CompressIcon, group: "files" },
  { page: "convert", title: "Convert", text: "To and from Word, Excel, images", Icon: ConvertIcon, group: "files" },
  { page: "ocr", title: "Recognise text", text: "Make scans searchable (OCR)", Icon: OcrIcon, group: "files" },
  { page: "batch", title: "Batch", text: "Same steps on many PDFs", Icon: BatchIcon, group: "files" },
  { page: "request", title: "Request signatures", text: "Send a PDF to people to sign", Icon: SendIcon, group: "sign", needsDoc: true },
  { page: "agreements", title: "Agreements", text: "Sent for signature: status, signed copies", Icon: InboxIcon, group: "sign" },
];
const GROUPS: { id: Group | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pages", label: "Pages" },
  { id: "sign", label: "Sign" },
  { id: "files", label: "Files" },
];

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** The Home tab: open files, start a tool, pick up where you left off. */
export function Home({ onNavigate }: { onNavigate: (p: Page) => void; onOpened: () => void }) {
  const recent = useRecent();
  const { docs } = useTabs();
  const news = useAgreementNews();
  const [group, setGroup] = useState<Group | "all">("all");

  // Tools that work on a document ask for one first, then open in its tab.
  const startTool = async (t: Tile) => {
    if (t.needsDoc && !(await openDialog())) return;
    onNavigate(t.page);
  };
  const latest = news[news.length - 1];
  const tiles = group === "all" ? TILES : TILES.filter((t) => t.group === group);

  return (
    <div className="page home-page">
      <header className="home-head">
        <div>
          <p className="muted">{greeting()}</p>
          <h1>Your PDFs, on your computer.</h1>
        </div>
        <button className="primary big" onClick={() => void openDialog()}>
          Open PDFs
        </button>
      </header>

      <div className="home-cards">
        <button className="home-drop" onClick={() => void openDialog()}>
          <span className="home-drop-icon">
            <DropIcon size={22} />
          </span>
          <strong>Drop PDFs here</strong>
          <span className="home-drop-hint">or anywhere on this window · Ctrl+O</span>
        </button>

        <section className="home-news" aria-label="Agreements news">
          <div className="home-news-head">
            <span>Agreements</span>
            {news.length > 0 && <span className="home-news-count">{news.length} new</span>}
          </div>
          {latest ? (
            <>
              <p className="home-news-text">{newsText(latest)}</p>
              <div className="home-news-actions">
                <button
                  className={latest.kind === "completed" ? "primary" : undefined}
                  onClick={() => {
                    openAgreement(latest.id);
                    onNavigate("agreements");
                  }}
                >
                  {latest.kind === "completed" ? "Get the signed copy" : "See it"}
                </button>
                <button className="ghost" onClick={() => dismissNews()}>
                  {news.length > 1 ? "Dismiss all" : "Dismiss"}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="home-news-text">Send a PDF for signature. You'll see here when people sign.</p>
              <div className="home-news-actions">
                <button onClick={() => onNavigate("agreements")}>Open Agreements</button>
              </div>
            </>
          )}
        </section>

        <section className="home-open" aria-label="Open now">
          <span className="home-open-title">Open now</span>
          {docs.length ? (
            docs.slice(0, 3).map((d) => (
              <button key={d.id} className="home-open-row" title={d.path} onClick={() => activate(d.id)}>
                <span className="ellipsis">{d.name}</span>
                {d.dirty ? (
                  <span className="home-open-edited">edited</span>
                ) : (
                  <span className="muted small">
                    {d.pages} page{d.pages === 1 ? "" : "s"}
                  </span>
                )}
              </button>
            ))
          ) : (
            <p className="muted">No PDFs open. Open one, or pick a recent file below.</p>
          )}
          {docs.length > 3 && <span className="muted small">and {docs.length - 3} more in the tabs above</span>}
        </section>
      </div>

      <div className={recent.length ? "home-grid" : "home-grid single"}>
        <section className="card home-tools" aria-label="Tools">
          <div className="card-head">
            <h2>Tools</h2>
            <div className="segmented" role="tablist" aria-label="Show tools">
              {GROUPS.map((g) => (
                <button key={g.id} role="tab" aria-selected={group === g.id} className={group === g.id ? "active" : undefined} onClick={() => setGroup(g.id)}>
                  {g.label}
                </button>
              ))}
            </div>
          </div>
          <div className="tool-tiles">
            {tiles.map((t) => (
              <button key={t.page} className="tool-tile" onClick={() => void startTool(t)} title={t.needsDoc ? "Choose a PDF, then the tool opens" : undefined}>
                <span className="tool-tile-icon">
                  <t.Icon size={18} />
                </span>
                <strong>{t.title}</strong>
                <span className="muted small">{t.text}</span>
              </button>
            ))}
          </div>
        </section>

        {recent.length > 0 && (
          <section className="card home-recent" aria-label="Recent">
            <div className="card-head">
              <h2>Recent</h2>
              <button className="link" onClick={() => recent.forEach(forgetRecent)}>
                Clear list
              </button>
            </div>
            {recent.map((p) => (
              <div className="recent-row" key={p}>
                <button className="recent-open" title={p} onClick={() => void openPath(p)}>
                  <span className="recent-paper" aria-hidden="true">
                    <FileIcon size={16} />
                  </span>
                  <span className="recent-text">
                    <span className="ellipsis">{fileName(p)}</span>
                    <span className="muted small ellipsis">{parentDir(p)}</span>
                  </span>
                </button>
                <button className="link recent-remove" onClick={() => forgetRecent(p)} title="Remove from this list" aria-label={`Remove ${fileName(p)} from this list`}>
                  Remove
                </button>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
