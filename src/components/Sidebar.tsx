import logo from "../assets/logo.png";
import { useDoc } from "../lib/doc";
import {
  CompressIcon,
  ConvertIcon,
  HomeIcon,
  MergeIcon,
  OcrIcon,
  OrganizeIcon,
  SettingsIcon,
  SignIcon,
  SplitIcon,
  ViewIcon,
  type IconType,
} from "./Icons";

export type Page = "home" | "view" | "organize" | "merge" | "split" | "compress" | "sign" | "convert" | "ocr" | "settings";

type Item = { page: Page; label: string; Icon: IconType; needsDoc?: boolean };

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Document",
    items: [
      { page: "home", label: "Home", Icon: HomeIcon },
      { page: "view", label: "View", Icon: ViewIcon, needsDoc: true },
      { page: "organize", label: "Organize pages", Icon: OrganizeIcon, needsDoc: true },
      { page: "sign", label: "Fill & Sign", Icon: SignIcon, needsDoc: true },
    ],
  },
  {
    title: "Tools",
    items: [
      { page: "merge", label: "Merge", Icon: MergeIcon },
      { page: "split", label: "Split", Icon: SplitIcon },
      { page: "compress", label: "Compress", Icon: CompressIcon },
      { page: "convert", label: "Convert", Icon: ConvertIcon },
      { page: "ocr", label: "OCR", Icon: OcrIcon },
    ],
  },
  {
    title: "App",
    items: [{ page: "settings", label: "Settings", Icon: SettingsIcon }],
  },
];

export function Sidebar({ page, onNavigate }: { page: Page; onNavigate: (p: Page) => void }) {
  const doc = useDoc();
  return (
    <nav className="sidebar">
      <div className="brand">
        <img src={logo} alt="" className="brand-logo" />
        <span>DeskFolio</span>
      </div>
      {GROUPS.map((g) => (
        <div className="nav-group" key={g.title}>
          <div className="nav-title">{g.title}</div>
          {g.items.map(({ page: p, label, Icon, needsDoc }) => (
            <button
              key={p}
              className={page === p ? "nav-item active" : "nav-item"}
              aria-current={page === p ? "page" : undefined}
              disabled={needsDoc && !doc}
              title={needsDoc && !doc ? "Open a PDF first" : undefined}
              onClick={() => onNavigate(p)}
            >
              <Icon size={18} />
              <span className="nav-label">{label}</span>
            </button>
          ))}
        </div>
      ))}
      <div className="sidebar-foot" title={doc?.path}>
        <span className={doc ? (doc.dirty ? "dot paused" : "dot on") : "dot"} />
        <span className="ellipsis">
          {doc ? `${doc.name}${doc.dirty ? " · edited" : ""}` : "No document open"}
        </span>
      </div>
    </nav>
  );
}
