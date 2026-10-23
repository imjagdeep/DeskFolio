// Request signatures: who signs (in order or all at once), where each of
// them fills in what, then send through DeskLab Sign. The PDF is encrypted
// here; the key stays on this computer and in the signing links.

import { useEffect, useMemo, useRef, useState } from "react";
import type { PageViewport } from "pdfjs-dist";
import { PageHeader } from "../components/Common";
import { CloseIcon, PlusIcon } from "../components/Icons";
import { refreshAccount, useAccount } from "../account/account";
import { flushPending, useDoc, type OpenDoc } from "../lib/doc";
import type { FieldKind } from "../lib/sign/envelope";
import { sendRequest, type DraftField, type Person } from "../lib/sign/requests";
import { toast, toastError } from "../lib/store";
import { markupState, setMarkup } from "../workspace/markup";
import { go } from "../workspace/route";

const COLORS = ["#2563eb", "#db2777", "#16a34a", "#ea580c", "#7c3aed", "#0891b2", "#ca8a04", "#dc2626"];
const KINDS: { kind: FieldKind; label: string; size: [number, number] }[] = [
  { kind: "signature", label: "Signature", size: [170, 42] },
  { kind: "initials", label: "Initials", size: [64, 32] },
  { kind: "date", label: "Date signed", size: [110, 18] },
  { kind: "name", label: "Name", size: [160, 18] },
  { kind: "text", label: "Text", size: [160, 18] },
  { kind: "checkbox", label: "Checkbox", size: [14, 14] },
];
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
let seq = 1;
const nextId = (p: string) => `${p}${seq++}`;

type Placed = DraftField;

function useViewports(doc: OpenDoc, width: number) {
  const [vps, setVps] = useState<PageViewport[]>([]);
  useEffect(() => {
    let live = true;
    (async () => {
      const out: PageViewport[] = [];
      for (let i = 1; i <= doc.pdf.numPages; i++) {
        const page = await doc.pdf.getPage(i);
        const base = page.getViewport({ scale: 1 });
        out.push(page.getViewport({ scale: width / base.width }));
      }
      if (live) setVps(out);
    })().catch(toastError);
    return () => {
      live = false;
    };
  }, [doc.pdf, doc.rev, width]);
  return vps;
}

function PageCanvas({ doc, index, viewport }: { doc: OpenDoc; index: number; viewport: PageViewport }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    let task: { cancel(): void } | null = null;
    (async () => {
      const page = await doc.pdf.getPage(index + 1);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.floor(viewport.width * dpr);
      c.height = Math.floor(viewport.height * dpr);
      const r = page.render({ canvas: c, viewport, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] });
      task = r;
      await r.promise;
    })().catch((e: unknown) => {
      if (!(e instanceof Error && e.name === "RenderingCancelledException")) toastError(e);
    });
    return () => task?.cancel();
  }, [doc.pdf, index, viewport]);
  return <canvas ref={ref} className="rs-canvas" style={{ width: viewport.width, height: viewport.height }} aria-hidden="true" />;
}

export function RequestSign() {
  const doc = useDoc();
  const account = useAccount();
  useEffect(() => {
    refreshAccount().catch(() => undefined);
  }, []);
  if (!doc) return null;
  if (!account?.signed_in) {
    return (
      <div className="page">
        <PageHeader title="Request signatures" subtitle="Send this PDF to people to sign in their browser." />
        <div className="card">
          <h2>Sign in to send for signature</h2>
          <p className="muted small">
            Requests go through your free DeskLab account, so you can follow them and get the signed copy. The document is encrypted on this computer before it is uploaded; the key
            is kept here and in the signing links, never on our server.
          </p>
          <button className="primary" onClick={() => go("account")}>
            Sign in to DeskLab…
          </button>
        </div>
      </div>
    );
  }
  return <Composer key={doc.id} doc={doc} accountEmail={account.email ?? ""} />;
}

/** "jordan.lee@example.com" -> "Jordan Lee": a starting guess for the sender's name. */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  return local
    .split(/[._-]+/)
    .filter((w) => /^[a-z]+$/i.test(w))
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function Composer({ doc, accountEmail }: { doc: OpenDoc; accountEmail: string }) {
  const [people, setPeople] = useState<Person[]>([{ local: nextId("p"), name: "", email: "", role: "signer", position: 1 }]);
  const [fields, setFields] = useState<Placed[]>([]);
  const [who, setWho] = useState<string>(people[0].local);
  const [kind, setKind] = useState<FieldKind>("signature");
  const [selected, setSelected] = useState<string | null>(null);
  const [title, setTitle] = useState(doc.name.replace(/\.pdf$/i, ""));
  const [message, setMessage] = useState("");
  // Signers see this name ("Jordan Lee asks you to sign"); kept as your author name.
  const [fromName, setFromName] = useState(() => markupState().author.trim() || nameFromEmail(accountEmail));
  const [sequential, setSequential] = useState(true);
  const [reminderDays, setReminderDays] = useState(3);
  const [expiresDays, setExpiresDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [width, setWidth] = useState(720);
  const pagesRef = useRef<HTMLDivElement>(null);
  const viewports = useViewports(doc, width);

  useEffect(() => {
    const el = pagesRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(320, Math.min(860, el.clientWidth - 24))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const signers = people.filter((p) => p.role === "signer");
  const color = (local: string) => COLORS[Math.max(0, people.findIndex((p) => p.local === local)) % COLORS.length];
  const personOf = (local: string) => people.find((p) => p.local === local);

  const setPerson = (local: string, patch: Partial<Person>) => setPeople(people.map((p) => (p.local === local ? { ...p, ...patch } : p)));
  const addPerson = (role: "signer" | "cc") => {
    const p: Person = { local: nextId("p"), name: "", email: "", role, position: role === "cc" ? 99 : Math.max(0, ...signers.map((s) => s.position)) + 1 };
    setPeople([...people, p]);
    if (role === "signer") setWho(p.local);
  };
  const removePerson = (local: string) => {
    const rest = people.filter((p) => p.local !== local);
    setPeople(rest);
    setFields(fields.filter((f) => f.person !== local));
    if (who === local) setWho(rest.find((p) => p.role === "signer")?.local ?? "");
  };
  const move = (local: string, dir: -1 | 1) => {
    const list = [...signers].sort((a, b) => a.position - b.position);
    const i = list.findIndex((p) => p.local === local);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    const pos = new Map(list.map((p, k) => [p.local, k + 1]));
    setPeople(people.map((p) => (pos.has(p.local) ? { ...p, position: pos.get(p.local) ?? p.position } : p)));
  };

  // ---------- placing fields ----------
  const drag = useRef<{ id: string; mode: "move" | "size"; page: number; x: number; y: number; css: { left: number; top: number; width: number; height: number } } | null>(null);

  const toPdf = (page: number, x: number, y: number): [number, number] | null => {
    const vp = viewports[page];
    if (!vp) return null;
    const [px, py] = vp.convertToPdfPoint(x, y);
    return [px, py];
  };
  const toCss = (page: number, rect: [number, number, number, number]) => {
    const vp = viewports[page];
    if (!vp) return null;
    const [ax, ay] = vp.convertToViewportPoint(rect[0], rect[1]);
    const [bx, by] = vp.convertToViewportPoint(rect[2], rect[3]);
    return { left: Math.min(ax, bx), top: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
  };

  const placeAt = (page: number, e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || !who) return;
    const box = e.currentTarget.getBoundingClientRect();
    const k = KINDS.find((x) => x.kind === kind) ?? KINDS[0];
    const scale = (viewports[page]?.scale ?? 1);
    const w = k.size[0] * scale;
    const h = k.size[1] * scale;
    const x = Math.max(0, Math.min(box.width - w, e.clientX - box.left - w / 2));
    const y = Math.max(0, Math.min(box.height - h, e.clientY - box.top - h / 2));
    const a = toPdf(page, x, y + h);
    const b = toPdf(page, x + w, y);
    if (!a || !b) return;
    const f: Placed = { local: nextId("f"), person: who, kind, page, rect: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])], required: kind !== "checkbox", ...(kind === "text" ? { label: "" } : {}) };
    setFields([...fields, f]);
    setSelected(f.local);
  };

  const onPointerDown = (f: Placed, mode: "move" | "size", e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelected(f.local);
    const css = toCss(f.page, f.rect);
    if (css) drag.current = { id: f.local, mode, page: f.page, x: e.clientX, y: e.clientY, css };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const vp = d && viewports[d.page];
    if (!d || !vp) return;
    // Work on screen; convert the corners back (right for rotated pages too).
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    const c = d.css;
    const box =
      d.mode === "move"
        ? { left: Math.max(0, Math.min(vp.width - c.width, c.left + dx)), top: Math.max(0, Math.min(vp.height - c.height, c.top + dy)), width: c.width, height: c.height }
        : { left: c.left, top: c.top, width: Math.max(10, Math.min(vp.width - c.left, c.width + dx)), height: Math.max(10, Math.min(vp.height - c.top, c.height + dy)) };
    const [ax, ay] = vp.convertToPdfPoint(box.left, box.top + box.height);
    const [bx, by] = vp.convertToPdfPoint(box.left + box.width, box.top);
    const rect: [number, number, number, number] = [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
    setFields((all) => all.map((f) => (f.local === d.id ? { ...f, rect } : f)));
  };
  const onPointerUp = () => (drag.current = null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selected && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        setFields((all) => all.filter((f) => f.local !== selected));
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const sel = fields.find((f) => f.local === selected) ?? null;

  // ---------- checks and sending ----------
  const problems = useMemo(() => {
    const out: string[] = [];
    if (!title.trim()) out.push("Give the request a title.");
    if (!fromName.trim()) out.push("Add your name, so people know who's asking.");
    if (!signers.length) out.push("Add someone who signs.");
    for (const p of people) {
      if (!p.name.trim()) out.push("Every person needs a name.");
      else if (!EMAIL.test(p.email.trim())) out.push(`Check the email address for ${p.name.trim()}.`);
    }
    const emails = people.map((p) => `${p.email.trim().toLowerCase()}:${p.role}`);
    if (new Set(emails).size !== emails.length) out.push("Someone is in the list twice.");
    for (const s of signers) if (!fields.some((f) => f.person === s.local)) out.push(`Place at least one field for ${s.name.trim() || "each signer"}.`);
    return [...new Set(out)];
  }, [title, fromName, people, signers, fields]);

  const send = async () => {
    const names = signers.map((s) => s.name.trim()).join(", ");
    const { ask } = await import("@tauri-apps/plugin-dialog");
    const ok = await ask(`Send "${title.trim()}" for signature? ${names} will get an email from DeskLab Sign with a private link${sequential && signers.length > 1 ? ", one after another" : ""}.`, {
      title: "Send for signature",
      okLabel: "Send",
      cancelLabel: "Not yet",
    });
    if (!ok) return;
    setBusy(true);
    if (fromName.trim() !== markupState().author.trim()) setMarkup({ author: fromName.trim() });
    try {
      await flushPending();
      const r = await sendRequest({
        pdf: doc.bytes,
        title: title.trim(),
        ownerName: fromName.trim(),
        message: message.trim(),
        sequential,
        reminderDays,
        expiresDays,
        people: people.map((p) => ({ ...p, name: p.name.trim(), email: p.email.trim() })),
        fields,
      });
      toast(r.failed.length ? "Sent, but an email couldn't be delivered; use Send again in Agreements." : "Sent for signature.");
      go("agreements");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const ordered = [...signers].sort((a, b) => a.position - b.position);
  return (
    <div className="page wide rs-compose">
      <PageHeader title="Request signatures" subtitle="People sign in their browser; nothing to install. You get the signed copy with a certificate of completion.">
        <button className="primary" disabled={busy || problems.length > 0} title={problems[0]} onClick={() => void send()}>
          {busy ? "Sending…" : "Send"}
        </button>
      </PageHeader>
      <div className="rs-grid">
        <aside className="rs-side">
          <section className="card">
            <h2>People</h2>
            {ordered.map((p, i) => (
              <div key={p.local} className={who === p.local ? "rs-person on" : "rs-person"} onClick={() => setWho(p.local)}>
                <span className="rs-dot" style={{ background: color(p.local) }} />
                <div className="rs-person-fields">
                  <input value={p.name} placeholder={`Signer ${i + 1} name`} aria-label="Name" onChange={(e) => setPerson(p.local, { name: e.target.value })} />
                  <input value={p.email} placeholder="Email" type="email" aria-label="Email" onChange={(e) => setPerson(p.local, { email: e.target.value })} />
                </div>
                <div className="rs-person-actions">
                  {sequential && signers.length > 1 && (
                    <>
                      <button className="icon" title="Earlier" aria-label="Sign earlier" onClick={() => move(p.local, -1)} disabled={i === 0}>
                        ↑
                      </button>
                      <button className="icon" title="Later" aria-label="Sign later" onClick={() => move(p.local, 1)} disabled={i === ordered.length - 1}>
                        ↓
                      </button>
                    </>
                  )}
                  <button className="icon" title="Remove" aria-label="Remove" onClick={() => removePerson(p.local)}>
                    <CloseIcon size={12} />
                  </button>
                </div>
              </div>
            ))}
            {people
              .filter((p) => p.role === "cc")
              .map((p) => (
                <div key={p.local} className="rs-person cc">
                  <span className="rs-dot cc" />
                  <div className="rs-person-fields">
                    <input value={p.name} placeholder="Name (gets a copy)" aria-label="Name" onChange={(e) => setPerson(p.local, { name: e.target.value })} />
                    <input value={p.email} placeholder="Email" type="email" aria-label="Email" onChange={(e) => setPerson(p.local, { email: e.target.value })} />
                  </div>
                  <div className="rs-person-actions">
                    <button className="icon" title="Remove" aria-label="Remove" onClick={() => removePerson(p.local)}>
                      <CloseIcon size={12} />
                    </button>
                  </div>
                </div>
              ))}
            <div className="row">
              <button className="with-icon" onClick={() => addPerson("signer")} disabled={people.length >= 20}>
                <PlusIcon size={13} /> Signer
              </button>
              <button className="with-icon" onClick={() => addPerson("cc")} disabled={people.length >= 20}>
                <PlusIcon size={13} /> Gets a copy
              </button>
            </div>
            <label className="check-row">
              <input type="checkbox" checked={sequential} onChange={(e) => setSequential(e.target.checked)} />
              <span>Sign in this order (one after another)</span>
            </label>
          </section>

          <section className="card">
            <h2>Fields</h2>
            <p className="muted small">Pick a person and a field, then click on the page. Drag to move, use the corner to resize, Delete to remove.</p>
            <div className="rs-kinds">
              {KINDS.map((k) => (
                <button key={k.kind} className={kind === k.kind ? "rs-kind on" : "rs-kind"} onClick={() => setKind(k.kind)}>
                  {k.label}
                </button>
              ))}
            </div>
            {who && (
              <p className="small">
                Placing for <b style={{ color: color(who) }}>{personOf(who)?.name.trim() || "this signer"}</b>
              </p>
            )}
            {sel && (
              <div className="rs-selected">
                <div className="small">
                  <b>{KINDS.find((k) => k.kind === sel.kind)?.label}</b> for {personOf(sel.person)?.name.trim() || "signer"} · page {sel.page + 1}
                </div>
                {sel.kind === "text" && (
                  <input value={sel.label ?? ""} placeholder="What to type (e.g. Job title)" onChange={(e) => setFields(fields.map((f) => (f.local === sel.local ? { ...f, label: e.target.value } : f)))} />
                )}
                <label className="check-row">
                  <input type="checkbox" checked={sel.required} onChange={(e) => setFields(fields.map((f) => (f.local === sel.local ? { ...f, required: e.target.checked } : f)))} />
                  <span>Required</span>
                </label>
                <button className="danger" onClick={() => (setFields(fields.filter((f) => f.local !== sel.local)), setSelected(null))}>
                  Remove field
                </button>
              </div>
            )}
          </section>

          <section className="card">
            <h2>Message</h2>
            <label className="field">
              <span>Your name</span>
              <input value={fromName} maxLength={80} placeholder="Shown to the people who sign" onChange={(e) => setFromName(e.target.value)} />
            </label>
            <label className="field">
              <span>Title</span>
              <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="field">
              <span>Message (optional)</span>
              <textarea rows={3} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} />
            </label>
            <div className="form-row">
              <label className="field">
                <span>Remind every</span>
                <select value={reminderDays} onChange={(e) => setReminderDays(Number(e.target.value))}>
                  <option value={0}>Never</option>
                  <option value={1}>1 day</option>
                  <option value={2}>2 days</option>
                  <option value={3}>3 days</option>
                  <option value={7}>7 days</option>
                </select>
              </label>
              <label className="field">
                <span>Expires after</span>
                <select value={expiresDays} onChange={(e) => setExpiresDays(Number(e.target.value))}>
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                  <option value={60}>60 days</option>
                  <option value={120}>120 days</option>
                </select>
              </label>
            </div>
            <p className="muted small">
              People see "{fromName.trim() || "…"} asks you to sign". Replies go to {accountEmail || "your DeskLab email"}.
            </p>
          </section>
        </aside>

        <div className="rs-pages" ref={pagesRef} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
          {viewports.map((vp, i) => (
            <div key={i} className="rs-page" style={{ width: vp.width, height: vp.height }} onClick={(e) => placeAt(i, e)}>
              <PageCanvas doc={doc} index={i} viewport={vp} />
              {fields
                .filter((f) => f.page === i)
                .map((f) => {
                  const css = toCss(i, f.rect);
                  if (!css) return null;
                  const c = color(f.person);
                  return (
                    <div
                      key={f.local}
                      className={selected === f.local ? "rs-field on" : "rs-field"}
                      style={{ ...css, borderColor: c, background: `color-mix(in srgb, ${c} 14%, transparent)`, color: c }}
                      onPointerDown={(e) => onPointerDown(f, "move", e)}
                      title={`${KINDS.find((k) => k.kind === f.kind)?.label} · ${personOf(f.person)?.name || "signer"}`}
                    >
                      <span className="rs-field-label">{f.kind === "checkbox" ? "✓" : `${KINDS.find((k) => k.kind === f.kind)?.label}${f.required ? "" : " (optional)"}`}</span>
                      {f.kind !== "checkbox" && <span className="rs-handle" onPointerDown={(e) => onPointerDown(f, "size", e)} />}
                    </div>
                  );
                })}
              <span className="rs-page-no">{i + 1}</span>
            </div>
          ))}
        </div>
      </div>
      {/* Always in view, wherever you are on the pages: what's missing, or who gets it. */}
      <div className="rs-sendbar">
        <span className={problems.length ? "rs-sendbar-text warn" : "rs-sendbar-text"}>
          {problems.length
            ? `${problems[0]}${problems.length > 1 ? ` (+${problems.length - 1} more)` : ""}`
            : `Ready: ${ordered.map((p) => p.name.trim()).join(sequential && ordered.length > 1 ? ", then " : " and ")} ${ordered.length === 1 ? "gets" : "get"} a private link by email.`}
        </span>
        <button className="primary" disabled={busy || problems.length > 0} onClick={() => void send()}>
          {busy ? "Sending…" : "Send for signature"}
        </button>
      </div>
    </div>
  );
}
