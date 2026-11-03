// Agreements: documents you sent for signature, where each one stands, and
// what you can do (send again, cancel, finish, get the signed copy).

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../components/Common";
import { refreshAccount, useAccount } from "../account/account";
import { api } from "../lib/api";
import { openPath, saveBytes } from "../lib/doc";
import { alteredPage, keepTimestampService, keptPath, setKeepTimestampService, signedAgreementsDir, stampPath } from "../lib/sign/archive";
import {
  cancelRequest,
  changeSettings,
  deleteRequest,
  dueNow,
  finalCopy,
  finishHere,
  groupOf,
  keyFor,
  keyFromLink,
  listRequests,
  matchesQuery,
  progressCopy,
  requestDetail,
  resend,
  type RequestEvent,
  type RequestGroup,
  type SignRequest,
} from "../lib/sign/requests";
import { historyCsv } from "../lib/sign/history";
import { checkAgreements, dismissNews, takeWantedAgreement, useAgreementNews } from "../lib/sign/watch";
import { toast, toastError } from "../lib/store";
import { markupState } from "../workspace/markup";
import { go } from "../workspace/route";

const STATUS: Record<SignRequest["status"], string> = {
  draft: "Not sent",
  sent: "Waiting for signatures",
  signed: "Everyone signed: final copy pending",
  completed: "Completed",
  declined: "Declined",
  voided: "Cancelled",
  expired: "Expired",
};
const PERSON: Record<string, string> = { waiting: "Not yet their turn", notified: "Invited", opened: "Opened", signed: "Signed", declined: "Declined" };
const EVENT: Record<string, string> = {
  created: "Created",
  sent: "Sent",
  notified: "Invitation emailed",
  resent: "Invitation emailed again",
  opened: "Opened",
  reminded: "Reminder emailed",
  changed: "Deadline or reminders changed",
  signed: "Signed",
  "all-signed": "Everyone signed",
  completed: "Completed",
  declined: "Declined",
  voided: "Cancelled",
  expired: "Expired",
  "files-deleted": "Files deleted (30 days after the end)",
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");
const tone = (s: SignRequest["status"]) => (s === "completed" ? "ok" : s === "sent" || s === "signed" ? "wait" : s === "draft" ? "" : "bad");
/** "1 of 2 signed" */
function progress(r: SignRequest): string {
  const signers = r.recipients.filter((p) => p.role === "signer");
  return `${signers.filter((p) => p.status === "signed").length} of ${signers.length} signed`;
}

export function Agreements() {
  const account = useAccount();
  const [list, setList] = useState<SignRequest[] | null>(null);
  // Coming from a Home card: that request opens straight away.
  const [open, setOpen] = useState<string | null>(() => takeWantedAgreement());
  const [group, setGroup] = useState<RequestGroup | "all">("all");
  const [query, setQuery] = useState("");
  // Closed requests picked for deleting together.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [stampWith, setStampWith] = useState(keepTimestampService);
  const [services, setServices] = useState<[string, string][]>([]);
  const news = useAgreementNews();
  const reload = useCallback(() => {
    // Same call as the background check, so news shows here too.
    checkAgreements()
      .then((l) => (l ? setList(l) : listRequests().then(setList)))
      .catch((e: unknown) => {
        toastError(e);
        setList([]);
      });
  }, []);
  useEffect(() => {
    api
      .timestampServices()
      .then(setServices)
      .catch(() => setServices([]));
  }, []);
  const chooseStamp = (id: string) => {
    setStampWith(id);
    try {
      setKeepTimestampService(id);
    } catch (e) {
      toastError(e);
      return;
    }
    // Stamp the copies already kept, now rather than at the next check.
    if (id) reload();
  };
  useEffect(() => {
    refreshAccount()
      .then((s) => (s.signed_in ? reload() : setList([])))
      .catch(() => setList([]));
  }, [reload]);
  // While this page is open, follow it every minute.
  useEffect(() => {
    if (!account?.signed_in) return;
    const t = window.setInterval(reload, 60_000);
    return () => window.clearInterval(t);
  }, [account?.signed_in, reload]);
  // Opening a request you have news about counts as having seen it.
  useEffect(() => {
    if (open && news.some((n) => n.id === open)) dismissNews(open);
  }, [open, news]);

  if (!account?.signed_in) {
    return (
      <div className="page">
        <PageHeader title="Agreements" subtitle="Documents you sent for signature." />
        <div className="card">
          <p className="muted">Sign in to your DeskLab account to see the documents you sent for signature.</p>
          <button className="primary" onClick={() => go("account")}>
            Sign in to DeskLab…
          </button>
        </div>
      </div>
    );
  }
  const count = (g: RequestGroup) => list?.filter((r) => groupOf(r.status) === g).length ?? 0;
  const shown = list?.filter((r) => (group === "all" || groupOf(r.status) === group) && matchesQuery(r, query)) ?? [];
  const tabs: { id: RequestGroup | "all"; label: string; n: number }[] = [
    { id: "all", label: "All", n: list?.length ?? 0 },
    { id: "open", label: "Waiting", n: count("open") },
    { id: "completed", label: "Completed", n: count("completed") },
    { id: "closed", label: "Declined, expired or cancelled", n: count("closed") },
  ];
  const closedShown = shown.filter((r) => !["sent", "signed"].includes(r.status));
  const pickedShown = closedShown.filter((r) => picked.has(r.id));
  const toggle = (id: string) => setPicked((s0) => {
    const s1 = new Set(s0);
    if (s1.has(id)) s1.delete(id);
    else s1.add(id);
    return s1;
  });
  const exportCsv = () => {
    if (!list?.length) return;
    const day = new Date().toISOString().slice(0, 10);
    void saveBytes(new TextEncoder().encode(historyCsv(shown.length ? shown : list)), `Agreements ${day}.csv`, "CSV", "csv");
  };
  const deletePicked = async () => {
    const targets = pickedShown;
    if (!targets.length) return;
    const { ask } = await import("@tauri-apps/plugin-dialog");
    const completed = targets.filter((r) => r.status === "completed").length;
    const ok = await ask(
      `Delete ${targets.length} request${targets.length === 1 ? "" : "s"} and their files from DeskLab Sign now? Copies people saved, and the signed copies kept on this computer, are not affected${completed ? `; the ${completed} completed one${completed === 1 ? " keeps" : "s keep"} a short record so copies can still be checked` : ""}.`,
      { title: "Delete requests", kind: "warning", okLabel: `Delete ${targets.length}`, cancelLabel: "Keep them" },
    );
    if (!ok) return;
    setDeleting(true);
    let done = 0;
    try {
      for (const r of targets) {
        await deleteRequest(r.id);
        done++;
      }
      toast(`Deleted ${done} request${done === 1 ? "" : "s"}.`);
    } catch (e) {
      toastError(e);
      if (done) toast(`Deleted ${done} of ${targets.length} before that.`);
    } finally {
      setDeleting(false);
      setPicked(new Set());
      reload();
    }
  };
  const showFolder = () =>
    void signedAgreementsDir()
      .then((dir) => api.revealFile(dir))
      .catch(toastError);
  return (
    <div className="page wide">
      <PageHeader title="Agreements" subtitle="Documents you sent for signature with DeskLab Sign. Signed copies are kept in Documents › DeskFolio › Signed agreements.">
        <button onClick={showFolder}>Signed copies folder</button>
        <button onClick={exportCsv} disabled={!list?.length} title="Every request shown, one row per person, for Excel">
          Export CSV…
        </button>
        <button onClick={reload}>Refresh</button>
      </PageHeader>
      {list === null && <div className="card muted">Loading…</div>}
      {list?.length === 0 && (
        <div className="card">
          <h2>Nothing sent yet</h2>
          <p className="muted small">Open a PDF, then Fill &amp; Sign › Request signatures. People sign in their browser; you get the signed copy with a certificate of completion.</p>
        </div>
      )}
      {!!list?.length && (
        <div className="ag-tools">
          <div className="segmented" role="tablist" aria-label="Show requests">
            {tabs.map((t) => (
              <button key={t.id} role="tab" aria-selected={group === t.id} className={group === t.id ? "active" : undefined} onClick={() => setGroup(t.id)}>
                {t.label} <span className="ag-count">{t.n}</span>
              </button>
            ))}
          </div>
          <input type="search" value={query} placeholder="Search by title, name, email or ID" aria-label="Search requests" onChange={(e) => setQuery(e.target.value)} />
          {services.length > 0 && (
            <label className="ag-stamp small" title="Sends only the signed copy's fingerprint (SHA-256) to the service you pick, which returns a dated, signed receipt (.tsr) kept next to the copy. It proves the copy existed unchanged at that time, without relying on DeskLab.">
              Trusted timestamp for kept copies
              <select value={services.some(([id]) => id === stampWith) ? stampWith : ""} onChange={(e) => chooseStamp(e.target.value)}>
                <option value="">Off</option>
                {services.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {!!list?.length && !shown.length && <div className="card muted">No requests match.</div>}
      {closedShown.length > 0 && (
        <div className="ag-bulk small">
          <label className="check-row">
            <input
              type="checkbox"
              className="pick"
              checked={pickedShown.length === closedShown.length}
              ref={(el) => {
                if (el) el.indeterminate = pickedShown.length > 0 && pickedShown.length < closedShown.length;
              }}
              onChange={(e) => setPicked(e.target.checked ? new Set(closedShown.map((r) => r.id)) : new Set())}
            />
            <span>{pickedShown.length ? `${pickedShown.length} selected` : `Select finished requests (${closedShown.length})`}</span>
          </label>
          {pickedShown.length > 0 && (
            <button className="danger" disabled={deleting} onClick={() => void deletePicked()}>
              {deleting ? "Deleting…" : `Delete ${pickedShown.length}`}
            </button>
          )}
        </div>
      )}
      <div className="ag-list">
        {shown.map((r) => (
          <div key={r.id} className={open === r.id ? "card ag-item on" : "card ag-item"}>
            <div className="ag-row">
            {!["sent", "signed"].includes(r.status) ? (
              <input type="checkbox" className="pick ag-pick" checked={picked.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select "${r.title}"`} />
            ) : (
              closedShown.length > 0 && <span className="ag-pick ag-pick-space" aria-hidden="true" />
            )}
            <button className="ag-head" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
              <span className="ag-title">
                <b>{r.title}</b>
                <span className="muted small">
                  {when(r.sentAt ?? r.createdAt)} · {r.recipients.filter((x) => x.role === "signer").map((x) => x.name).join(", ")}
                </span>
              </span>
              <span className="ag-right">
                {news.some((n) => n.id === r.id) && <span className="ag-new">New</span>}
                {(r.status === "sent" || r.status === "signed") && <span className="muted small">{progress(r)}</span>}
                <span className={`ag-status ${tone(r.status)}`}>{STATUS[r.status]}</span>
              </span>
            </button>
            </div>
            {open === r.id && <Detail req={r} onChange={reload} />}
          </div>
        ))}
      </div>
    </div>
  );
}

/** "2026-11-20" in local time, for a date input. */
const dateInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** While people are still signing: move the deadline, or change how often reminders go. */
function Deadline({ req, onChange }: { req: SignRequest; onChange: () => void }) {
  const [day, setDay] = useState(() => dateInput(new Date(req.expiresAt)));
  const [every, setEvery] = useState(req.reminderDays);
  const [busy, setBusy] = useState(false);
  const min = dateInput(new Date(Date.now() + 86_400_000));
  const max = dateInput(new Date(Date.now() + 119 * 86_400_000));
  const same = day === dateInput(new Date(req.expiresAt)) && every === req.reminderDays;
  const save = async () => {
    setBusy(true);
    try {
      // The end of the chosen day, local time.
      const [y, m, d] = day.split("-").map(Number);
      const end = new Date(y, m - 1, d, 23, 59, 0);
      const r = await changeSettings(req.id, { reminderDays: every, ...(day !== dateInput(new Date(req.expiresAt)) ? { expiresAt: end.toISOString() } : {}) });
      toast(r.changed.length ? "Changed. People see the new deadline on their signing page." : "Nothing changed.");
      onChange();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ag-deadline">
      <label className="field">
        <span>Deadline</span>
        <input type="date" value={day} min={min} max={max} onChange={(e) => setDay(e.target.value)} />
      </label>
      <label className="field">
        <span>Remind every</span>
        <select value={every} onChange={(e) => setEvery(Number(e.target.value))}>
          {[[0, "Never"], [1, "1 day"], [2, "2 days"], [3, "3 days"], [7, "7 days"], [14, "14 days"]].map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <button disabled={busy || same || !day} onClick={() => void save()}>
        {busy ? "Saving…" : "Save changes"}
      </button>
    </div>
  );
}

function Detail({ req, onChange }: { req: SignRequest; onChange: () => void }) {
  const [events, setEvents] = useState<RequestEvent[] | null>(null);
  const [intact, setIntact] = useState(true);
  const [busy, setBusy] = useState(false);
  const hasKey = !!keyFor(req.id);
  const kept = keptPath(req.id);
  const stamped = stampPath(req.id);
  const altered = alteredPage(req.id);
  useEffect(() => {
    requestDetail(req.id)
      .then((d) => {
        setEvents(d.events);
        setIntact(d.auditIntact);
      })
      .catch(toastError);
  }, [req]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const saveCopy = (bytes: Uint8Array, suffix = "signed") =>
    run(async () => {
      const path = await saveBytes(bytes, `${req.title.replace(/[\\/:*?"<>|]/g, "")} (${suffix}).pdf`);
      if (path) await openPath(path);
    });
  const someoneSigned = req.recipients.some((p) => p.role === "signer" && p.status === "signed");

  const waitingFor = dueNow(req.recipients, req.sequential).filter((r) => r.status === "notified" || r.status === "opened");
  return (
    <div className="ag-detail">
      <ul className="ag-people">
        {[...req.recipients]
          .sort((a, b) => a.position - b.position)
          .map((p) => (
            <li key={p.id}>
              <span>
                {p.name} <span className="muted small">{p.email}</span>
                {p.hasAccessCode && <span className="ag-code small" title="Opens only with the access code you gave them">access code</span>}
              </span>
              <span className={`ag-pill ${p.status}`}>
                {p.role === "cc" ? "Gets a copy" : PERSON[p.status]}
                {p.signedAt ? ` · ${when(p.signedAt)}` : p.openedAt && p.status === "opened" ? ` · ${when(p.openedAt)}` : ""}
              </span>
              {p.declineReason && <span className="small error-text">“{p.declineReason}”</span>}
            </li>
          ))}
      </ul>

      <div className="row">
        {req.status === "completed" && !req.filesDeleted && hasKey && (
          <button className="primary" disabled={busy} onClick={() => void run(async () => saveCopy(await finalCopy(req)))}>
            Save and open the signed copy…
          </button>
        )}
        {req.status === "signed" && hasKey && (
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const bytes = await finishHere(req, markupState().author.trim());
                toast("Final copy made and sent to everyone.");
                onChange();
                await saveCopy(bytes);
              })
            }
          >
            Make the final copy
          </button>
        )}
        {req.status === "sent" && someoneSigned && hasKey && (
          <button
            className="primary"
            disabled={busy}
            title="The document with the signatures given so far. Each page is marked as not the final copy."
            onClick={() => void run(async () => saveCopy(await progressCopy(req), "signed so far"))}
          >
            View what's signed so far…
          </button>
        )}
        {req.status === "sent" && waitingFor.length > 0 && hasKey && (
          <button disabled={busy} onClick={() => void run(async () => toast(`Invitation sent again to ${await resend(req)} ${waitingFor.length === 1 ? "person" : "people"}.`))}>
            Send the invitation again
          </button>
        )}
        {(req.status === "sent" || req.status === "signed") && (
          <button
            className="danger"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const { ask } = await import("@tauri-apps/plugin-dialog");
                const ok = await ask(`Cancel "${req.title}"? The links stop working and people whose turn it is are told.`, { title: "Cancel request", kind: "warning", okLabel: "Cancel request", cancelLabel: "Keep it" });
                if (!ok) return;
                await cancelRequest(req.id, "");
                onChange();
              })
            }
          >
            Cancel request
          </button>
        )}
        {!["sent", "signed"].includes(req.status) && (
          <button
            className="ghost"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const { ask } = await import("@tauri-apps/plugin-dialog");
                const ok = await ask(`Delete "${req.title}" and its files from DeskLab Sign now? Copies people saved are not affected${req.status === "completed" ? ", and a short record stays so they can still be checked" : ""}.`, { title: "Delete", kind: "warning", okLabel: "Delete", cancelLabel: "Keep it" });
                if (!ok) return;
                await deleteRequest(req.id);
                onChange();
              })
            }
          >
            Delete
          </button>
        )}
      </div>
      {req.status === "sent" && <Deadline req={req} onChange={onChange} />}
      {kept && (
        <p className="ag-kept small">
          <span>
            Signed copy kept on this computer: <span className="selectable">{kept}</span>
          </span>
          <button className="link" onClick={() => void openPath(kept)}>
            Open
          </button>
          <button className="link" onClick={() => void api.revealFile(kept).catch(toastError)}>
            Show in folder
          </button>
          {stamped && <span className="muted">With a trusted timestamp beside it (.tsr).</span>}
        </p>
      )}
      {altered !== null && (
        <p className="ag-altered small">
          <b>This signed copy doesn't match what was signed.</b> DeskFolio rebuilt the document from the original and each person's entries, and page {altered} of the signed copy is different, so it wasn't kept. Don't rely on it; ask the signers to sign again.
        </p>
      )}
      {req.status === "completed" && !kept && altered === null && !req.filesDeleted && hasKey && <p className="muted small">The signed copy is being checked and kept on this computer (Documents › DeskFolio › Signed agreements).</p>}
      {!hasKey && !req.filesDeleted && !kept && <KeyFromEmail req={req} onDone={onChange} />}
      {req.status === "completed" && req.filesDeleted && !kept && <p className="muted small">The files were deleted 30 days after completion; use the copy you saved.</p>}
      <p className="muted small selectable">Request ID {req.id}</p>

      <details className="ag-history">
        <summary>History{intact ? "" : " (record NOT intact)"}</summary>
        {events === null ? (
          <p className="muted small">Loading…</p>
        ) : (
          <ol>
            {events.map((e, i) => (
              <li key={i}>
                <span className="muted small">{when(e.at)}</span> {EVENT[e.event] ?? e.event}
                {e.name ? ` · ${e.name}` : ""}
                {e.ip ? <span className="muted small"> · IP {e.ip}</span> : null}
              </li>
            ))}
          </ol>
        )}
      </details>
    </div>
  );
}

/** No key on this computer: take it from the link in any of this request's emails. */
function KeyFromEmail({ req, onDone }: { req: SignRequest; onDone: () => void }) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const use = async () => {
    setBusy(true);
    setError("");
    try {
      await keyFromLink(req, link);
      toast(req.status === "completed" ? "Found it. You can open the signed copy now." : "Found it. This request's files open here again.");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ag-key">
      <p className="small">
        This computer doesn't have the key for this request (it was sent from another computer, or DeskFolio's data was reset), so its files can't be opened here
        yet. Paste the link from {req.status === "completed" ? "the \u201cCompleted\u201d email" : "an email about this request"} and DeskFolio takes the key from it.
      </p>
      <div className="row">
        <input value={link} placeholder="https://sign.getdesklab.com/s/…" aria-label="Link from the email" onChange={(e) => setLink(e.target.value)} />
        <button className="primary" disabled={busy || !link.includes("#")} onClick={() => void use()}>
          {busy ? "Checking…" : "Use this link"}
        </button>
      </div>
      {error && <p className="small error-text">{error}</p>}
    </div>
  );
}
