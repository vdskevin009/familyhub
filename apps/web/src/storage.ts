import { useCallback, useEffect, useState } from "react";

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) } as T;
  } catch {
    return fallback;
  }
}

export function saveJson<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function useStoredState<T>(key: string, fallback: T): [T, (value: T | ((previous: T) => T)) => void] {
  const [state, setState] = useState<T>(() => loadJson(key, fallback));

  const update = useCallback((value: T | ((previous: T) => T)) => {
    setState(previous => {
      const next = typeof value === "function" ? (value as (previous: T) => T)(previous) : value;
      saveJson(key, next);
      return next;
    });
  }, [key]);

  useEffect(() => {
    saveJson(key, state);
  }, [key, state]);

  return [state, update];
}

export function downloadJson(name: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readJsonFile<T>(file: File): Promise<T> {
  const raw = await file.text();
  return JSON.parse(raw) as T;
}

export function uid(): string {
  return crypto.randomUUID();
}
