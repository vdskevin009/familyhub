import type { Page } from "playwright";
import type { ClaimPreparation } from "./claim-preparation.js";
import { blueCrossExpenseRow } from "./bluecross-claim-upload.js";
import { blueCrossSuggestion } from "./bluecross-claim-form.js";
const trusted = (page: Page) => {
  const url = new URL(page.url());
  return url.origin === "https://service.pac.bluecross.ca" && url.pathname === "/ACESWeb/Pages/Claims/eClaim.aspx";
};
const detail = (page: Page) => page.locator('input[id$="_txtAmount"], input[id$="_cmbCoveredLife_Input"]').filter({ visible: true });
async function nextButton(page: Page) {
  if (!trusted(page) || await page.locator('input[id$="_ucSubmitClaim_chkConsent"]').filter({ visible: true }).count()) return null;
  const next = page.locator('input[id$="_StepNavigationTemplateContainerID_StepNextButton"], button[id$="_StepNavigationTemplateContainerID_StepNextButton"]').filter({ visible: true });
  return await next.count() === 1 && await next.isEnabled()
    && await next.and(page.getByRole("button", { name: /^Next$/i })).count() === 1
    && await page.getByRole("button", { name: /^Next$/i }).filter({ visible: true }).count() === 1 ? next : null;
}
/** Called only after all known source/owner answers were freshly read back. */
export async function advanceBlueCrossDetails(page: Page, ready: boolean, reserve: () => void) {
  if (!ready || !trusted(page) || await page.getByRole("heading", { name: "Claim Details", exact: true }).filter({ visible: true }).count() !== 1 || !await detail(page).count()) return false;
  const next = await nextButton(page); if (!next) return false;
  reserve(); await next.click({ noWaitAfter: true, timeout: 7000 });
  await page.getByRole("heading", { name: "Your Expenses", exact: true }).filter({ visible: true }).waitFor({ state: "visible", timeout: 10_000 }); return true;
}
/** Read the unique source-matched expense row without changing the portal. */
export async function readBlueCrossExpenseSummary(page: Page, dossier: ClaimPreparation, illness: string | undefined, verifiedPractitioner?: string) {
  const row = await blueCrossExpenseRow(page, dossier); if (!row || !illness) return null;
  const normalize = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim();
  const matches = normalize(row[6]) === normalize(illness)
    && !!blueCrossSuggestion("benefit", dossier, [{ value: row[1], label: row[1] }])
    && !!blueCrossSuggestion("service", dossier, [{ value: row[3], label: row[3] }])
    && !!blueCrossSuggestion("practitioner", { ...dossier, fields: { ...dossier.fields, practitioner: dossier.fields.practitioner || verifiedPractitioner?.split(/\s+-\s+/)[0] || null } }, [{ value: row[2], label: row[2] }]);
  return { matches, patient: row[0], benefit: row[1], practitioner: row[2], service: row[3], date: row[4], amount: row[5], illness: row[6] };
}

/** This Next only opens the review page; it never accepts consent or submits. */
export async function advanceBlueCrossExpenses(page: Page, dossier: ClaimPreparation, illness: string | undefined, reserve: () => void, verifiedPractitioner?: string) {
  if (!trusted(page) || !illness || await detail(page).count()
    || await page.getByRole("heading", { name: "Your Expenses", exact: true }).filter({ visible: true }).count() !== 1) return false;
  if (!(await readBlueCrossExpenseSummary(page, dossier, illness, verifiedPractitioner))?.matches) return false;
  const next = await nextButton(page); if (!next) return false;
  reserve(); await next.click({ noWaitAfter: true, timeout: 7000 });
  await page.getByRole("heading", { name: "Additional Information Required", exact: true }).filter({ visible: true }).waitFor({ state: "visible", timeout: 10_000 }); return true;
}
