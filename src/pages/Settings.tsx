import { PageHeader } from "../components/Common";
import { DeskLabTools } from "../components/DeskLab";
import { api } from "../lib/api";
import { setAutoUpdate, setTheme, toastError, useAppInfo, useAutoUpdate, useTheme, type Theme } from "../lib/store";
import { checkAndDownload, installNow, useUpdate } from "../lib/updates";
import { setMarkup, useMarkup } from "../workspace/markup";

export function SettingsPage() {
  const info = useAppInfo();
  const theme = useTheme();
  const auto = useAutoUpdate();
  const st = useUpdate();
  const markup = useMarkup();
  const busy = st.kind === "checking" || st.kind === "downloading" || st.kind === "installing";

  return (
    <div className="page">
      <PageHeader title="Settings" />

      <div className="card">
        <h2>Appearance</h2>
        <div className="segmented" role="group" aria-label="Theme">
          {(["system", "light", "dark"] as Theme[]).map((t) => (
            <button key={t} className={theme === t ? "active" : ""} onClick={() => setTheme(t)}>
              {t === "system" ? "System" : t === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Comments</h2>
        <label className="field">
          <span>Your name on comments and marks</span>
          <input value={markup.author} maxLength={80} placeholder="Leave empty to add no name" onChange={(e) => setMarkup({ author: e.target.value })} />
        </label>
        <p className="muted small">Shown as the author in DeskFolio's Comments list and in Acrobat. Saved on this computer only.</p>
      </div>

      <div className="card">
        <div className="about-row">
          <div>
            <div className="about-title">
              DeskFolio <span className="muted">{info?.version}</span>
            </div>
            <div className="muted small">
              {st.kind === "idle" && (auto ? "Updates download automatically." : "Automatic updates are off.")}
              {st.kind === "checking" && "Checking GitHub for a newer version…"}
              {st.kind === "latest" && "You have the latest version."}
              {st.kind === "downloading" && `Downloading ${st.version}${st.pct != null ? ` (${st.pct}%)` : ""}…`}
              {st.kind === "ready" && `Version ${st.version} is downloaded and ready.`}
              {st.kind === "installing" && `Installing ${st.version}… DeskFolio restarts by itself.`}
              {st.kind === "error" && <span className="error-text">Couldn't update: {st.message}</span>}
            </div>
          </div>
          {st.kind === "ready" ? (
            <button className="primary" onClick={() => void installNow()}>
              Restart to update
            </button>
          ) : (
            <button disabled={busy} onClick={() => void checkAndDownload(true)}>
              Check for updates
            </button>
          )}
        </div>
        <label className="check-row">
          <input type="checkbox" checked={auto} onChange={(e) => setAutoUpdate(e.target.checked)} />
          <span>
            Download updates automatically
            <span className="muted small block">
              Checks GitHub once a day, downloads new versions in the background (signature-checked) and asks you to restart.
              That is the only time DeskFolio goes online; your PDFs never leave this computer.
            </span>
          </span>
        </label>
        <div className="more-tools">
          <DeskLabTools own="deskfolio" />
          <div className="muted small made-by">
            Open source, MIT licence. Made by Jagdeep Sandhu ·{" "}
            <button className="link" onClick={() => api.openLink("developer").catch(toastError)}>
              github.com/imjagdeep
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
