import type { Page } from "playwright";
import { classifyLoginScreen } from "./portal-login.js";
import { blueCrossPageCategory } from "./bluecross-page-category.js";

/** One observed history-navigation click per page/context lifetime; never a login retry. */
export function createBlueCrossHistoryNavigation() {
  const attempted = new WeakSet<Page>();
  const state = { stage: "not-started", visibleHistoryControls: 0, knownNoticeVisible: false, welcomeVisible: false, visibleModal: false, attempted: false };
  const navigate = async (page: Page): Promise<boolean> => {
    if (page.isClosed()) { state.stage="page-closed"; return false; }
    if (attempted.has(page)) return false;
    Object.assign(state, { stage: "observing", visibleHistoryControls: 0, knownNoticeVisible: false, welcomeVisible: false, visibleModal: false, attempted: false });
    const original = page.url();
    // Some authenticated member homes retain the login path. The history control,
    // absence of password/challenge and exact origin are all required as well.
    if (!["member-home", "login"].includes(blueCrossPageCategory(original))) { state.stage="outside-member-home"; return false; }
    const unsafe = async () => await page.locator('input[type="password"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], input[autocomplete="one-time-code"]').filter({ visible: true }).count() > 0
      || !!classifyLoginScreen(await page.locator("body").innerText());
    if (await unsafe()) { state.stage="password-or-challenge"; return false; }
    const name = /^[\uE000-\uF8FF\s]*(?:view\s+more\s+claims|(?:view\s+)?claims\s+history)[\uE000-\uF8FF\s]*$/i;
    const targets = page.getByRole("link", { name }).or(page.getByRole("button", { name })).filter({ visible: true });
    state.visibleHistoryControls = Math.min(2, await targets.count());

    // This exact non-binding notice was already observed in the claim-entry flow.
    // Unknown dialogs, consent and account-update screens remain untouched.
    const notices = page.locator(".message-modal").filter({ hasText: "Go digital to avoid mail delays" }).filter({ visible: true });
    const noticeTitle = page.getByText("Go digital to avoid mail delays", { exact: true }).filter({ visible: true });
    state.knownNoticeVisible = await notices.count() === 1 && await noticeTitle.count() === 1;
    state.welcomeVisible = await page.getByRole("button", { name: "Go to Member Profile", exact: true }).filter({ visible: true }).count() === 1;
    state.visibleModal = await page.locator('.message-modal, [role="dialog"]').filter({ visible: true }).count() > 0;
    if (state.visibleHistoryControls > 1) { state.stage="ambiguous-history-control"; return false; }
    // A modal may mark the background aria-hidden; then the history link becomes
    // accessible only after its known informational notice is closed.
    if (await notices.count() === 1 && await noticeTitle.count() === 1) {
      const close = notices.locator('.message-modal__close-button button[data-test="close-message-btn"]').filter({ visible: true });
      if (await close.count() !== 1 || page.url() !== original) { state.stage="notice-close-unavailable"; return false; }
      state.stage="closing-known-notice";
      await close.click({ timeout: 2000 });
    }
    state.visibleHistoryControls = Math.min(2, await targets.count());
    if (page.url() !== original || await unsafe()) { state.stage="page-changed"; return false; }
    if (state.visibleHistoryControls !== 1) { state.stage=state.visibleHistoryControls ? "ambiguous-history-control" : "history-control-missing"; return false; }
    // Trial verifies that an unknown overlay cannot intercept the navigation.
    try { await targets.click({ trial: true, timeout: 1500 }); } catch { state.stage="history-control-obstructed"; return false; }
    if (page.url() !== original || await targets.count() !== 1 || await unsafe()) { state.stage="page-changed"; return false; }
    attempted.add(page); // A timed-out/uncertain click must never be replayed.
    state.attempted=true; state.stage="history-click-started";
    await targets.click({ timeout: 3000, noWaitAfter: true });
    state.stage="history-click-completed";
    return true;
  };
  return Object.assign(navigate, { diagnostic: () => ({ ...state }) });
}
