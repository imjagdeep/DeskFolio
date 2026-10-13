// The Account page: optional DeskLab sign-in. Same file in every DeskLab app.
// `app` is this app's name (for the explanation), `toast` shows a message.

import { useEffect, useState } from "react";
import { accountApi, ago, appName, forgetAccount, osName, refreshAccount, useAccount } from "./account";

type Step = { kind: "email" } | { kind: "code"; email: string } | { kind: "password" };

const errText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "Something went wrong.");

export function AccountPage({ app, toast }: { app: string; toast: (text: string, error?: boolean) => void }) {
  const status = useAccount();
  const [loading, setLoading] = useState(status === null);

  useEffect(() => {
    refreshAccount()
      .catch((e) => toast(errText(e), true))
      .finally(() => setLoading(false));
  }, [toast]);

  return (
    <div className="page account-page">
      <header className="page-header">
        <div className="page-title">
          <h1>Account</h1>
          <div className="page-subtitle">Optional. {app} works fully without one.</div>
        </div>
      </header>
      {loading && !status && <div className="card muted">Checking…</div>}
      {status && !status.signed_in && <SignIn app={app} toast={toast} />}
      {status?.signed_in && <SignedIn toast={toast} />}
    </div>
  );
}

function SignIn({ app, toast }: { app: string; toast: (text: string, error?: boolean) => void }) {
  const [step, setStep] = useState<Step>({ kind: "email" });
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const signedIn = async () => {
    await refreshAccount();
    toast("Signed in to DeskLab");
  };

  return (
    <div className="card account-card">
      <h2>Sign in to DeskLab</h2>
      <p className="muted small">
        One DeskLab account for every DeskLab app. It lets your settings follow you to another computer, lets you send feedback, and
        (coming soon) back up to an encrypted space only you can open. Without it, {app} works exactly the same and nothing leaves this
        computer.
      </p>

      {step.kind === "email" && (
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await accountApi.sendCode(email.trim());
              setCode("");
              setStep({ kind: "code", email: email.trim() });
            });
          }}
        >
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required autoFocus />
          </label>
          <div className="account-actions">
            <button className="primary" disabled={busy || !email.trim()}>
              {busy ? "Sending…" : "Email me a code"}
            </button>
            <button type="button" className="link" onClick={() => setStep({ kind: "password" })}>
              Use a password instead
            </button>
          </div>
          <p className="muted small">New here? The code creates your account. No password needed.</p>
        </form>
      )}

      {step.kind === "code" && (
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await accountApi.verify(step.email, code);
              await signedIn();
            });
          }}
        >
          <p>
            We sent a 6-digit code to <strong>{step.email}</strong>. It works for 10 minutes.
          </p>
          <label className="field">
            <span>Code</span>
            <input
              className="code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))}
              placeholder="123456"
              autoFocus
            />
          </label>
          <div className="account-actions">
            <button className="primary" disabled={busy || code.replace(/\s/g, "").length !== 6}>
              {busy ? "Checking…" : "Sign in"}
            </button>
            <button
              type="button"
              className="link"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await accountApi.sendCode(step.email);
                  toast("New code sent");
                })
              }
            >
              Send a new code
            </button>
            <button type="button" className="link" onClick={() => setStep({ kind: "email" })}>
              Different email
            </button>
          </div>
        </form>
      )}

      {step.kind === "password" && (
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await accountApi.login(email.trim(), password);
              setPassword("");
              await signedIn();
            });
          }}
        >
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <div className="account-actions">
            <button className="primary" disabled={busy || !email.trim() || !password}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <button type="button" className="link" onClick={() => setStep({ kind: "email" })}>
              Email me a code instead
            </button>
          </div>
          <p className="muted small">Forgot your password? Sign in with an email code, then set a new one here.</p>
        </form>
      )}

      {error && <div className="account-error" role="alert">{error}</div>}
    </div>
  );
}

function SignedIn({ toast }: { toast: (text: string, error?: boolean) => void }) {
  const status = useAccount();
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState({ next: "", current: "" });
  const [pwOpen, setPwOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  if (!status) return null;
  const user = status.user;

  const act = async (fn: () => Promise<void>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast(done);
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="card account-card">
        <div className="account-who">
          <div className="avatar" aria-hidden="true">
            {(status.email ?? "?").slice(0, 1).toUpperCase()}
          </div>
          <div>
            <div className="account-email">{status.email}</div>
            <div className="muted small">
              {status.offline
                ? "Signed in. DeskLab can't be reached right now; your account details will show when it can."
                : user
                  ? `DeskLab account since ${new Date(user.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" })}`
                  : ""}
            </div>
          </div>
          <button disabled={busy} onClick={() => void act(async () => {
            await accountApi.logout();
            forgetAccount();
          }, "Signed out")}>
            Sign out
          </button>
        </div>
      </div>

      {!status.offline && (
        <div className="card">
          <h2>Signed in on</h2>
          <div className="device-list">
            {status.devices.map((d) => (
              <div className="device-row" key={d.id}>
                <div>
                  <strong>{d.name}</strong> <span className="muted small">· {appName(d.app)} on {osName(d.os)}</span>
                  <div className="muted small">{d.this_device ? "This app, on this computer" : `Last used ${ago(d.last_seen_at)}`}</div>
                </div>
                {!d.this_device && (
                  <button className="small-btn" disabled={busy} onClick={() => void act(async () => {
                    await accountApi.signOutDevice(d.id);
                    await refreshAccount();
                  }, `Signed out ${d.name}`)}>
                    Sign out
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {user && (
        <div className="card">
          <h2>Password</h2>
          <p className="muted small">
            {user.has_password
              ? "You can sign in with your password or with an email code."
              : "You sign in with an email code. Add a password if you'd rather type one."}
          </p>
          {!pwOpen ? (
            <div className="account-actions">
              <button onClick={() => setPwOpen(true)}>{user.has_password ? "Change password" : "Add a password"}</button>
              {user.has_password && (
                <button className="link" disabled={busy} onClick={() => void act(async () => {
                  await accountApi.removePassword();
                  await refreshAccount();
                }, "Password removed: you'll sign in with email codes")}>
                  Remove password
                </button>
              )}
            </div>
          ) : (
            <form
              className="account-form"
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  await accountApi.setPassword(pw.next, user.has_password && pw.current ? pw.current : null);
                  setPw({ next: "", current: "" });
                  setPwOpen(false);
                  await refreshAccount();
                }, "Password saved");
              }}
            >
              {user.has_password && (
                <label className="field">
                  <span>Current password (not needed if you just signed in with a code)</span>
                  <input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
                </label>
              )}
              <label className="field">
                <span>New password (at least 10 characters)</span>
                <input type="password" autoComplete="new-password" minLength={10} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required autoFocus />
              </label>
              <div className="account-actions">
                <button className="primary" disabled={busy || pw.next.length < 10}>Save password</button>
                <button type="button" className="link" onClick={() => setPwOpen(false)}>Cancel</button>
              </div>
            </form>
          )}
        </div>
      )}

      {user && (
        <div className="card danger-card">
          <h2>Delete account</h2>
          <p className="muted small">
            Deletes your DeskLab account and everything stored for it on DeskLab's server, straight away. Your apps and files on your
            computers stay as they are.
          </p>
          {!deleting ? (
            <button className="danger" onClick={() => setDeleting(true)}>Delete my account…</button>
          ) : (
            <form
              className="account-form"
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  await accountApi.deleteAccount(confirm);
                  forgetAccount();
                }, "Your DeskLab account is deleted");
              }}
            >
              <label className="field">
                <span>Type your email to confirm</span>
                <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={user.email} autoFocus />
              </label>
              <div className="account-actions">
                <button className="danger" disabled={busy || confirm.trim().toLowerCase() !== user.email.toLowerCase()}>Delete everything</button>
                <button type="button" className="link" onClick={() => setDeleting(false)}>Keep my account</button>
              </div>
            </form>
          )}
        </div>
      )}
    </>
  );
}
