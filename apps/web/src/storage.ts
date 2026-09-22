import { useCallback, useEffect, useState } from "react";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeWithFallback<T>(fallback: T, stored: unknown): T {
  if (Array.isArray(fallback)) {
    return (Array.isArray(stored) ? stored : fallback) as T;
  }

  if (isRecord(fallback)) {
    if (!isRecord(stored)) return fallback;
    const merged: Record<string, unknown> = { ...stored };
    for (const [key, fallbackValue] of Object.entries(fallback)) {
      merged[key] = mergeWithFallback(fallbackValue, stored[key]);
    }
    return merged as T;
  }

  if (fallback === null) {
    return (stored === undefined ? fallback : stored) as T;
  }

  if (stored === undefined || stored === null || typeof stored !== typeof fallback) {
    return fallback;
  }

  return stored as T;
}

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return mergeWithFallback(fallback, JSON.parse(raw));
  } catch (error) {
    console.warn(`FamilyHub ignored invalid local data for ${key}`, error);
    return fallback;
  }
}

export function saveJson<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`FamilyHub could not persist ${key}`, error);
  }
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
