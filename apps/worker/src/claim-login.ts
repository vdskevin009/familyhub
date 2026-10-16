import type { Page } from "playwright";
import { join } from "node:path";
import { dataDirectory, loadPrivate, savePrivate } from "./private-store.js";
import { authenticatedPortal, classifyLoginScreen, tryPortalLogin, type LoginReason } from "./portal-login.js";
import { blueCrossAuthCookies, blueCrossSessionMarker } from "./bluecross-collector.js";
import { continueDesjardinsProfileSelection } from "./desjardins-profile-selection.js";

/** Uses the same guarded DPAPI login as collection, under the caller's portal lock. */
export async function loginForClaim(page: Page, insurer: "blue-cross" | "desjardins"): Promise<LoginReason | undefined> {
  const ready = async () => {
    if (insurer === "desjardins") await continueDesjardinsProfileSelection(page, async () => {
      try {
        const p = await loadPrivate<{ version: number; profile: string }>(join(dataDirectory, "desjardins", "profile-preference.dpapi"));
        if (p.version !== 1 || typeof p.profile !== "string" || !p.profile.trim()) throw new Error();
        return p.profile;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw new Error("Saved insurer profile preference cannot be unlocked.");
      }
    });
    return (await authenticatedClaimPages(page, insurer)).length === 1;
  };
  return tryPortalLogin(page, insurer === "blue-cross" ? "bluecross" : "desjardins", ready);
}

/** Login can open a new tab; require unique visible authenticated evidence in this context. */
export async function authenticatedClaimPages(page: Page, insurer: "blue-cross" | "desjardins") {
  const ready: Page[] = [];
  for (const candidate of page.context().pages().filter(p => !p.isClosed())) {
    const url = new URL(candidate.url());
    if (url.username || url.password || url.origin !== (insurer === "blue-cross" ? "https://service.pac.bluecross.ca" : "https://www.agea-gbim.dsf-dfs.com")) continue;
    if (await candidate.locator('input[type="password"]').first().isVisible().catch(() => false)) continue;
    const marker = insurer === "blue-cross"
      ? candidate.locator('div.caresnet-link > div.quick-nav__item--claim, table[id*="grdClaimsGrid"], input[id$="_cmbCoveredLife_Input"], input[id$="_ucClaimType_optHealth"], input[id$="_ucClaimCause_optClaimCauseNo"]')
      : candidate.locator('table.tableau-donnees, input[name="typeReclamation"], input[name="personneAssuree"]');
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
