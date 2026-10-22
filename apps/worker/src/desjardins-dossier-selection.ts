import type { Page } from "playwright";
import { classifyLoginScreen } from "./portal-login.js";
import { readLoginControl } from "./portal-login.js";
import { atomicJson, dataDirectory } from "./private-store.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const origin = "https://www.agea-gbim.dsf-dfs.com";
const path = "/AGEA-GBIM/Athntfctn/AccsDssrAdhrnt/SelectionDossierAdherent_SelectMemberFile.aspx";
const attempted = new WeakSet<Page>();
export type DossierChoice = { index: number; active: boolean; inactive: boolean; buttons: number; enabled: boolean };

/** The existing profile lock serializes this marker. A crash after reservation cannot replay the choice. */
export async function claimActiveDossierSelection(): Promise<boolean> {
  const control = await readLoginControl("desjardins");
  if (!control.attemptedAt) return false;
  const file = join(dataDirectory, "desjardins", "dossier-selection-control.json");
  try {
    const previous = JSON.parse(await readFile(file, "utf8"));
    if (previous.version !== 1 || typeof previous.loginAttemptedAt !== "string") return false;
    if (previous.loginAttemptedAt === control.attemptedAt) return false;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false; }
  await atomicJson(file, { version: 1, loginAttemptedAt: control.attemptedAt, attemptedAt: new Date().toISOString() });
  return true;
}

export function isDesjardinsDossierSelection(url: string): boolean {
  try { const value = new URL(url); return !value.username && !value.password && value.origin === origin && value.pathname === path; }
  catch { return false; }
}
export function uniqueActiveDossier(choices: DossierChoice[]): number | undefined {
  const active = choices.filter(choice => choice.active);
  if (active.length !== 1 || active[0].inactive || active[0].buttons !== 1 || !active[0].enabled) return undefined;
  return active[0].index;
}

/** Visible contract status only; identifiers, member names and source values stay in the browser. */
export async function inspectDesjardinsDossiers(page: Page): Promise<DossierChoice[]> {
  if (!isDesjardinsDossierSelection(page.url())) return [];
  return page.locator("div.panel-dossier").evaluateAll(panels => panels.flatMap((panel, index) => {
    const visible = (node: Element) => node.getClientRects().length > 0;
    if (!visible(panel)) return [];
    const bodies = panel.querySelectorAll(".panel-body-dossier");
    if (bodies.length !== 1 || !visible(bodies[0])) return [{ index, active: false, inactive: false, buttons: 0, enabled: false }];
    const text = (bodies[0] as HTMLElement).innerText.normalize("NFKC");
    const buttons = Array.from(panel.querySelectorAll<HTMLInputElement>('input[type="submit"][id*="grdListeAdherent"][id$="ChoisirButton"]'))
      .filter(button => visible(button) && /^(Choisir|Choose|Select)$/i.test(button.value.trim()));
    return [{ index, active: /\b(?:ACTIF|ACTIVE)\b/i.test(text), inactive: /\b(?:INACTIF|INACTIVE|TERMIN[ÉE]|TERMINATED|EXPIR[ÉE]|EXPIRED)\b/i.test(text),
      buttons: buttons.length, enabled: buttons.length === 1 && !buttons[0].disabled }];
  }));
}

/** One visible dossier choice per page. Never fill credentials or establish authentication from a selection alone. */
export async function continueDesjardinsDossierSelection(page: Page, claim = claimActiveDossierSelection): Promise<boolean> {
  if (!isDesjardinsDossierSelection(page.url()) || attempted.has(page)) return false;
  if (classifyLoginScreen(await page.locator("body").innerText().catch(() => ""))) return false;
  const index = uniqueActiveDossier(await inspectDesjardinsDossiers(page));
  if (index == null || !isDesjardinsDossierSelection(page.url())) return false;
  const button = page.locator("div.panel-dossier").nth(index)
    .locator('input[type="submit"][id*="grdListeAdherent"][id$="ChoisirButton"]');
  if (await button.count() !== 1 || !await button.isVisible() || !await button.isEnabled()) return false;
  const current = uniqueActiveDossier(await inspectDesjardinsDossiers(page));
  if (current !== index || !isDesjardinsDossierSelection(page.url())) return false;
  if (!await claim()) return false;
  attempted.add(page); // Do not replay an uncertain click in this session.
  // Issue one click; observe its redirect with a separate bound. Never replay
  // the selection merely because the portal's postback is slow.
  await button.click({ timeout: 10_000, noWaitAfter: true });
  await page.waitForURL(url => url.origin === origin && url.pathname !== path, { timeout: 15_000 }).catch(() => {});
  try { const value = new URL(page.url()); return value.origin === origin && value.pathname !== path; }
  catch { return false; }
}
