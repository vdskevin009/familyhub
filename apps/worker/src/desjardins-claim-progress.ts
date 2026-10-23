import type { Page } from "playwright";
import type { ClaimPreparation } from "./claim-preparation.js";

const origin = "https://www.agea-gbim.dsf-dfs.com";
/** Only observed intermediate navigation; never consent or final confirmation. */
export async function advanceDesjardinsIntroduction(page: Page, dossier: ClaimPreparation, reserve: () => void) {
  const url = new URL(page.url());
  if (dossier.insurer !== "desjardins" || dossier.blocked || url.origin !== origin || url.username || url.password
    || url.pathname !== "/AGEA-GBIM/Reclamation/Introduction_Introduction.aspx") return false;
  const main = page.locator("main");
  if (await main.count() !== 1 || await main.getByRole("heading", { name: "Réclamation pour soins de santé", exact: true }).count() !== 1
    || await main.locator("input,select,textarea").filter({ visible: true }).count()
    || await page.locator('input[type="password"],input[autocomplete="one-time-code"]').filter({ visible: true }).count()) return false;
  const start = main.getByRole("button", { name: "Commencer", exact: true }).filter({ visible: true });
  if (await start.count() !== 1 || !await start.isEnabled()) return false;
  reserve(); await start.click({ timeout: 10000 });
  await page.waitForURL(u => u.origin === origin && u.pathname === "/AGEA-GBIM/Reclamation/TypeReclamation_TypeOfClaim.aspx", { timeout: 15000 }).catch(() => {});
  return new URL(page.url()).origin === origin && new URL(page.url()).pathname === "/AGEA-GBIM/Reclamation/TypeReclamation_TypeOfClaim.aspx";
}
