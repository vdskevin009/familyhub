import type { Page } from "playwright";
import type { ClaimPreparation } from "./claim-preparation.js";
import { classifyLoginScreen } from "./portal-login.js";

const origin = "https://www.agea-gbim.dsf-dfs.com";
export function isDesjardinsHistory(url: string) {
  try { const u = new URL(url); return !u.username && !u.password && u.origin === origin
    && u.pathname === "/AGEA-GBIM/Rclmtn/RclmtnTrt/HistoriqueReclamation_ClaimHistory.aspx"; }
  catch { return false; }
}
/** The public insurer guide names these navigation entries. Resolve their
 * actual destination from the visible owned page, never a guessed deep link.
 * https://www.desjardins.com/fr/aide/assurances/reclamation-ligne-collective.html
 */
export async function openDesjardinsClaimEntry(page: Page, dossier: ClaimPreparation, reserve: () => void): Promise<boolean> {
  if (dossier.insurer !== "desjardins" || dossier.blocked || !isDesjardinsHistory(page.url())
    || await page.locator('table.tableau-donnees').filter({ visible: true }).count() !== 1
    || await page.locator('input[type="password"],input[autocomplete="one-time-code"],iframe[src*="recaptcha"],iframe[src*="hcaptcha"]').filter({ visible: true }).count()
    || classifyLoginScreen(await page.locator('body').innerText())) return false;
  const entry = page.getByRole("link", { name: /^Réclamation en ligne$/i }).filter({ visible: true });
  let reserved = false;
  if (await entry.count() === 0) {
    const menu = page.getByRole("link", { name: /^Faire une réclamation$/i }).filter({ visible: true });
    if (await menu.count() !== 1 || !await menu.isEnabled()) return false;
    reserve(); reserved = true;
    await menu.click({ timeout: 5000 });
    await entry.first().waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  }
  if (!isDesjardinsHistory(page.url()) || await entry.count() !== 1 || !await entry.isEnabled()) return false;
  const href = await entry.getAttribute("href");
  if (!href) return false;
  const target = new URL(href, page.url());
  if (target.username || target.password || target.origin !== origin
    || !/^\/AGEA-GBIM\/Reclamation\/[A-Za-z_]+\.aspx$/.test(target.pathname)) return false;
  if (!reserved) reserve();
  await entry.click({ timeout: 10000 });
  await page.waitForURL(url => url.origin === origin && url.pathname === target.pathname, { timeout: 10000 }).catch(() => {});
  const landed = new URL(page.url());
  return landed.origin === origin && landed.pathname === target.pathname;
}