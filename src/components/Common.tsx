import { useEffect, useRef, useState } from "react";
import { usePasswordAsk } from "../lib/doc";
import { useToasts } from "../lib/store";
import type { IconType } from "./Icons";

export function Toasts() {
  const toasts = useToasts();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={t.error ? "toast error" : "toast"}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-title">
        <h1>{title}</h1>
        {subtitle && <div className="page-subtitle">{subtitle}</div>}
      </div>
      <div className="page-actions">{children}</div>
    </header>
  );
}

/** Centred empty state with an icon, a line of text and an optional action. */
export function Empty({ Icon, title, text, children }: { Icon: IconType; title: string; text?: string; children?: React.ReactNode }) {
  return (
    <div className="empty empty-big">
      <Icon size={34} />
      <div className="empty-title">{title}</div>
      {text && <div className="muted small">{text}</div>}
      {children && <div className="empty-actions">{children}</div>}
    </div>
  );
}

/** Asks for a PDF's password when doc.ts needs one. */
export function PasswordDialog() {
  const ask = usePasswordAsk();
  const [pw, setPw] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setPw("");
    input.current?.focus();
  }, [ask]);
  if (!ask) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="pw-h">
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          ask.answer(pw);
        }}
      >
        <h2 id="pw-h">Password needed</h2>
        <p className="muted">
          {ask.wrong ? "That password didn't open it. Try again." : `${ask.name} is protected with a password.`}
        </p>
        <input ref={input} type="password" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Password" />
        <div className="modal-actions">
          <button type="button" onClick={() => ask.answer(null)}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!pw}>
            Open
          </button>
        </div>
      </form>
    </div>
  );
}
