import type { Page } from "playwright";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicJson, dataDirectory } from "./private-store.js";
import { classifyLoginScreen } from "./portal-login.js";

const profileOrigin = "https://id.desjardins.com";
const profilePath = "/staticp/gia-externe-gpap-connect/connexion/selection-profil";
const portalOrigin = "https://www.agea-gbim.dsf-dfs.com";
const attempted = new WeakSet<Page>();
export function isDesjardinsProfileSelection(url: string): boolean {
  try { const value = new URL(url); return !value.username && !value.password && value.origin === profileOrigin && value.pathname === profilePath; }
  catch { return false; }
}
export function uniqueDesjardinsProfile(labels: string[], preferred?: string): number | undefined {
  const normalize = (value: string) => value.normalize("NFKC").trim().toLowerCase();
  if (!labels.length || labels.some(value => !value.trim())) return undefined;
  if (preferred) { const matches = labels.map((value, index) => normalize(value) === normalize(preferred) ? index : -1).filter(index => index >= 0); if (matches.length === 1) return matches[0]; }
  return labels.length === 1 ? 0 : undefined;
}
export async function claimDesjardinsProfileSelection(url: string): Promise<boolean> {
  if (!isDesjardinsProfileSelection(url)) return false;
  const state = new URL(url).searchParams.get("state");
  if (!state) return false;
  const fingerprint = createHash("sha256").update(state).digest("hex");
  const path = join(dataDirectory, "desjardins", "profile-selection-control.json");
  try {
    const previous = JSON.parse(await readFile(path, "utf8"));
    if (previous.version !== 1 || typeof previous.fingerprint !== "string" || previous.fingerprint === fingerprint) return false;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false; }
  await atomicJson(path, { version: 1, fingerprint, attemptedAt: new Date().toISOString() });
  return true;
}
/** Ordinary post-password profile selection only. No token/API access, credential submit, consent or verification code. */
export async function continueDesjardinsProfileSelection(page: Page, preferred: () => Promise<string | undefined>, claim = claimDesjardinsProfileSelection): Promise<boolean> {
  if (!isDesjardinsProfileSelection(page.url()) || attempted.has(page)) return false;
  if (classifyLoginScreen(await page.locator("body").innerText().catch(() => ""))) return false;
  const form = page.locator('dsd-form[aria-label="profil-select"]');
  if (await form.count() !== 1 || !await form.isVisible()) return false;
  const tiles = await form.locator("dsd-select-tile").all();
  if (!tiles.length) return false;
  const labels = await Promise.all(tiles.map(tile => tile.innerText()));
  const chosen = uniqueDesjardinsProfile(labels, tiles.length > 1 ? await preferred() : undefined);
  if (chosen == null || !await tiles[chosen].isVisible() || !await tiles[chosen].isEnabled()) return false;
  const submit = form.locator('dsd-button[data-testid="primary-button"][type="submit"]');
  if (await submit.count() !== 1 || !await submit.isVisible() || !await submit.isEnabled() || !isDesjardinsProfileSelection(page.url())) return false;
  if (!await claim(page.url())) return false;
  attempted.add(page); // An uncertain selection/submit must never be replayed.
  await tiles[chosen].click({ timeout: 5000 });
  const checked = await tiles[chosen].evaluate(element => (element as HTMLElement & { checked?: boolean }).checked === true
    || element.getAttribute("aria-checked") === "true" || !!element.querySelector('input[type="radio"]:checked'));
  if (!checked || !isDesjardinsProfileSelection(page.url())) return false;
  await submit.click({ timeout: 10000 });
  await page.waitForURL(url => url.origin === portalOrigin, { timeout: 10000 }).catch(() => {});
  return new URL(page.url()).origin === portalOrigin;
}
