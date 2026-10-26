import type { Cookie, Page } from "playwright";
import { claimPortals } from "./claim-preparation.js";
import { classifyLoginScreen } from "./portal-login.js";
import { desjardinsSessionExpired } from "./desjardins-history-reader.js";
import { join } from "node:path";
import { atomicJson, dataDirectory } from "./private-store.js";
const replacements = new WeakMap<Page, Page>();
export function currentDesjardinsPage(page: Page) {
  while (replacements.has(page)) page = replacements.get(page)!;
  return page;
}
/** Existing OneTrust privacy choices only, never an authentication/session cookie.
 * https://docs.onetrust.com/en/consent--preferences/cookie-consent/managing-cookie-scripts-cookie-blocking-and-technical-implementation/onetrust-cookies */
export function desjardinsConsentCookies(cookies: Cookie[], now = Date.now()) {
  return cookies.filter(cookie => ["OptanonConsent", "OptanonAlertBoxClosed"].includes(cookie.name)
    && /(?:^|\.)(?:desjardins\.com|dsf-dfs\.com)$/i.test(cookie.domain)
    && (cookie.expires < 0 || cookie.expires > now / 1000));
}

/** Positive insurer expiry evidence only; never act on a challenge or a claim form. */
export async function restartableDesjardinsExpiry(page: Page) {
  if (page.isClosed() || page.context().pages().filter(p => !p.isClosed()).length !== 1
    || !await desjardinsSessionExpired(page)) return false;
  const body = await page.locator("body").innerText();
  if (classifyLoginScreen(body) || await page.locator('table.tableau-donnees,input:not([type="hidden"]):not([type="button"]):not([type="submit"]),select,textarea,iframe[src*="recaptcha"],iframe[src*="hcaptcha"]').filter({ visible: true }).count()) return false;
  const heading = /^(?:Session expirée|Expired session)(?:\s*[-–]\s*(?:Session expirée|Expired session))?$/i;
  return heading.test((await page.title()).trim())
    || (await page.locator("h1,h2").filter({ visible: true }).allTextContents()).some(text => heading.test(text.trim()));
}

/** One ordinary authentication entry, reserved before navigation. No credential or guard changes. */
export async function reopenExpiredDesjardinsSession(page: Page, reserve: () => boolean) {
  const browser = page.context().browser();
  if (!browser || !await restartableDesjardinsExpiry(page) || !reserve()) return false;
  const observedAt = new Date().toISOString();
  let consentPreferencesReused = 0;
  const record = (stage: string) => atomicJson(join(dataDirectory, "desjardins", "session-expiry-diagnostic.json"), { version: 1, observedAt, stage, consentPreferencesReused }).catch(() => {});
  await record("authentication-entry-started");
  // The old context has an initialization script restoring expired sessionStorage.
  // A fresh isolated context discards that script and stale ephemeral cookies,
  // while leaving encrypted saved state, credentials and retry controls intact.
  let fresh: Page;
  try {
    const consent = desjardinsConsentCookies(await page.context().cookies());
    const context = await browser.newContext();
    await context.addCookies(consent);
    consentPreferencesReused = consent.length;
    fresh = await context.newPage();
    replacements.set(page, fresh);
    await page.context().close();
    await fresh.goto(claimPortals.desjardins, { waitUntil: "domcontentloaded", timeout: 30_000 });
  }
  catch (error) { await record("navigation-uncertain"); throw error; }
  await record("authentication-entry-complete");
  return fresh;
}
