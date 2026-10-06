import type { Page } from "playwright";

const origin = "https://www.agea-gbim.dsf-dfs.com";
const historyPath = /HistoriqueReclamation_ClaimHistory\.aspx/i;

/** Read-only navigation after ordinary login. Does not submit credentials or clear retry protection. */
export async function desjardinsHistoryReady(page: Page): Promise<boolean> {
  const trusted = () => { try { return new URL(page.url()).origin === origin; } catch { return false; } };
  if (!trusted()) return false;
  if (!historyPath.test(page.url())) {
    const history = page.getByRole("link", { name: /^(r[ée]clamations trait[ée]es|processed claims|claims history|historique des r[ée]clamations)$/i }).first();
    if (!await history.isVisible().catch(() => false)) {
      const menu = page.getByRole("link", { name: /^(historique|history)$/i }).first();
      if (!await menu.isVisible().catch(() => false) || !trusted()) return false;
      await menu.click();
      if (!trusted()) return false;
      await history.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    }
    if (!trusted() || !await history.isVisible().catch(() => false)) return false;
    await history.click();
    await page.waitForURL(historyPath, { timeout: 10000 }).catch(() => {});
  }
  return trusted() && historyPath.test(page.url())
    && await page.locator("table.tableau-donnees").isVisible().catch(() => false);
}
