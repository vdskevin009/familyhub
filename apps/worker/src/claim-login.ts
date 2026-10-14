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
    const url = new URL(page.url());
    if (url.username || url.password || url.origin !== (insurer === "blue-cross" ? "https://service.pac.bluecross.ca" : "https://www.agea-gbim.dsf-dfs.com")) return false;
    if (await page.locator('input[type="password"]').first().isVisible().catch(() => false)) return false;
    const marker = insurer === "blue-cross"
      ? page.locator('div.caresnet-link > div.quick-nav__item--claim, table[id*="grdClaimsGrid"], input[id$="_cmbCoveredLife_Input"]')
      : page.locator('table.tableau-donnees, input[name="typeReclamation"], input[name="personneAssuree"]');
    return await marker.first().isVisible().catch(() => false);
  };
  return tryPortalLogin(page, insurer === "blue-cross" ? "bluecross" : "desjardins", ready);
}
