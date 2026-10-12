// Every page (tool) DeskFolio has, in menu order; `needsDoc` ones work on
// the open document.

export type Page = "home" | "view" | "organize" | "merge" | "split" | "compress" | "sign" | "convert" | "ocr" | "settings";

export const PAGES: { page: Page; label: string; needsDoc?: boolean }[] = [
  { page: "home", label: "Home" },
  { page: "view", label: "View", needsDoc: true },
  { page: "organize", label: "Organize pages", needsDoc: true },
  { page: "sign", label: "Fill & Sign", needsDoc: true },
  { page: "merge", label: "Merge" },
  { page: "split", label: "Split" },
  { page: "compress", label: "Compress" },
  { page: "convert", label: "Convert" },
  { page: "ocr", label: "Recognise text (OCR)" },
  { page: "settings", label: "Settings" },
];
