// Agreements: documents you sent for signature, where each one stands, and
// what you can do (send again, cancel, finish, get the signed copy).

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../components/Common";
import { refreshAccount, useAccount } from "../account/account";
import { openPath, saveBytes } from "../lib/doc";
import { cancelRequest, deleteRequest, dueNow, finalCopy, finishHere, keyFor, listRequests, requestDetail, resend, type RequestEvent, type SignRequest } from "../lib/sign/requests";
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

export function Agreements() {
  const account = useAccount();
  const [list, setList] = useState<SignRequest[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const reload = useCallback(() => {
    listRequests()
      .then(setList)
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
              <span className={`ag-status ${tone(r.status)}`}>{STATUS[r.status]}</span>
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
            Save the signed copy…
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
      {!hasKey && <p className="muted small">This request was sent from another computer (or this app's data was reset), so its files can't be opened here. The links in the emails still work.</p>}
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
