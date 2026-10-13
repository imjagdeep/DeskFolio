// The optional DeskLab account, as the page sees it. Every call goes through
// the app's Rust side (account.rs), which holds the tokens; the page never
// sees one. Same file in every DeskLab app.

import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";

export interface AccountUser {
  id: string;
  email: string;
  has_password: boolean;
  created_at: string;
}

export interface AccountDevice {
  id: string;
  app: string;
  os: string;
  name: string;
  created_at: string;
  last_seen_at: string;
  this_device: boolean;
}

export interface AccountStatus {
  signed_in: boolean;
  email: string | null;
  /** Signed in, but DeskLab couldn't be reached just now. */
  offline: boolean;
  user: AccountUser | null;
  devices: AccountDevice[];
}

export const accountApi = {
  status: () => invoke<AccountStatus>("account_status"),
  sendCode: (email: string) => invoke<void>("account_send_code", { email }),
  verify: (email: string, code: string) => invoke<void>("account_verify", { email, code }),
  login: (email: string, password: string) => invoke<void>("account_login", { email, password }),
  logout: () => invoke<void>("account_logout"),
  setPassword: (password: string, current: string | null) => invoke<void>("account_set_password", { password, current }),
  removePassword: () => invoke<void>("account_remove_password"),
  signOutDevice: (id: string) => invoke<void>("account_sign_out_device", { id }),
  deleteAccount: (confirm: string) => invoke<void>("account_delete", { confirm }),
};

// ---------- a small store so the sidebar and the page agree ----------
let current: AccountStatus | null = null;
const subs = new Set<() => void>();
const set = (s: AccountStatus | null) => {
  current = s;
  subs.forEach((f) => f());
};
export const useAccount = () =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => current,
  );

/** Ask the app where things stand (also after any change). */
export async function refreshAccount(): Promise<AccountStatus> {
  const s = await accountApi.status();
  set(s);
  return s;
}

export function forgetAccount() {
  set({ signed_in: false, email: null, offline: false, user: null, devices: [] });
}

/** "Windows", "macOS", "Linux" */
export function osName(os: string): string {
  return os === "windows" ? "Windows" : os === "macos" ? "macOS" : os === "linux" ? "Linux" : os;
}

export function appName(app: string): string {
  const names: Record<string, string> = { deskzero: "DeskZero", deskmedic: "DeskMedic", deskfolio: "DeskFolio", deskshot: "DeskShot" };
  return names[app] ?? app;
}

/** "3 minutes ago", "yesterday", "12 Oct 2026" */
export function ago(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 90) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 14) return `${d} days ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
