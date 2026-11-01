// Signed copies of completed requests, kept on this computer in
// Documents\DeskFolio\Signed agreements. DeskLab Sign can never read the files
// (they are encrypted here) and deletes them 30 days after a request ends, so
// this copy is the lasting record. DeskFolio keeps it by itself as soon as it
// sees a request complete; nothing to remember.

import { api } from "../api";
import { firstDifferentPage } from "./check";
import { finalCopy, keyFor, rebuildSigned, type SignRequest } from "./requests";

const KEPT = "deskfolio-sign-kept";
const ALTERED = "deskfolio-sign-altered";

/** Request id → the first page of its signed copy that doesn't match what was signed. */
function readAltered(): Record<string, number> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(ALTERED) ?? "{}");
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter((e): e is [string, number] => typeof e[1] === "number"));
  } catch {
    // Unreadable: the copy is simply checked again.
    return {};
  }
}

/** The page where this request's signed copy differs from what was signed, if it does. */
export const alteredPage = (id: string): number | null => readAltered()[id] ?? null;

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
export const toKeep = (list: SignRequest[]) =>
  list.filter((r) => r.status === "completed" && !r.filesDeleted && !keptPath(r.id) && alteredPage(r.id) === null && keyFor(r.id) !== null);

export interface KeepResult {
  kept: SignRequest[];
  /** Copies whose pages don't match what was signed: not kept. */
  altered: { req: SignRequest; page: number }[];
}

let running: Promise<KeepResult> | null = null;

/**
 * Keep the signed copy of every newly completed request: checked against the
 * hash recorded at completion, then page by page against the document rebuilt
 * from the original and the signers' entries. One that fails (offline, disk
 * full) is tried again at the next check, and Agreements shows it as not kept
 * yet; one that doesn't match is reported and never kept.
 */
export function keepSignedCopies(list: SignRequest[]): Promise<KeepResult> {
  if (running) return running;
  const todo = toKeep(list);
  if (!todo.length) return Promise.resolve({ kept: [], altered: [] });
  running = (async () => {
    const dir = await api.signedAgreementsDir();
    const out: KeepResult = { kept: [], altered: [] };
    for (const r of todo) {
      try {
        const signed = await finalCopy(r);
        const rebuilt = await rebuildSigned(r);
        const page = await firstDifferentPage(signed, rebuilt.bytes, rebuilt.pages);
        if (page !== null) {
          const all = readAltered();
          all[r.id] = page;
          localStorage.setItem(ALTERED, JSON.stringify(all));
          out.altered.push({ req: r, page });
          continue;
        }
        const path = join(dir, keptFileName(r));
        await api.writeFile(path, signed);
        remember(r.id, path);
        out.kept.push(r);
      } catch (e) {
        console.warn(`Couldn't keep the signed copy of ${r.id} yet:`, e);
      }
    }
    return out;
  })().finally(() => {
    running = null;
  });
  return running;
}

export const signedAgreementsDir = () => api.signedAgreementsDir();
