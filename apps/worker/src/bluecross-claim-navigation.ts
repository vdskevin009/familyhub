import type { Page } from "playwright";

export function isBlueCrossMemberPage(value: string) {
  const url = new URL(value);
  return url.origin === "https://service.pac.bluecross.ca" && /^\/member(?:\/|$)/i.test(url.pathname);
}

/** Open only the observed member-home navigation. Never a claim-form submit. */
export async function openBlueCrossClaimEntry(page: Page, beforeClick: () => void = () => {}): Promise<boolean> {
  const url = new URL(page.url());
  if (!isBlueCrossMemberPage(url.href) || await page.locator('input[type="password"]').isVisible().catch(() => false)) return false;
  const label = /^SUBMIT\s*CLAIMS\s*&\s*FORMS$/i;
  // Responsive home layouts can retain a hidden copy or render a different
  // wrapper. Prefer the known tile, then the exact visible label confirmed by
  // the operator. Never turn an ambiguous match into a first-element click.
  const tiles = page.locator("div.caresnet-link > div.quick-nav__item--claim").filter({ hasText: label }).filter({ visible: true });
  const text = page.getByText(label).filter({ visible: true });
  await text.first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
  if (await text.count() !== 1) return false;
  const entry = await tiles.count() ? tiles : text;
  if (page.url() !== url.href || await entry.count() !== 1 || !await entry.isVisible()) return false;
  // This informational notice is not a consent or account-setting action.
  const notice = page.getByText("Go digital to avoid mail delays", { exact: true });
  const close = page.locator(".message-modal__close-button");
  if (page.url() === url.href && await notice.count() === 1 && await notice.isVisible()
    && await close.count() === 1 && await close.isVisible()) await close.click();
  if (page.url() !== url.href) return false;
  // Navigation may open a tab or redirect this one. One click only; uncertainty
  // remains a manual handoff rather than replaying a portal action.
  const changed = page.waitForURL(u => u.href !== url.href, { timeout: 10_000 }).catch(() => {});
  const opened = page.context().waitForEvent("page", { timeout: 10_000 }).catch(() => undefined);
  beforeClick();
  await entry.click({ noWaitAfter: true, timeout: 7_000 });
  await Promise.all([changed, opened]);
  for (const tab of page.context().pages())
    await tab.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
  return true;
}
