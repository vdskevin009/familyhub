import type { Page } from "playwright";
import { classifyLoginScreen } from "./portal-login.js";
import { blueCrossPageCategory } from "./bluecross-page-category.js";

/** One history click per sign-in attempt; an uncertain click is never replayed. */
export function createBlueCrossHistoryNavigation(interactive = false) {
  const attempted = new WeakSet<Page>();
  const returnedToLogin = new WeakSet<Page>();
  const state = { stage: "not-started", visibleHistoryControls: 0, knownNoticeVisible: false, welcomeVisible: false, visibleModal: false, attempted: false };
  const navigate = async (page: Page): Promise<boolean> => {
    if (page.isClosed()) { state.stage="page-closed"; return false; }
    if (attempted.has(page)) {
      if (blueCrossPageCategory(page.url()) === "login" && await page.locator('#password[type="password"]').isVisible().catch(() => false)) {
        returnedToLogin.add(page); state.stage="returned-to-login";
        return false;
      }
      if (!interactive || !returnedToLogin.has(page) || !["member-home","login"].includes(blueCrossPageCategory(page.url()))) return false;
      // In an explicitly interactive reconnect, the operator may sign in outside
      // tryPortalLogin. The exact observed login -> member transition resolves
      // the prior click; all control/challenge checks below still apply.
      returnedToLogin.delete(page); attempted.delete(page);
    }
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
    const welcome = page.locator(".message-modal").filter({ has: page.getByRole("button", { name: "Go to Member Profile", exact: true }) }).filter({ visible: true });
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
    } else if (await welcome.count() === 1) {
      // Public member-home code wires this exact welcome modal's X to a local
      // dismissed-notice flag only. Never accept an agreement or account form.
      const close = welcome.locator('.message-modal__close-button button[data-test="close-message-btn"]').filter({ visible: true });
      const proceed = welcome.getByRole("button", { name: "Go to Member Profile", exact: true }).and(welcome.locator('[data-test="close-welcome-modal"]'));
      if (await close.count() !== 1 || await proceed.count() !== 1 || page.url() !== original
        || await welcome.locator('input, select, textarea, [role="checkbox"]').filter({ visible: true }).count()
        || /\b(?:agree|consent|accept|terms and conditions)\b/i.test(await welcome.innerText())) { state.stage="welcome-needs-review"; return false; }
      state.stage="closing-known-welcome";
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
  return Object.assign(navigate, {
    diagnostic: () => ({ ...state }),
    afterCredentialSubmission(page: Page) {
      // A visible exact login form establishes the previous click's outcome.
      // Only the guarded credential flow can start the next navigation attempt.
      if (!returnedToLogin.has(page)) return;
      returnedToLogin.delete(page); attempted.delete(page);
      state.stage="fresh-login-submitted"; state.attempted=false;
    }
  });
}
