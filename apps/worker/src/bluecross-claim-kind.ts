import type { Page } from "playwright";
import type { ClaimPreparation } from "./claim-preparation.js";
import { supportedHealthcareService } from "./bluecross-claim-form.js";

export const claimKindHeading = "What kind of claim would you like to submit?";
const choices = [/^Health\s*Care$/i, /^Drugs$/i, /^Vision\s+Care$/i, /^Dental\s*\(Orthodontic\)$/i,
  /^I\s+don['’]t\s+see\s+the\s+expense\s+listed$/i];
const trusted = (page: Page) => new URL(page.url()).origin === "https://service.pac.bluecross.ca";
const details = (page: Page) => page.locator('input[id$="_txtAmount"], input[id$="_cmbCoveredLife_Input"]').filter({ visible: true });
export async function isBlueCrossClaimKindPage(page: Page) {
  if (!trusted(page) || await details(page).count()) return false;
  const body = await page.locator("body").innerText();
  if (/review (?:your )?claim|claim summary|your claim has been (?:processed|submitted)|I confirm all the information above/i.test(body)) return false;
  const heading = page.getByText(claimKindHeading, { exact: true }).filter({ visible: true });
  return await heading.count() === 1;
}

/** Advance only the observed initial category chooser, before any claim fields. */
export async function openBlueCrossHealthcareClaim(page: Page, dossier: ClaimPreparation, beforeClick: () => void = () => {}) {
  if (dossier.blocked || !await isBlueCrossClaimKindPage(page)
    || await page.locator('input[type="password"]').filter({ visible: true }).count()) return false;
  if (!supportedHealthcareService(dossier.fields.service)) return false;
  const url = page.url();
  const controls = choices.map(name => page.getByRole("checkbox", { name }).or(page.getByRole("radio", { name })).filter({ visible: true }));
  for (const control of controls) if (await control.count() !== 1) return false;
  const entry = controls[0];
  for (const control of controls.slice(1)) if (await control.isChecked()) return false;
  const next = page.getByRole("button", { name: /^Next$/i }).or(page.getByRole("link", { name: /^Next$/i })).filter({ visible: true });
  if (await next.count() !== 1 || !await entry.isEnabled() || page.url() !== url) return false;
  // Reserve both actions before dispatch. An uncertain selection or navigation
  // cannot be replayed by resume, and check() preserves an existing selection.
  beforeClick();
  await entry.check({ timeout: 7000 });
  if (page.url() !== url || !await isBlueCrossClaimKindPage(page) || !await entry.isChecked()
    || await next.count() !== 1 || !await next.isEnabled()) return false;
  for (const control of controls.slice(1)) if (await control.isChecked()) return false;
  const causeReady = page.locator('input[id$="_ucClaimCause_optClaimCauseNo"]').filter({ visible: true }).waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
  const ready = details(page).first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
  const opened = page.context().waitForEvent("page", { timeout: 10_000 }).then(async tab => {
    await tab.waitForURL(value => value.origin === "https://service.pac.bluecross.ca", { timeout: 10_000 }).catch(() => {});
  }).catch(() => {});
  // This Next belongs only to category navigation, never prepared claim fields.
  await next.click({ noWaitAfter: true, timeout: 7000 });
  await Promise.race([causeReady, ready, opened]);
  for (const tab of page.context().pages())
    await tab.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
  return true;
}
