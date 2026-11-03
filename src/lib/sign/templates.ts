// Templates for signature requests: who signs (as slots, with or without names
// and emails), where each of them fills in what, the order, reminders, deadline
// and message. Kept on this computer only; applied to whichever PDF is open.

import type { FieldKind } from "./envelope";
import type { DraftField, Person } from "./requests";

const KEY = "deskfolio-sign-templates";
const KINDS: FieldKind[] = ["signature", "initials", "date", "name", "text", "checkbox"];

export interface TemplatePerson {
  slot: string;
  role: "signer" | "cc";
  position: number;
  /** Empty when the template was saved without contacts. */
  name: string;
  email: string;
}
export interface TemplateField {
  person: string;
  kind: FieldKind;
  page: number;
  rect: [number, number, number, number];
  required: boolean;
  label?: string;
}
export interface Template {
  id: string;
  name: string;
  savedAt: string;
  /** Pages of the PDF it was made on; fields past a shorter PDF's last page are left out. */
  pages: number;
  message: string;
  sequential: boolean;
  reminderDays: number;
  expiresDays: number;
  people: TemplatePerson[];
  fields: TemplateField[];
}

const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function readPerson(v: unknown): TemplatePerson | null {
  if (!isObj(v) || !isStr(v.slot) || (v.role !== "signer" && v.role !== "cc") || !isNum(v.position) || !isStr(v.name) || !isStr(v.email)) return null;
  return { slot: v.slot, role: v.role, position: v.position, name: v.name, email: v.email };
}
function readField(v: unknown): TemplateField | null {
  if (!isObj(v) || !isStr(v.person) || !isNum(v.page) || typeof v.required !== "boolean") return null;
  const kind = KINDS.find((k) => k === v.kind);
  const r = v.rect;
  if (!kind || !Array.isArray(r) || r.length !== 4 || !r.every(isNum)) return null;
  return { person: v.person, kind, page: v.page, rect: [r[0], r[1], r[2], r[3]], required: v.required, ...(isStr(v.label) ? { label: v.label } : {}) };
}
/** A stored template, checked field by field (anything malformed is skipped, not trusted). */
export function readTemplate(v: unknown): Template | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.name) || !isStr(v.savedAt) || !isNum(v.pages) || !isStr(v.message) || typeof v.sequential !== "boolean"
    || !isNum(v.reminderDays) || !isNum(v.expiresDays) || !Array.isArray(v.people) || !Array.isArray(v.fields)) return null;
  const people = v.people.map(readPerson).filter((p): p is TemplatePerson => p !== null);
  const slots = new Set(people.map((p) => p.slot));
  const fields = v.fields.map(readField).filter((f): f is TemplateField => f !== null && slots.has(f.person));
  return { id: v.id, name: v.name, savedAt: v.savedAt, pages: v.pages, message: v.message, sequential: v.sequential, reminderDays: v.reminderDays, expiresDays: v.expiresDays, people, fields };
}

export function listTemplates(): Template[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.map(readTemplate).filter((t): t is Template => t !== null).sort((a, b) => a.name.localeCompare(b.name)) : [];
  } catch {
    // Unreadable: no templates rather than a broken page.
    return [];
  }
}
function store(list: Template[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
}
/** Save (a template with the same name is replaced). */
export function saveTemplate(t: Template) {
  store([...listTemplates().filter((x) => x.name.toLowerCase() !== t.name.toLowerCase()), t]);
}
export function deleteTemplate(id: string) {
  store(listTemplates().filter((t) => t.id !== id));
}

export interface ComposerState {
  people: Person[];
  fields: DraftField[];
  message: string;
  sequential: boolean;
  reminderDays: number;
  expiresDays: number;
}

/** A template from what's on screen now. */
export function makeTemplate(name: string, s: ComposerState, pages: number, withContacts: boolean, now = new Date()): Template {
  return {
    id: `t${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim(),
    savedAt: now.toISOString(),
    pages,
    message: s.message,
    sequential: s.sequential,
    reminderDays: s.reminderDays,
    expiresDays: s.expiresDays,
    people: s.people.map((p) => ({ slot: p.local, role: p.role, position: p.position, name: withContacts ? p.name.trim() : "", email: withContacts ? p.email.trim() : "" })),
    fields: s.fields.map((f) => ({ person: f.person, kind: f.kind, page: f.page, rect: f.rect, required: f.required, ...(f.label !== undefined ? { label: f.label } : {}) })),
  };
}

/** The template's people and fields for a PDF with `pages` pages, with fresh ids; `dropped` counts fields past its last page. */
export function applyTemplate(t: Template, pages: number, newId: (prefix: string) => string): ComposerState & { dropped: number } {
  const ids = new Map(t.people.map((p) => [p.slot, newId("p")]));
  const people: Person[] = t.people.map((p) => ({ local: ids.get(p.slot) ?? newId("p"), name: p.name, email: p.email, role: p.role, position: p.position }));
  const fit = t.fields.filter((f) => f.page < pages);
  const fields: DraftField[] = fit.map((f) => ({ local: newId("f"), person: ids.get(f.person) ?? "", kind: f.kind, page: f.page, rect: f.rect, required: f.required, ...(f.label !== undefined ? { label: f.label } : {}) }));
  return { people, fields, message: t.message, sequential: t.sequential, reminderDays: t.reminderDays, expiresDays: t.expiresDays, dropped: t.fields.length - fit.length };
}
