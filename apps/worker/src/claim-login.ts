import type { Page } from "playwright";
import { join } from "node:path";
import { dataDirectory, loadPrivate } from "./private-store.js";
import { tryPortalLogin, type LoginReason } from "./portal-login.js";
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
      ? candidate.locator('div.caresnet-link > div.quick-nav__item--claim, table[id*="grdClaimsGrid"], input[id$="_cmbCoveredLife_Input"]')
      : candidate.locator('table.tableau-donnees, input[name="typeReclamation"], input[name="personneAssuree"]');
    if (await marker.first().isVisible().catch(() => false)) ready.push(candidate);
  }
  return ready;
}
