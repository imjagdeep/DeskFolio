// Tiny shared stores (no state library), same pattern as DeskZero/DeskMedic.

import { useSyncExternalStore } from "react";
import { api, errorText, type AppInfo } from "./api";

export function createStore<T>(initial: T) {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      subs.forEach((s) => s());
    },
    subscribe(fn: () => void) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

const infoStore = createStore<AppInfo | null>(null);
export const useAppInfo = () => useSyncExternalStore(infoStore.subscribe, infoStore.get);
export async function refreshAppInfo() {
  try {
    infoStore.set(await api.appInfo());
  } catch (e) {
    toastError(e);
  }
}

type Toast = { id: number; text: string; error: boolean };
const toastStore = createStore<Toast[]>([]);
export const useToasts = () => useSyncExternalStore(toastStore.subscribe, toastStore.get);
let toastId = 0;

export function toast(text: string, error = false) {
  const id = ++toastId;
  toastStore.set([...toastStore.get(), { id, text, error }]);
  window.setTimeout(() => toastStore.set(toastStore.get().filter((t) => t.id !== id)), error ? 7000 : 3500);
}

export const toastError = (e: unknown) => toast(errorText(e), true);

export type Theme = "system" | "light" | "dark";
const THEME_KEY = "deskfolio-theme";
const themeStore = createStore<Theme>(readTheme());
function readTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    // Storage unavailable: follow the system.
    return "system";
  }
}
export const useTheme = () => useSyncExternalStore(themeStore.subscribe, themeStore.get);
export function setTheme(t: Theme) {
  themeStore.set(t);
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    // Not remembered next time; the choice still applies now.
  }
}

const AUTO_UPDATE_KEY = "deskfolio-auto-update";
const autoUpdateStore = createStore<boolean>(readAutoUpdate());
function readAutoUpdate(): boolean {
  try {
    return localStorage.getItem(AUTO_UPDATE_KEY) !== "off";
  } catch {
    return true;
  }
}
export const useAutoUpdate = () => useSyncExternalStore(autoUpdateStore.subscribe, autoUpdateStore.get);
export function setAutoUpdate(on: boolean) {
  autoUpdateStore.set(on);
  try {
    localStorage.setItem(AUTO_UPDATE_KEY, on ? "on" : "off");
  } catch {
    // Applies for this session only.
  }
}
