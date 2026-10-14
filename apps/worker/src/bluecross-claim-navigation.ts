import type { Page } from "playwright";

/** Open only the observed member-home navigation. Never a claim-form submit. */
export async function openBlueCrossClaimEntry(page: Page, beforeClick: () => void = () => {}): Promise<boolean> {
  const url = new URL(page.url());
  if (url.origin !== "https://service.pac.bluecross.ca" || !/^\/member\/?$/i.test(url.pathname)) return false;
  const entry = page.locator("div.caresnet-link > div.quick-nav__item--claim").filter({ hasText: /^SUBMIT\s*CLAIMS\s*&\s*FORMS$/i });
  await entry.first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
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
