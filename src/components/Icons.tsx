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
