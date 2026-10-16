import type { Page } from "playwright";
import type { ClaimPreparation } from "./claim-preparation.js";
import { calendarDate, memberName } from "./healthcare-evidence.js";

const trusted = (page: Page) => {
  const url = new URL(page.url());
  return url.origin === "https://service.pac.bluecross.ca" && url.pathname === "/ACESWeb/Pages/Claims/eClaim.aspx";
};
const uploadBox = (page: Page) => page.locator('[id$="_ucSubmitClaim_radAsyncUpload"]').filter({ visible: true });
export async function blueCrossReceiptFile(page: Page) {
  if (!trusted(page)) return null;
  for (const name of ["Claim Documentation Required", "Upload Documents"])
    if (await page.getByRole("heading", { name, exact: true }).filter({ visible: true }).count() !== 1) return null;
  const box = uploadBox(page);
  if (await box.count() !== 1) return null;
  const file = box.locator('input[type="file"][id*="_radAsyncUploadfile"]').filter({ visible: true });
  return await file.count() === 1 && await file.isEnabled() ? file : null;
}

/** Read the visible single source-matched expense; no navigation or upload. */
export async function blueCrossExpenseRow(page: Page, dossier: ClaimPreparation) {
  if (!trusted(page) || dossier.blocked || dossier.attachments.length !== 1) return null;
  const grid = page.locator('table[id$="_ucClaimExpenseGrid_grdExpenseGrid"]').filter({ visible: true });
  if (await grid.count() !== 1) return null;
  const rows = await grid.locator("tr").evaluateAll(els => els.filter(el => el.getClientRects().length)
    .map(el => Array.from(el.querySelectorAll("td")).map(cell => cell.innerText.replace(/\s+/g, " ").trim()))
    .filter(cells => cells.length === 7));
  if (rows.length !== 1) return null;
  const row = rows[0], date = calendarDate(dossier.fields.serviceDate?.slice(0, 10));
  const displayDate = date && `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8))}, ${date.slice(0, 4)}`;
  const amount = row[5].replace(/^\$/, "").replace(/,/g, "");
  return !!date && row[4] === displayDate && memberName(row[0]) !== "unknown" && memberName(row[0]) === dossier.fields.patient
    && /^\d+\.\d{2}$/.test(amount) && dossier.fields.originalAmount != null
    && Math.round(Number(amount) * 100) === Math.round(dossier.fields.originalAmount * 100) ? row : null;
}

/** Match the visible single expense before attaching a permanent receipt. */
export async function blueCrossReceiptMatches(page: Page, dossier: ClaimPreparation) {
  if (!await blueCrossExpenseRow(page, dossier)) return false;
  const consent = page.locator('input[type="checkbox"][id$="_ucSubmitClaim_chkConsent"]').filter({ visible: true });
  return await consent.count() === 1 && !await consent.isChecked();
}

export async function openBlueCrossReceiptUpload(page: Page, dossier: ClaimPreparation, reserve: () => void) {
  if (!await blueCrossReceiptMatches(page, dossier) || await blueCrossReceiptFile(page)) return false;
  if (await page.getByRole("heading", { name: "Additional Information Required", exact: true }).filter({ visible: true }).count() !== 1) return false;
  const consent = page.locator('input[type="checkbox"][id$="_ucSubmitClaim_chkConsent"]').filter({ visible: true });
  if (await consent.count() !== 1 || await consent.isChecked()) return false;
  const button = page.locator('input[id$="_ucSubmitClaim_btnUploadReceipt"], button[id$="_ucSubmitClaim_btnUploadReceipt"]').filter({ visible: true });
  if (await button.count() !== 1 || !await button.isEnabled()
    || !/^Upload my documents$/i.test(await button.evaluate(el => el instanceof HTMLInputElement ? el.value : (el.textContent || "").trim()))) return false;
  reserve();
  await button.click({ noWaitAfter: true, timeout: 7000 });
  await page.getByRole("heading", { name: "Claim Documentation Required", exact: true }).waitFor({ state: "visible", timeout: 10_000 });
  return true;
}

/** Read-only watch: does not navigate, reserve or transmit any document. */
export async function blueCrossReceiptUploadAvailable(page: Page, dossier: ClaimPreparation) {
  if (!await blueCrossReceiptMatches(page, dossier)) return false;
  if (await blueCrossReceiptFile(page)) return !await blueCrossReceiptAlreadyListed(page, dossier.attachments[0].name);
  if (await page.getByRole("heading", { name: "Additional Information Required", exact: true }).filter({ visible: true }).count() !== 1) return false;
  const button = page.locator('input[id$="_ucSubmitClaim_btnUploadReceipt"], button[id$="_ucSubmitClaim_btnUploadReceipt"]').filter({ visible: true });
  return await button.count() === 1 && await button.isEnabled()
    && /^Upload my documents$/i.test(await button.evaluate(el => el instanceof HTMLInputElement ? el.value : (el.textContent || "").trim()));
}

export async function blueCrossReceiptAlreadyListed(page: Page, name: string) {
  if (!await blueCrossReceiptFile(page)) return false;
  return (await uploadBox(page).locator("li").allTextContents()).some(text => text.includes(name));
}

/** Telerik's visible named success span represents its green upload check.
 * https://www.telerik.com/teststudio/documentation/api/telerik.webaii.controls.html.asyncuploadconstants
 */
export async function blueCrossReceiptUploadEvidence(page: Page, name: string): Promise<"verified" | "unverified" | "failed"> {
  if (!await blueCrossReceiptFile(page)) return "unverified";
  const rows = await uploadBox(page).locator("li").evaluateAll(els => els.filter(el => el.getClientRects().length).map(el => ({
    text: el.textContent || "",
    failure: Array.from(el.querySelectorAll(".ruUploadFailure")).some(span => span.getClientRects().length),
    success: Array.from(el.querySelectorAll(".ruUploadSuccess")).filter(span => span.getClientRects().length).map(span => (span.textContent || "").trim())
  })));
  if (rows.some(row => row.text.includes(name) && row.failure)) return "failed";
  return rows.flatMap(row => row.success).filter(text => text === name).length === 1 ? "verified" : "unverified";
}
