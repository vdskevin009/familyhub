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
  await page.waitForURL(u => u.origin === origin && u.pathname === "/AGEA-GBIM/Reclamation/TypeReclamation_TypeOfClaim.aspx", { timeout: 30000, waitUntil: "domcontentloaded" });
  await page.locator('main input[type="radio"][name="typeReclamation"]').first().waitFor({ state: "visible", timeout: 30000 });
  return new URL(page.url()).origin === origin && new URL(page.url()).pathname === "/AGEA-GBIM/Reclamation/TypeReclamation_TypeOfClaim.aspx";
}

export async function advanceDesjardinsRadio(page: Page, ready: boolean, reserve: () => void) {
  const url = new URL(page.url());
  const group = url.pathname === "/AGEA-GBIM/Reclamation/TypeReclamation_TypeOfClaim.aspx" ? "typeReclamation"
    : url.pathname === "/AGEA-GBIM/Reclamation/PersonneAssuree_InsuredPerson.aspx" ? "personneAssuree"
    : url.pathname === "/AGEA-GBIM/Reclamation/Fournisseur/ListeFournisseur_ProviderList.aspx" ? "fournisseur" : null;
  if (!ready || !group || url.origin !== origin || url.username || url.password) return false;
  const main = page.locator("main"), choices = main.locator(`input[type="radio"][name="${group}"]`).filter({ visible: true });
  if (await main.count() !== 1 || await choices.evaluateAll((els: HTMLInputElement[]) => els.filter(e => e.checked).length) !== 1
    || await main.locator('input[type="radio"]').filter({ visible: true }).count() !== await choices.count()
    || await main.locator('input:not([type="radio"]):not([type="hidden"]):not([type="submit"]):not([type="button"]),select,textarea').filter({ visible: true }).count()) return false;
  const next = main.getByRole("button", { name: "Continuer", exact: true }).filter({ visible: true });
  if (await next.count() !== 1 || !await next.isEnabled()) return false;
  reserve(); await next.click({ timeout: 10000 });
  await page.waitForURL(u => u.origin === origin && u.pathname !== url.pathname && /^\/AGEA-GBIM\/Reclamation\/(?:[A-Za-z_]+\/)*[A-Za-z_]+\.aspx$/.test(u.pathname), { timeout: 30000, waitUntil: "domcontentloaded" });
  const nextGroup = group === "typeReclamation" ? "personneAssuree" : group === "personneAssuree" ? "fournisseur" : null;
  if (nextGroup) await page.locator(`main input[type="radio"][name="${nextGroup}"]`).first().waitFor({ state: "visible", timeout: 30000 });
  else await page.locator('main input:not([type="hidden"]), main select, main textarea').filter({ visible: true }).first().waitFor({ state: "visible", timeout: 30000 });
  return new URL(page.url()).origin === origin && new URL(page.url()).pathname !== url.pathname;
}
