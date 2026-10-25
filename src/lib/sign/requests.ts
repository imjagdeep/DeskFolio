// DeskLab Sign from DeskFolio: send a PDF for signature, follow it, finish
// it. Every call goes through the signed-in account (Rust), every file is
// encrypted here with a key that is kept only on this computer.

import { invoke } from "@tauri-apps/api/core";
import {
  isFieldsFile,
  isLinksFile,
  isValuesFile,
  keyFromText,
  keyToText,
  newKey,
  seal,
  sealJson,
  sha256Hex,
  signLink,
  unseal,
  unsealJson,
  type Field,
  type FieldKind,
  type FieldsFile,
  type LinksFile,
  type ValuesFile,
} from "./envelope";

/** Where signing links open (a local page in tests; set at build time). */
export const SIGN_BASE = (import.meta.env.VITE_SIGN_BASE ?? "https://sign.getdesklab.com").replace(/\/$/, "");

export type RecipientStatus = "waiting" | "notified" | "opened" | "signed" | "declined";
export type RequestStatus = "draft" | "sent" | "signed" | "completed" | "declined" | "voided" | "expired";

export interface RequestRecipient {
  id: string;
  position: number;
  name: string;
  email: string;
  role: "signer" | "cc";
  status: RecipientStatus;
  notifiedAt: string | null;
  openedAt: string | null;
  signedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  remindedAt: string | null;
}

export interface SignRequest {
  id: string;
  title: string;
  status: RequestStatus;
  sequential: boolean;
  reminderDays: number;
  createdAt: string;
  sentAt: string | null;
  endedAt: string | null;
  expiresAt: string;
  filesDeleted: boolean;
  docSha256: string;
  finalSha256: string | null;
  recipients: RequestRecipient[];
}

export interface RequestEvent {
  at: string;
  event: string;
  recipientId: string | null;
  name: string | null;
  email: string | null;
  ip: string | null;
  userAgent: string | null;
  detail: string | null;
}

// ---------- calls (through Rust, signed in) ----------

const call = <T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown) => invoke<T>("sign_call", { method, path, body: body ?? null });
const upload = (path: string, bytes: Uint8Array) => invoke<void>("sign_upload", bytes, { headers: { "x-path": encodeURIComponent(path) } });
const download = async (path: string) => new Uint8Array(await invoke<ArrayBuffer>("sign_download", { path }));

// ---------- keys, kept on this computer only ----------

const KEYS = "deskfolio-sign-keys";
function readKeys(): Record<string, string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEYS) ?? "{}");
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === "string"));
  } catch {
    // Unreadable: no keys (requests still show, their files can't be opened here).
    return {};
  }
}
function keepKey(id: string, key: Uint8Array) {
  const all = readKeys();
  all[id] = keyToText(key);
  localStorage.setItem(KEYS, JSON.stringify(all));
}
function dropKey(id: string) {
  const all = readKeys();
  delete all[id];
  try {
    localStorage.setItem(KEYS, JSON.stringify(all));
  } catch {
    // Not saved; harmless (the request is gone).
  }
}
export function keyFor(id: string): Uint8Array | null {
  const t = readKeys()[id];
  return t ? keyFromText(t) : null;
}

/**
 * The key from a DeskLab Sign link (the part after #), for a request whose key
 * isn't on this computer any more (app data reset, another PC). Kept only if it
 * really opens this request's files.
 */
export async function keyFromLink(req: SignRequest, link: string): Promise<void> {
  const key = keyFromText(decodeURIComponent(link.trim().split("#")[1] ?? "").trim());
  if (!key) throw new Error("That isn't a DeskLab Sign link. Copy the whole link from the email, including the part after #.");
  const file = req.status === "completed" && !req.filesDeleted ? "final" : "document";
  try {
    await unseal(key, await download(`/v1/envelopes/${req.id}/files/${file}`));
  } catch {
    throw new Error("That link belongs to another request, or it was cut short. Use the link from this request's email.");
  }
  keepKey(req.id, key);
}

/** Who may sign now: same rule as the server (lowest open position, or everyone). */
export function dueNow(recipients: { id: string; role: string; position: number; status: string }[], sequential: boolean) {
  const open = recipients.filter((r) => r.role === "signer" && r.status !== "signed" && r.status !== "declined");
  if (!sequential || !open.length) return open;
  const first = Math.min(...open.map((r) => r.position));
  return open.filter((r) => r.position === first);
}

// ---------- sending ----------

export interface Person {
  /** Local id while preparing (fields point at it). */
  local: string;
  name: string;
  email: string;
  role: "signer" | "cc";
  position: number;
}

export interface DraftField {
  local: string;
  person: string;
  kind: FieldKind;
  page: number;
  rect: [number, number, number, number];
  required: boolean;
  label?: string;
}

export interface NewRequest {
  pdf: Uint8Array;
  title: string;
  ownerName: string;
  message: string;
  sequential: boolean;
  reminderDays: number;
  expiresDays: number;
  people: Person[];
  fields: DraftField[];
}

export async function sendRequest(r: NewRequest): Promise<{ id: string; failed: string[] }> {
  const key = newKey();
  const created = await call<{ id: string; ownerToken: string; recipients: { id: string; token: string; email: string; role: string; position: number }[] }>("POST", "/v1/envelopes", {
    title: r.title,
    ownerName: r.ownerName,
    message: r.message,
    sequential: r.sequential,
    reminderDays: r.reminderDays,
    expiresDays: r.expiresDays,
    docSha256: await sha256Hex(r.pdf),
    recipients: r.people.map((p) => ({ name: p.name, email: p.email, role: p.role, position: p.position })),
  });
  // Kept before anything else: without it nobody (not even we) can open the files.
  keepKey(created.id, key);
  // The server answers in the order it was given.
  const idOf = new Map(r.people.map((p, i) => [p.local, created.recipients[i]?.id ?? ""]));
  const fields: FieldsFile = {
    v: 1,
    fields: r.fields.map((f): Field => ({ id: f.local, recipient: idOf.get(f.person) ?? "", kind: f.kind, page: f.page, rect: f.rect, required: f.required, ...(f.label ? { label: f.label } : {}) })),
  };
  const links: LinksFile = { v: 1, owner: created.ownerToken, recipients: Object.fromEntries(created.recipients.map((x) => [x.id, x.token])) };
  await upload(`/v1/envelopes/${created.id}/files/document`, await seal(key, r.pdf));
  await upload(`/v1/envelopes/${created.id}/files/fields`, await sealJson(key, fields));
  await upload(`/v1/envelopes/${created.id}/files/links`, await sealJson(key, links));
  const first = dueNow(created.recipients.map((x) => ({ ...x, status: "waiting" })), r.sequential);
  const tokenOf = new Map(created.recipients.map((x) => [x.id, x.token]));
  const sent = await call<{ notified: string[]; failed: string[] }>("POST", `/v1/envelopes/${created.id}/send`, {
    invites: first.map((x) => ({ recipientId: x.id, link: signLink(SIGN_BASE, tokenOf.get(x.id) ?? "", key) })),
  });
  return { id: created.id, failed: sent.failed };
}

// ---------- following ----------

export const listRequests = async () => (await call<{ envelopes: SignRequest[] }>("GET", "/v1/envelopes")).envelopes;
export const requestDetail = (id: string) => call<{ envelope: SignRequest; events: RequestEvent[]; auditIntact: boolean; auditHash: string | null }>("GET", `/v1/envelopes/${id}`);

async function linksOf(id: string, key: Uint8Array) {
  return unsealJson(key, await download(`/v1/envelopes/${id}/files/links`), isLinksFile);
}

/** Email the invitation again to everyone whose turn it is. */
export async function resend(req: SignRequest): Promise<number> {
  const key = keyFor(req.id);
  if (!key) throw new Error("This request was sent from another computer, so its links can't be rebuilt here.");
  const links = await linksOf(req.id, key);
  const targets = dueNow(req.recipients, req.sequential).filter((r) => r.status === "notified" || r.status === "opened");
  if (!targets.length) throw new Error("Nobody is waiting for an invitation right now.");
  await call("POST", `/v1/envelopes/${req.id}/resend`, { invites: targets.map((t) => ({ recipientId: t.id, link: signLink(SIGN_BASE, links.recipients[t.id] ?? "", key) })) });
  return targets.length;
}

export const cancelRequest = (id: string, reason: string) => call("POST", `/v1/envelopes/${id}/void`, { reason });

export async function deleteRequest(id: string) {
  await call("DELETE", `/v1/envelopes/${id}`);
  dropKey(id);
}

/** The signed copy, checked against the hash recorded at completion. */
export async function finalCopy(req: SignRequest): Promise<Uint8Array> {
  const key = keyFor(req.id);
  if (!key) throw new Error("This request was sent from another computer; open the link in your completion email instead.");
  const bytes = await unseal(key, await download(`/v1/envelopes/${req.id}/files/final`));
  if (req.finalSha256 && (await sha256Hex(bytes)) !== req.finalSha256) throw new Error("The signed copy doesn't match the one recorded at completion.");
  return bytes;
}

/**
 * While a request is open: the document with what has been signed so far, for
 * the sender to look at. Every page says it isn't the final copy.
 */
export async function progressCopy(req: SignRequest): Promise<Uint8Array> {
  const key = keyFor(req.id);
  if (!key) throw new Error("This request was sent from another computer, so its files can't be opened here.");
  const original = await unseal(key, await download(`/v1/envelopes/${req.id}/files/document`));
  const fields = (await unsealJson(key, await download(`/v1/envelopes/${req.id}/files/fields`), isFieldsFile)).fields;
  const signers = req.recipients.filter((r) => r.role === "signer");
  const done = signers.filter((s) => s.status === "signed");
  const values: ValuesFile[] = [];
  for (const s of done) values.push(await unsealJson(key, await download(`/v1/envelopes/${req.id}/files/values-${s.id}`), isValuesFile));
  const { buildProgress } = await import("./finalize");
  const note = `NOT THE FINAL COPY - signed so far by ${done.map((s) => s.name).join(", ") || "no one"} (${done.length} of ${signers.length}) - ${new Date().toLocaleString()}`;
  return buildProgress(original, fields, values, note);
}

/**
 * Everyone signed but the final copy wasn't made (the last signer's browser
 * was closed too soon): make it here and send everyone their copy.
 */
export async function finishHere(req: SignRequest, ownerName: string): Promise<Uint8Array> {
  const key = keyFor(req.id);
  if (!key) throw new Error("This request was sent from another computer; finish it there.");
  const detail = await requestDetail(req.id);
  const original = await unseal(key, await download(`/v1/envelopes/${req.id}/files/document`));
  const fields = (await unsealJson(key, await download(`/v1/envelopes/${req.id}/files/fields`), isFieldsFile)).fields;
  const links = await linksOf(req.id, key);
  const signers = req.recipients.filter((r) => r.role === "signer");
  const values: ValuesFile[] = [];
  for (const s of signers) values.push(await unsealJson(key, await download(`/v1/envelopes/${req.id}/files/values-${s.id}`), isValuesFile));
  const { buildFinal } = await import("./finalize");
  const me = await invoke<{ email: string | null }>("account_status");
  const final = await buildFinal(original, fields, values, {
    envelopeId: req.id,
    title: req.title,
    ownerName: ownerName || "DeskLab user",
    ownerEmail: me.email ?? "",
    docSha256: req.docSha256,
    signers: signers.map((s) => ({ id: s.id, name: s.name, email: s.email, signedAt: s.signedAt })),
    events: detail.events,
    auditHash: detail.auditHash,
    auditIntact: detail.auditIntact,
    verifyUrl: `${SIGN_BASE}/verify`,
    completedAt: new Date(),
  });
  await upload(`/v1/envelopes/${req.id}/final`, await seal(key, final));
  const invites = req.recipients.map((r) => ({ recipientId: r.id, link: signLink(SIGN_BASE, links.recipients[r.id] ?? "", key) }));
  invites.push({ recipientId: "owner", link: signLink(SIGN_BASE, links.owner, key) });
  await call("POST", `/v1/envelopes/${req.id}/finish`, { finalSha256: await sha256Hex(final), invites });
  return final;
}
