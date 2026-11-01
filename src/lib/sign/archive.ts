// Signed copies of completed requests, kept on this computer in
// Documents\DeskFolio\Signed agreements. DeskLab Sign can never read the files
// (they are encrypted here) and deletes them 30 days after a request ends, so
// this copy is the lasting record. DeskFolio keeps it by itself as soon as it
// sees a request complete; nothing to remember.

import { api } from "../api";
import { finalCopy, keyFor, type SignRequest } from "./requests";

const KEPT = "deskfolio-sign-kept";

/** Request id → where its signed copy was kept. */
function readKept(): Record<string, string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEPT) ?? "{}");
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === "string"));
  } catch {
    // Unreadable: the copies are still on disk; they are just kept again.
    return {};
  }
}

function remember(id: string, path: string) {
  const all = readKept();
  all[id] = path;
  localStorage.setItem(KEPT, JSON.stringify(all));
}

/** Where this request's signed copy was kept, if it was. */
export const keptPath = (id: string): string | null => readKept()[id] ?? null;

/** "Lease 2026 - signed 2026-11-01 - 3f2a9c1b.pdf": readable, sortable, unique per request. */
export function keptFileName(req: Pick<SignRequest, "id" | "title" | "endedAt">): string {
  const title = req.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || "Agreement";
  const day = (req.endedAt ?? new Date().toISOString()).slice(0, 10);
  return `${title} - signed ${day} - ${req.id.slice(0, 8)}.pdf`;
}

const join = (dir: string, name: string) => `${dir.replace(/[\\/]+$/, "")}${dir.includes("\\") ? "\\" : "/"}${name}`;

/** Completed requests whose signed copy should be kept now. */
export const toKeep = (list: SignRequest[]) => list.filter((r) => r.status === "completed" && !r.filesDeleted && !keptPath(r.id) && keyFor(r.id) !== null);

let running: Promise<SignRequest[]> | null = null;

/**
 * Keep the signed copy of every newly completed request (checked against the
 * hash recorded at completion). Returns the requests kept this time. One
 * that fails (offline, disk full) is tried again at the next check, and
 * Agreements shows it as not kept yet.
 */
export function keepSignedCopies(list: SignRequest[]): Promise<SignRequest[]> {
  if (running) return running;
  const todo = toKeep(list);
  if (!todo.length) return Promise.resolve([]);
  running = (async () => {
    const dir = await api.signedAgreementsDir();
    const kept: SignRequest[] = [];
    for (const r of todo) {
      try {
        const path = join(dir, keptFileName(r));
        await api.writeFile(path, await finalCopy(r));
        remember(r.id, path);
        kept.push(r);
      } catch (e) {
        console.warn(`Couldn't keep the signed copy of ${r.id} yet:`, e);
      }
    }
    return kept;
  })().finally(() => {
    running = null;
  });
  return running;
}

export const signedAgreementsDir = () => api.signedAgreementsDir();
