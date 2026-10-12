// One consistent line-icon set (24px grid, 1.8 stroke, currentColor), same
// style as DeskZero and DeskMedic.

type IconProps = { size?: number; className?: string };
export type IconType = (p: IconProps) => React.ReactElement;

function Svg({ size = 18, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 10.5 12 3.8l8.5 6.7" />
    <path d="M5.5 9v10.2a.8.8 0 0 0 .8.8H10v-5.5h4V20h3.7a.8.8 0 0 0 .8-.8V9" />
  </Svg>
);

export const ViewIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 3.5h7l4.5 4.5v12.5H7z" />
    <path d="M14 3.5V8h4.5" />
    <path d="M10 12.5h5.5M10 15.5h5.5" />
  </Svg>
);

export const OrganizeIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="7" height="7" rx="1.6" />
    <rect x="13" y="4" width="7" height="7" rx="1.6" />
    <rect x="4" y="13" width="7" height="7" rx="1.6" />
    <rect x="13" y="13" width="7" height="7" rx="1.6" />
  </Svg>
);

export const MergeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 4v5a4 4 0 0 0 4 4h8" />
    <path d="M6 20v-5a4 4 0 0 1 4-4" />
    <path d="M15 10l3 3-3 3" />
  </Svg>
);

export const SplitIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="6.5" cy="6.5" r="2.5" />
    <circle cx="6.5" cy="17.5" r="2.5" />
    <path d="M8.6 8 20 18M8.6 16 20 6" />
  </Svg>
);

export const CompressIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v6M9 6l3 3 3-3" />
    <path d="M12 21v-6M9 18l3-3 3 3" />
    <path d="M4 12h16" />
  </Svg>
);

export const SignIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.5 4.5 19.5 9.5 9 20H4v-5z" />
    <path d="M12.5 6.5l5 5" />
  </Svg>
);

export const ConvertIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 8h13M14 4.5 17.5 8 14 11.5" />
    <path d="M20 16H7M10 12.5 6.5 16 10 19.5" />
  </Svg>
);

export const OcrIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
    <path d="M8 9.5h8M8 12.5h8M8 15.5h5" />
  </Svg>
);

export const SettingsIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
  </Svg>
);

export const OpenIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 7.5V18a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5V9.5A1.5 1.5 0 0 0 19 8h-7l-2-2.5H5A1.5 1.5 0 0 0 3.5 7z" />
  </Svg>
);

export const DropIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" />
    <path d="M4.5 15.5v3a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-3" />
  </Svg>
);

export const ZoomInIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4M8.5 11h5M11 8.5v5" />
  </Svg>
);

export const ZoomOutIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4M8.5 11h5" />
  </Svg>
);

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </Svg>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m14.5 6-6 6 6 6" />
  </Svg>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9.5 6 6 6-6 6" />
  </Svg>
);

export const RotateIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 12a8 8 0 1 1-2.3-5.6" />
    <path d="M20 4v5h-5" />
  </Svg>
);

export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 7h15M10 11v6M14 11v6" />
    <path d="M6.5 7l.8 11.2A1.5 1.5 0 0 0 8.8 19.5h6.4a1.5 1.5 0 0 0 1.5-1.3L17.5 7M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" />
  </Svg>
);

export const UndoIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Svg>
);

export const SaveIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" />
    <path d="M8 4v5h7V4M8 20v-6h8v6" />
  </Svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const FileIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 3.5h7l4.5 4.5v12.5H7z" />
    <path d="M14 3.5V8h4.5" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

// ---------- workspace (ribbon, panels, status bar) ----------

export const PagesIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="3.5" width="7" height="8" rx="1" />
    <rect x="13" y="3.5" width="7" height="8" rx="1" />
    <rect x="4" y="13.5" width="7" height="7" rx="1" />
    <rect x="13" y="13.5" width="7" height="7" rx="1" />
  </Svg>
);

export const BookmarkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 3.5h11v17l-5.5-4-5.5 4z" />
  </Svg>
);

export const FitWidthIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="1.5" />
    <path d="M7.5 12h9M9.5 9.5 7 12l2.5 2.5M14.5 9.5 17 12l-2.5 2.5" />
  </Svg>
);

export const FitPageIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6" y="3.5" width="12" height="17" rx="1.5" />
    <path d="M12 7v10M9.5 9 12 6.8 14.5 9M9.5 15l2.5 2.2 2.5-2.2" />
  </Svg>
);

export const ActualSizeIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="5" width="16" height="14" rx="1.5" />
    <path d="M8 10v5M7 10.5l1-.8M12 11.2v.1M12 14v.1M16 10v5M15 10.5l1-.8" />
  </Svg>
);

export const RotateLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 12a8 8 0 1 0 2.3-5.6" />
    <path d="M4 4v5h5" />
  </Svg>
);

export const SinglePageIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="7" y="3.5" width="10" height="17" rx="1.2" />
  </Svg>
);

export const TwoPagesIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5" width="8.5" height="14" rx="1.2" />
    <rect x="12.5" y="5" width="8.5" height="14" rx="1.2" />
  </Svg>
);

export const ScrollIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="7" y="2.5" width="10" height="8" rx="1" />
    <rect x="7" y="13.5" width="10" height="8" rx="1" />
  </Svg>
);

export const MoonIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />
  </Svg>
);

export const FullScreenIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Svg>
);

export const PanelLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <path d="M9.5 4.5v15" />
  </Svg>
);

export const ArrowUpIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 15 6-6 6 6" />
  </Svg>
);

export const ArrowDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

export const ExtractIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 3.5H7v17h10V7z" />
    <path d="M14 3.5V7h3" />
    <path d="M12 10v6M9.5 13.5 12 16l2.5-2.5" />
  </Svg>
);

// ---------- comment & markup ----------

export const CursorIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3.5 18 13l-5.5.8L15 19.5l-2.4 1-2.5-5.6L6 18.5z" />
  </Svg>
);

export const HighlightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m14.5 4.5 5 5-8 8H7v-4.5z" />
    <path d="M12.5 6.5l5 5" />
    <path d="M4 20.5h9" />
  </Svg>
);

export const TextBoxIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" strokeDasharray="2.5 2.2" />
    <path d="M8.5 9h7M12 9v7" />
  </Svg>
);

export const PenIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20c3-1 4-4 6.5-6.5L17 7l-2-2-6.5 6.5C6 14 5 17 4 20z" />
    <path d="M14 6l2.5 2.5" />
  </Svg>
);

export const ImageIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m4 18 5.5-5 4 3.5 2.5-2 4 3.5" />
  </Svg>
);

export const NoteIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 4.5h15v11l-4 4h-11z" />
    <path d="M15.5 19.5v-4h4" />
    <path d="M8 9h8M8 12.5h5" />
  </Svg>
);

export const UnderlineIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7.5 4.5v6a4.5 4.5 0 0 0 9 0v-6" />
    <path d="M5.5 20h13" />
  </Svg>
);

export const StrikeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M16.5 6.5c-.8-1.3-2.4-2-4.5-2-2.6 0-4.3 1.3-4.3 3.2 0 1.6 1.2 2.5 3.3 3.1" />
    <path d="M4.5 12h15" />
    <path d="M7.5 17c.8 1.5 2.5 2.5 4.6 2.5 2.7 0 4.4-1.3 4.4-3.3 0-.9-.3-1.6-.9-2.2" />
  </Svg>
);

export const RectIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="6" width="16" height="12" rx="1" />
  </Svg>
);

export const EllipseIcon = (p: IconProps) => (
  <Svg {...p}>
    <ellipse cx="12" cy="12" rx="8.5" ry="6.5" />
  </Svg>
);

export const LineIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 19 19 5" />
  </Svg>
);

export const ArrowIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 19 19 5M10 5h9v9" />
  </Svg>
);

export const StampIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.5 12.5 9 5.5a3 3 0 0 1 6 0l-.5 7" />
    <path d="M5 13h14v3.5H5z" />
    <path d="M6 20.5h12" />
  </Svg>
);

export const RedoIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </Svg>
);

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);

export const CommentsIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 5.5h15v10h-8l-4.5 3.5v-3.5h-2.5z" />
  </Svg>
);
