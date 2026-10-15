import type { Page } from "playwright";
import type { ClaimPreparation } from "./claim-preparation.js";
import { blueCrossSuggestion } from "./bluecross-claim-form.js";

export const claimKindHeading = "What kind of claim would you like to submit?";
const choices = [/^Healthcare$/i, /^Drugs$/i, /^Vision\s+Care$/i, /^Dental\s*\(Orthodontic\)$/i,
  /^I\s+don['’]t\s+see\s+the\s+expense\s+listed$/i];
const trusted = (page: Page) => new URL(page.url()).origin === "https://service.pac.bluecross.ca";
export async function isBlueCrossClaimKindPage(page: Page) {
  if (!trusted(page)) return false;
  const heading = page.getByText(claimKindHeading, { exact: true }).filter({ visible: true });
  return await heading.count() === 1;
}

/** Select only the observed Healthcare entry for already-supported receipt services. */
export async function openBlueCrossHealthcareClaim(page: Page, dossier: ClaimPreparation, beforeClick: () => void = () => {}) {
  if (dossier.blocked || !await isBlueCrossClaimKindPage(page)
    || await page.locator('input[type="password"]').filter({ visible: true }).count()) return false;
  const service = blueCrossSuggestion("service", dossier, [
    { value: "chiropractic", label: "Chiropractic - In Person - Subsequent Treatment" },
    { value: "physiotherapy", label: "Physiotherapy Treatment - 30 Minutes" }
  ]);
  if (!service) return false;
  const url = page.url();
  for (const label of choices) {
    if (await page.getByText(label).filter({ visible: true }).count() !== 1) return false;
  }
  const entry = page.getByText(choices[0]).filter({ visible: true });
  if (!await entry.isEnabled() || page.url() !== url) return false;
  const heading = page.getByText(claimKindHeading, { exact: true }).filter({ visible: true });
  const changed = heading.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
  const opened = page.context().waitForEvent("page", { timeout: 10_000 }).then(async tab => {
    await tab.waitForURL(value => value.origin === "https://service.pac.bluecross.ca", { timeout: 10_000 }).catch(() => {});
  }).catch(() => {});
  // Reserve the choice before dispatch; an uncertain result cannot be replayed.
  beforeClick();
  await entry.click({ noWaitAfter: true, timeout: 7000 });
  await Promise.race([changed, opened]);
  for (const tab of page.context().pages())
    await tab.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
  return true;
}
