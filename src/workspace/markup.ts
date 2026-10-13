// DeskFolio's own markup tools (the ones pdf.js's editor doesn't have):
// which one is active, its colour and line width, the author name for
// comments, and adding finished marks to the active document.

import { useSyncExternalStore } from "react";
import { applyEdit, currentDoc, flushPending } from "../lib/doc";
import { addMarks, STAMPS, type Mark, type RGB } from "../lib/pdf/markup";
import { createStore, toastError } from "../lib/store";
import { EDIT, setEditMode, viewMode } from "./viewer";

export type OwnTool = "note" | "underline" | "strikeout" | "square" | "circle" | "line" | "arrow" | "stamp" | "redact" | "edittext" | "editimage" | "link";

export interface MarkupState {
  tool: OwnTool | null;
  color: RGB;
  width: number;
  /** Index into STAMPS. */
  stamp: number;
  /** Add today's date under the stamp text. */
  stampDate: boolean;
  /** Shown as the author of comments; empty = none. */
  author: string;
}

const KEY = "deskfolio-markup";
const defaults: MarkupState = { tool: null, color: [0.86, 0.15, 0.15], width: 2, stamp: 0, stampDate: true, author: "" };

function isRGB(x: unknown): x is RGB {
  return Array.isArray(x) && x.length === 3 && x.every((v) => typeof v === "number" && v >= 0 && v <= 1);
}

function read(): MarkupState {
  try {
    const o: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (!o || typeof o !== "object") return defaults;
    const get = (k: string): unknown => (k in o ? Object.getOwnPropertyDescriptor(o, k)?.value : undefined);
    const color = get("color");
    const width = get("width");
    const stamp = get("stamp");
    const stampDate = get("stampDate");
    const author = get("author");
    return {
      tool: null,
      color: isRGB(color) ? color : defaults.color,
      width: typeof width === "number" && width > 0 && width <= 20 ? width : defaults.width,
      stamp: typeof stamp === "number" && STAMPS[stamp] ? stamp : 0,
      stampDate: typeof stampDate === "boolean" ? stampDate : true,
      author: typeof author === "string" ? author.slice(0, 80) : "",
    };
  } catch {
    // Damaged or unavailable storage: defaults.
    return defaults;
  }
}

const store = createStore<MarkupState>(read());
export const useMarkup = () => useSyncExternalStore(store.subscribe, store.get);
export const markupState = () => store.get();

export function setMarkup(p: Partial<MarkupState>) {
  const next = { ...store.get(), ...p };
  store.set(next);
  try {
    const { tool: _tool, ...keep } = next;
    localStorage.setItem(KEY, JSON.stringify(keep));
  } catch {
    // Not remembered; fine.
  }
}

/** Choose one of our tools (again = off); pdf.js's tool is switched off. */
export function setOwnTool(tool: OwnTool | null) {
  const next = store.get().tool === tool ? null : tool;
  if (next && viewMode() !== EDIT.none) setEditMode(EDIT.none);
  setMarkup({ tool: next });
}

/** Called when a pdf.js tool is chosen: ours goes off. */
export const clearOwnTool = () => {
  if (store.get().tool) setMarkup({ tool: null });
};

const LABELS: Record<Mark["kind"], string> = {
  square: "Rectangle",
  circle: "Ellipse",
  line: "Line",
  arrow: "Arrow",
  underline: "Underline",
  strikeout: "Strike-through",
  note: "Sticky note",
  stamp: "Stamp",
};

/** Write marks into the active document (pdf.js's pending marks go first). */
export async function addToDocument(marks: Mark[]): Promise<boolean> {
  if (!marks.length) return false;
  try {
    await flushPending();
    const d = currentDoc();
    if (!d) return false;
    const author = store.get().author.trim();
    const bytes = await addMarks(
      d.bytes,
      marks.map((m) => ({ ...m, author: author || undefined })),
      { password: d.password },
    );
    return await applyEdit(bytes, LABELS[marks[0].kind], d.id);
  } catch (e) {
    toastError(e);
    return false;
  }
}

export const RGB_HEX = (c: RGB) => `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
export function HEX_RGB(h: string): RGB {
  const c = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [c(1), c(3), c(5)];
}
