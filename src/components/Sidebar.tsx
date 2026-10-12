import logo from "../assets/logo.png";
import { useDoc } from "../lib/doc";
import { SideNav, type NavGroup } from "../shell/SideNav";
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
} from "./Icons";

export type Page = "home" | "view" | "organize" | "merge" | "split" | "compress" | "sign" | "convert" | "ocr" | "settings";

/** The pages in sidebar order; `needsDoc` ones wait for an open PDF. */
export const PAGES: { page: Page; label: string; group: string; needsDoc?: boolean }[] = [
  { page: "home", label: "Home", group: "Document" },
  { page: "view", label: "View", group: "Document", needsDoc: true },
  { page: "organize", label: "Organize pages", group: "Document", needsDoc: true },
  { page: "sign", label: "Fill & Sign", group: "Document", needsDoc: true },
  { page: "merge", label: "Merge", group: "Tools" },
  { page: "split", label: "Split", group: "Tools" },
  { page: "compress", label: "Compress", group: "Tools" },
  { page: "convert", label: "Convert", group: "Tools" },
  { page: "ocr", label: "OCR", group: "Tools" },
  { page: "settings", label: "Settings", group: "App" },
];

const ICONS: Record<Page, (p: { size?: number }) => React.ReactElement> = {
  home: HomeIcon,
  view: ViewIcon,
  organize: OrganizeIcon,
  sign: SignIcon,
  merge: MergeIcon,
  split: SplitIcon,
  compress: CompressIcon,
  convert: ConvertIcon,
  ocr: OcrIcon,
  settings: SettingsIcon,
};

export function Sidebar({ page, onNavigate }: { page: Page; onNavigate: (p: Page) => void }) {
  const doc = useDoc();
  const groups: NavGroup<Page>[] = [];
  for (const p of PAGES) {
    let g = groups.find((x) => x.title === p.group);
    if (!g) groups.push((g = { title: p.group, items: [] }));
    const off = p.needsDoc && !doc;
    g.items.push({ page: p.page, label: p.label, Icon: ICONS[p.page], disabled: off, hint: off ? "Open a PDF first" : undefined });
  }
  return (
    <SideNav
      appName="DeskFolio"
      logo={logo}
      groups={groups}
      page={page}
      onNavigate={onNavigate}
      footTitle={doc?.path}
      foot={
        <>
          <span className={doc ? (doc.dirty ? "dot paused" : "dot on") : "dot"} />
          <span className="ellipsis">{doc ? `${doc.name}${doc.dirty ? " · edited" : ""}` : "No document open"}</span>
        </>
      }
    />
  );
}
