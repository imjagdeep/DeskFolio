// Every page (tool) DeskFolio has, in menu order; `needsDoc` ones work on
// the open document.

export type Page =
  | "home"
  | "view"
  | "organize"
  | "merge"
  | "split"
  | "compress"
  | "batch"
  | "sign"
  | "convert"
  | "ocr"
  | "watermark"
  | "headerfooter"
  | "crop"
  | "properties"
  | "compare"
  | "protect"
  | "digitalids"
  | "settings";

export const PAGES: { page: Page; label: string; needsDoc?: boolean }[] = [
  { page: "home", label: "Home" },
  { page: "view", label: "View", needsDoc: true },
  { page: "organize", label: "Organize pages", needsDoc: true },
  { page: "sign", label: "Fill & Sign", needsDoc: true },
  { page: "watermark", label: "Watermark", needsDoc: true },
  { page: "headerfooter", label: "Header & footer", needsDoc: true },
  { page: "crop", label: "Crop pages", needsDoc: true },
  { page: "properties", label: "Document properties", needsDoc: true },
  { page: "compare", label: "Compare", needsDoc: true },
  { page: "protect", label: "Protect", needsDoc: true },
  { page: "merge", label: "Merge" },
  { page: "split", label: "Split" },
  { page: "compress", label: "Compress" },
  { page: "batch", label: "Batch" },
  { page: "convert", label: "Convert" },
  { page: "ocr", label: "Recognise text (OCR)" },
  { page: "digitalids", label: "Digital IDs" },
  { page: "settings", label: "Settings" },
];
