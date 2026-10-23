// Agreements: documents you sent for signature, where each one stands, and
// what you can do (send again, cancel, finish, get the signed copy).

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../components/Common";
import { refreshAccount, useAccount } from "../account/account";
import { openPath, saveBytes } from "../lib/doc";
import { cancelRequest, deleteRequest, dueNow, finalCopy, finishHere, keyFor, keyFromLink, listRequests, requestDetail, resend, type RequestEvent, type SignRequest } from "../lib/sign/requests";
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
  return (
    <div className="page wide">
      <PageHeader title="Agreements" subtitle="Documents you sent for signature with DeskLab Sign.">
        <button onClick={reload}>Refresh</button>
      </PageHeader>
      {list === null && <div className="card muted">Loading…</div>}
      {list?.length === 0 && (
        <div className="card">
          <h2>Nothing sent yet</h2>
          <p className="muted small">Open a PDF, then Fill &amp; Sign › Request signatures. People sign in their browser; you get the signed copy with a certificate of completion.</p>
        </div>
      )}
      <div className="ag-list">
        {list?.map((r) => (
          <div key={r.id} className={open === r.id ? "card ag-item on" : "card ag-item"}>
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
            {open === r.id && <Detail req={r} onChange={reload} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function Detail({ req, onChange }: { req: SignRequest; onChange: () => void }) {
  const [events, setEvents] = useState<RequestEvent[] | null>(null);
  const [intact, setIntact] = useState(true);
  const [busy, setBusy] = useState(false);
  const hasKey = !!keyFor(req.id);
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
  const saveCopy = (bytes: Uint8Array) =>
    run(async () => {
      const path = await saveBytes(bytes, `${req.title.replace(/[\\/:*?"<>|]/g, "")} (signed).pdf`);
      if (path) await openPath(path);
    });

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
                const ok = await ask(`Delete "${req.title}" and its files from DeskLab Sign now? Copies people saved are not affected.`, { title: "Delete", kind: "warning", okLabel: "Delete", cancelLabel: "Keep it" });
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
      {!hasKey && !req.filesDeleted && <KeyFromEmail req={req} onDone={onChange} />}
      {req.status === "completed" && req.filesDeleted && <p className="muted small">The files were deleted 30 days after completion; use the copy you saved.</p>}

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
