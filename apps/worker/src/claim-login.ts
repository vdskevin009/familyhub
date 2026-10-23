import type { Page } from "playwright";
import type { LoginRecoveryRequest } from "./portal-login-recovery.js";
import { join } from "node:path";
import { dataDirectory, savePrivate } from "./private-store.js";
import { authenticatedPortal, classifyLoginScreen, tryPortalLogin, type LoginReason } from "./portal-login.js";
import { blueCrossAuthCookies, blueCrossSessionMarker } from "./bluecross-collector.js";
import { continueDesjardinsSignIn } from "./desjardins-signin.js";
import { desjardinsHistoryReady } from "./desjardins-navigation.js";
import { desjardinsRadioField } from "./desjardins-claim-form.js";
import { desjardinsAuthCookies } from "./desjardins-collector.js";

/** Uses the same guarded DPAPI login as collection, under the caller's portal lock. */
export async function loginForClaim(page: Page, insurer: "blue-cross" | "desjardins", recovery?: LoginRecoveryRequest): Promise<LoginReason | undefined> {
  const ready = async () => {
    if ((await authenticatedClaimPages(page, insurer)).length === 1) return true;
    if (insurer === "desjardins") {
      const continuation = await continueDesjardinsSignIn(page);
      if (!(await authenticatedClaimPages(page, insurer)).length) await desjardinsHistoryReady(continuation);
    }
    return (await authenticatedClaimPages(page, insurer)).length === 1;
  };
  const reason = await tryPortalLogin(page, insurer === "blue-cross" ? "bluecross" : "desjardins", ready, undefined, recovery);
  if (!reason && insurer === "desjardins") {
    const pages = await authenticatedClaimPages(page, insurer);
    if (pages.length === 1) await preserveDesjardinsClaimSession(pages[0]);
  }
  return reason;
}

/** Login can open a new tab; require unique visible authenticated evidence in this context. */
export async function authenticatedClaimPages(page: Page, insurer: "blue-cross" | "desjardins") {
  const ready: Page[] = [];
  for (const candidate of page.context().pages().filter(p => !p.isClosed())) {
    let url: URL;
    try { url = new URL(candidate.url()); } catch { continue; }
    if (url.username || url.password || url.origin !== (insurer === "blue-cross" ? "https://service.pac.bluecross.ca" : "https://www.agea-gbim.dsf-dfs.com")) continue;
    if (await candidate.locator('input[type="password"]').first().isVisible().catch(() => false)) continue;
    if (insurer === "desjardins" && (await candidate.locator('input[type="password"]').filter({ visible: true }).count()
      || classifyLoginScreen(await candidate.locator("body").innerText().catch(() => ""))
      || await candidate.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], input[autocomplete="one-time-code"]').filter({ visible: true }).count())) continue;
    const desjardinsSelector = /^\/AGEA-GBIM\/Rclmtn\/RclmtnTrt\/HistoriqueReclamation_ClaimHistory\.aspx$/i.test(url.pathname)
      ? "table.tableau-donnees" : desjardinsRadioField(url.pathname)?.name;
    if (insurer === "desjardins" && !desjardinsSelector) continue;
    const marker = insurer === "blue-cross"
      ? candidate.locator('div.caresnet-link > div.quick-nav__item--claim, table[id*="grdClaimsGrid"], input[id$="_cmbCoveredLife_Input"], input[id$="_ucClaimType_optHealth"], input[id$="_ucClaimCause_optClaimCauseNo"]')
      : candidate.locator(desjardinsSelector === "table.tableau-donnees" ? desjardinsSelector : `input[name="${desjardinsSelector}"]`);
    if (insurer === "desjardins" && desjardinsSelector === "table.tableau-donnees" && await marker.count() !== 1) continue;
    if (await marker.first().isVisible().catch(() => false)) ready.push(candidate);
  }
  return ready;
}

/** Refresh only the already-authorized protected session after a server claim form.
 * No passwords, claim fields, personal Chrome profile or browser history are saved. */
export async function preserveBlueCrossClaimSession(page: Page, save: typeof savePrivate = savePrivate, authenticated: typeof authenticatedPortal = authenticatedPortal) {
  const url = new URL(page.url());
  if (url.origin !== "https://service.pac.bluecross.ca" || url.pathname !== "/ACESWeb/Pages/Claims/eClaim.aspx"
    || await page.locator('input[type="password"]').filter({ visible: true }).count()) return false;
  if (classifyLoginScreen(await page.locator("body").innerText())
    || await page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], input[autocomplete="one-time-code"]').filter({ visible: true }).count()) return false;
  const marker = page.locator('input[id$="_ucClaimType_optHealth"], input[id$="_ucClaimCause_optClaimCauseNo"], input[id$="_cmbCoveredLife_Input"]').filter({ visible: true });
  if (!await marker.count()) return false;
  const cookies = blueCrossAuthCookies(await page.context().cookies());
  const state = await page.evaluate(() => ({ origin: location.origin, value: sessionStorage.getItem("pbcMemberProfileData") }));
  const value = blueCrossSessionMarker(state.origin, state.value);
  if (!cookies.length || !value) return false;
  await save(join(dataDirectory, "bluecross", "auth-state.dpapi"), { cookies, session: { origin: url.origin, value } });
  await authenticated("bluecross");
  return true;
}

/** Save the same protected insurer state after verified history or an observed claim form.
 * Selection screens and generic portal tables never establish authentication. */
export async function preserveDesjardinsClaimSession(page: Page, save: typeof savePrivate = savePrivate, authenticated: typeof authenticatedPortal = authenticatedPortal) {
  const pages = await authenticatedClaimPages(page, "desjardins");
  if (pages.length !== 1 || pages[0] !== page) return false;
  const cookies = desjardinsAuthCookies(await page.context().cookies());
  const session = await page.evaluate(() => ({ origin: location.origin,
    values: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => {
      const key = sessionStorage.key(index)!;
      return [key, sessionStorage.getItem(key) || ""];
    })) }));
  if (!cookies.length || session.origin !== "https://www.agea-gbim.dsf-dfs.com"
    || Object.keys(session.values).length > 100 || JSON.stringify(session.values).length > 100_000) return false;
  await save(join(dataDirectory, "desjardins", "auth-state.dpapi"), { cookies, session });
  await authenticated("desjardins");
  return true;
}
