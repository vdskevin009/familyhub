import type { Page } from "playwright";
import { blueCrossPageCategory } from "./bluecross-page-category.js";
import { classifyLoginScreen, type LoginReason } from "./portal-login.js";

export class BlueCrossHistoryUnavailableError extends Error {
  constructor() {
    super("Blue Cross claims history could not be opened from the member page. No complete collection was made. Saved claims remain unchanged. Review the history on the PC before trying again.");
    this.name = "BlueCrossHistoryUnavailableError";
  }
}

/** A reserved history click is not proof of either authentication or expiration.
 * Only replace the generic unknown-login-layout result; preserve every real
 * authentication/challenge/uncertainty stop and never authorize another action.
 */
export async function blueCrossHistoryFailure(page: Page, reason: LoginReason | undefined,
  navigation: { attempted: boolean; stage: string }): Promise<BlueCrossHistoryUnavailableError | undefined> {
  if (reason !== "layout-changed" || !navigation.attempted
    || !["history-click-started", "history-click-completed"].includes(navigation.stage) || page.isClosed()) return;
  try {
    const original = page.url();
    if (!["member-home", "login", "claims-history"].includes(blueCrossPageCategory(original))) return;
    if (await page.locator('input[type="password"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], input[autocomplete="one-time-code"]').filter({ visible: true }).count()) return;
    if (classifyLoginScreen(await page.locator("body").innerText())) return;
    if (page.isClosed() || page.url() !== original) return;
    return new BlueCrossHistoryUnavailableError();
  } catch { /* An unreadable or changing page cannot establish this classification. */ }
}
