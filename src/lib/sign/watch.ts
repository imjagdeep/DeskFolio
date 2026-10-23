// Keeps an eye on the requests you sent: when someone signs, declines, or a
// request completes, DeskFolio says so (a toast, and a card on Home that stays
// until you look), even when Agreements isn't open. Checks at start, every few
// minutes, and when the window comes back to the front; only while signed in.

import { useSyncExternalStore } from "react";
import { createStore, toast } from "../store";
import { listRequests, type SignRequest } from "./requests";

export type NewsKind = "signed" | "completed" | "declined" | "expired" | "voided";

export interface News {
  /** Request id. */
  id: string;
  title: string;
  kind: NewsKind;
  /** Who signed or declined, for "signed"/"declined". */
  who?: string;
  /** "1 of 2 signed". */
  progress?: string;
  at: number;
}

const SEEN = "deskfolio-sign-seen";
const NEWS = "deskfolio-sign-news";

/** What we last saw of each request: its status and who had signed. */
type Seen = Record<string, { status: string; signed: string[] }>;

function readJson<T>(key: string, fallback: T, ok: (v: unknown) => boolean): T {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    return ok(v) ? (v as T) : fallback;
  } catch {
    // Unreadable: start fresh (at worst one piece of news is shown again or missed).
    return fallback;
  }
}
function writeJson(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // Not remembered across restarts; the next check sees the same state again.
  }
}

const isRecord = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
const newsStore = createStore<News[]>(
  readJson<News[]>(NEWS, [], (v) => Array.isArray(v) && v.every((n) => isRecord(n) && typeof (n as News).id === "string")),
);
export const useAgreementNews = () => useSyncExternalStore(newsStore.subscribe, newsStore.get);

function setNews(list: News[]) {
  newsStore.set(list);
  writeJson(NEWS, list);
}

/** You looked at it: forget the news about one request (or all). */
export function dismissNews(id?: string) {
  setNews(id ? newsStore.get().filter((n) => n.id !== id) : []);
}

const signedIds = (r: SignRequest) => r.recipients.filter((p) => p.role === "signer" && p.status === "signed").map((p) => p.id);
const progressOf = (r: SignRequest) => {
  const signers = r.recipients.filter((p) => p.role === "signer");
  return `${signers.filter((p) => p.status === "signed").length} of ${signers.length} signed`;
};

/** Compare the list with what we saw last time; returns the news (and remembers the list). */
export function diffRequests(list: SignRequest[], seen: Seen, now = Date.now()): { news: News[]; seen: Seen } {
  const news: News[] = [];
  const next: Seen = {};
  for (const r of list) {
    const before = seen[r.id];
    const signed = signedIds(r);
    next[r.id] = { status: r.status, signed };
    if (!before) continue; // first sight: nothing to announce
    if (before.status !== r.status && (r.status === "completed" || r.status === "declined" || r.status === "expired" || r.status === "voided")) {
      const decliner = r.recipients.find((p) => p.status === "declined");
      news.push({ id: r.id, title: r.title, kind: r.status, who: r.status === "declined" ? decliner?.name : undefined, at: now });
      continue;
    }
    const fresh = r.recipients.filter((p) => signed.includes(p.id) && !before.signed.includes(p.id));
    if (fresh.length) news.push({ id: r.id, title: r.title, kind: "signed", who: fresh.map((p) => p.name).join(", "), progress: progressOf(r), at: now });
  }
  return { news, seen: next };
}

/** Plain words for a piece of news. */
export function newsText(n: News): string {
  switch (n.kind) {
    case "completed":
      return `Everyone signed "${n.title}". The signed copy is ready.`;
    case "signed":
      return `${n.who ?? "Someone"} signed "${n.title}"${n.progress ? ` (${n.progress})` : ""}.`;
    case "declined":
      return `${n.who ?? "Someone"} declined to sign "${n.title}".`;
    case "expired":
      return `"${n.title}" expired before everyone signed.`;
    case "voided":
      return `"${n.title}" was cancelled.`;
  }
}

/** Fetch the list, announce what changed, and return the list (null when it couldn't be read). */
export async function checkAgreements(quiet = false): Promise<SignRequest[] | null> {
  let list: SignRequest[];
  try {
    list = await listRequests();
  } catch {
    return null; // offline or signed out: try again later, quietly
  }
  const seen = readJson<Seen>(SEEN, {}, isRecord);
  const { news, seen: next } = diffRequests(list, seen);
  writeJson(SEEN, next);
  if (news.length) {
    // Newest first; one entry per request (the latest news wins).
    const keep = newsStore.get().filter((n) => !news.some((x) => x.id === n.id));
    setNews([...news, ...keep].slice(0, 20));
    if (!quiet) for (const n of news) toast(newsText(n), n.kind === "declined" || n.kind === "expired");
  }
  return list;
}

let timer: number | null = null;
/** Start the background checks (call once, after the account is known). */
export function watchAgreements(signedIn: boolean) {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
  if (!signedIn) return;
  void checkAgreements();
  timer = window.setInterval(() => void checkAgreements(), 3 * 60_000);
}

/** Check again when the window comes back to the front (at most once a minute). */
let lastFocus = 0;
export function agreementsOnFocus() {
  if (timer === null || Date.now() - lastFocus < 60_000) return;
  lastFocus = Date.now();
  void checkAgreements();
}

/** The agreement to open when Agreements shows next (from a Home card or a toast). */
let wanted: string | null = null;
export function openAgreement(id: string) {
  wanted = id;
}
export function takeWantedAgreement(): string | null {
  const id = wanted;
  wanted = null;
  return id;
}
