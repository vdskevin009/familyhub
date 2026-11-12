import type { Page } from "playwright";
import { classifyLoginScreen } from "./portal-login.js";
import { blueCrossPageCategory } from "./bluecross-page-category.js";

/** One observed history-navigation click per page/context lifetime; never a login retry. */
export function createBlueCrossHistoryNavigation() {
  const attempted = new WeakSet<Page>();
  return async (page: Page): Promise<boolean> => {
    if (page.isClosed() || attempted.has(page)) return false;
    const original = page.url();
    // Some authenticated member homes retain the login path. The history control,
    // absence of password/challenge and exact origin are all required as well.
    if (!["member-home", "login"].includes(blueCrossPageCategory(original))) return false;
    const unsafe = async () => await page.locator('input[type="password"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], input[autocomplete="one-time-code"]').filter({ visible: true }).count() > 0
      || !!classifyLoginScreen(await page.locator("body").innerText());
    if (await unsafe()) return false;
    const name = /^[\uE000-\uF8FF\s]*(?:view\s+more\s+claims|(?:view\s+)?claims\s+history)[\uE000-\uF8FF\s]*$/i;
    const targets = page.getByRole("link", { name }).or(page.getByRole("button", { name })).filter({ visible: true });
    if (await targets.count() !== 1) return false;

    // This exact non-binding notice was already observed in the claim-entry flow.
    // Unknown dialogs, consent and account-update screens remain untouched.
    const notices = page.locator(".message-modal").filter({ hasText: "Go digital to avoid mail delays" }).filter({ visible: true });
    const noticeTitle = page.getByText("Go digital to avoid mail delays", { exact: true }).filter({ visible: true });
    if (await notices.count() === 1 && await noticeTitle.count() === 1) {
      const close = notices.locator('.message-modal__close-button button[data-test="close-message-btn"]').filter({ visible: true });
      if (await close.count() !== 1 || page.url() !== original) return false;
      await close.click({ timeout: 2000 });
    }
    if (page.url() !== original || await unsafe() || await targets.count() !== 1) return false;
    // Trial verifies that an unknown overlay cannot intercept the navigation.
    try { await targets.click({ trial: true, timeout: 1500 }); } catch { return false; }
    if (page.url() !== original || await targets.count() !== 1 || await unsafe()) return false;
    attempted.add(page); // A timed-out/uncertain click must never be replayed.
    await targets.click({ timeout: 3000, noWaitAfter: true });
    return true;
  };
}
