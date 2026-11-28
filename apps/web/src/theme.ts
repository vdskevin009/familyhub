import { useSyncExternalStore } from "react";

export type Appearance = "system" | "light" | "dark";
const key = "familyhub.appearance.v1";
const asAppearance = (value: string | null): Appearance => value === "light" || value === "dark" ? value : "system";
const media = window.matchMedia("(prefers-color-scheme: dark)");
const subscribers = new Set<() => void>();
let appearance: Appearance;
try { appearance = asAppearance(localStorage.getItem(key)); } catch { appearance = "system"; }

function apply() {
  const active = appearance === "system" ? media.matches ? "dark" : "light" : appearance;
  document.documentElement.dataset.theme = active;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", active === "dark" ? "#10141c" : "#f5f6f8");
}

export function setAppearance(next: Appearance) {
  if (appearance === next) return;
  appearance = next;
  try { localStorage.setItem(key, next); } catch { /* The choice still works until this page closes. */ }
  apply();
  for (const emit of subscribers) emit();
}

function subscribe(emit: () => void) {
  subscribers.add(emit);
  return () => { subscribers.delete(emit); };
}

export function useAppearance() {
  return useSyncExternalStore(subscribe, () => appearance, () => "system" as const);
}

export function startAppearance() {
  apply();
  media.addEventListener("change", () => { if (appearance === "system") apply(); });
  window.addEventListener("storage", event => {
    if (event.key !== key && event.key !== null) return;
    const next = asAppearance(event.newValue);
    if (appearance === next) return;
    appearance = next;
    apply();
    for (const emit of subscribers) emit();
  });
}
