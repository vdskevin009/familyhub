import type { LoginRecoveryRequest } from "./portal-login-recovery.js";
import { findPortalHistoryPage, isInsurerPortalPage } from "./portal-history-page.js";
import { acquirePortalLock, authenticatedPortal, tryPortalLogin, type LoginReason } from "./portal-login.js";
import { mkdir, open } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Cookie } from "playwright";
import { atomicJson, dataDirectory, loadPrivate, savePrivate } from "./private-store.js";
import { parseBlueCrossExport, type BlueCrossRow } from "./bluecross.js";

export const blueCrossPrivateDirectory = join(dataDirectory, "bluecross");
export const blueCrossProfileDirectory = join(blueCrossPrivateDirectory, "browser-profile");
export const blueCrossSnapshotDirectory = join(blueCrossPrivateDirectory, "snapshots");
export const blueCrossAuthPath = join(blueCrossPrivateDirectory, "auth-state.dpapi");
export const blueCrossCollectorVersion = 1;
const memberUrl = "https://www.pac.bluecross.ca/Member";
const sessionOrigin = "https://service.pac.bluecross.ca";
const sessionKey = "pbcMemberProfileData";

export type PortalCollection = {
  collectedAt: string; collectorVersion: number; pageCount: number;
  rows: BlueCrossRow[]; warnings: string[]; complete: boolean;
};
export type PortalPage = { html: string; hasNext: boolean };

export function blueCrossAuthCookies<T extends { domain: string }>(cookies: T[]): T[] {
  return cookies.filter(cookie => /(?:^|\.)pac\.bluecross\.ca$/i.test(cookie.domain.replace(/^\./, "")));
}

export function blueCrossSessionMarker(origin: string, value: unknown): string | null {
  return origin === sessionOrigin && typeof value === "string" && value.length > 0 ? value : null;
}

/** Parse each page independently so its page subtotal is verified by the existing parser. */
export function parsePortalPages(pages: PortalPage[], warning = ""): PortalCollection {
  const rows: BlueCrossRow[] = [];
  const warnings = warning ? [warning] : [];
  let totalClaimed = 0, totalPaid = 0;
  let portalTotalClaimed: number | null = null, portalTotalPaid: number | null = null;
  for (const page of pages) {
    try {
      const report = parseBlueCrossExport(page.html);
      if (!report) throw new Error("Claims table was not recognized.");
      rows.push(...report.rows);
      totalClaimed += report.pageClaimed; totalPaid += report.pagePaid;
      if (report.totalClaimed != null) portalTotalClaimed = report.totalClaimed;
      if (report.totalPaid != null) portalTotalPaid = report.totalPaid;
    } catch (error) {
      warnings.push(`Page ${pages.indexOf(page) + 1}: ${error instanceof Error ? error.message : "parser error"}`);
    }
  }
  if (!pages.length) warnings.push("No claims page was collected.");
  if (pages.at(-1)?.hasNext) warnings.push("Claims pagination was interrupted.");
  if (portalTotalClaimed != null && Math.round(portalTotalClaimed * 100) !== Math.round(totalClaimed * 100)
    || portalTotalPaid != null && Math.round(portalTotalPaid * 100) !== Math.round(totalPaid * 100))
    warnings.push("Collected rows do not match the portal grand total.");
  // A repeated page can silently hide history. Treat it as incomplete, not as new claims.
  const signatures = new Set<string>();
  for (const page of pages) {
    const signature = page.html.replace(/\s+/g, " ").trim();
    if (signatures.has(signature)) warnings.push("A claims page repeated during pagination.");
    signatures.add(signature);
  }
  return { collectedAt: new Date().toISOString(), collectorVersion: blueCrossCollectorVersion,
    pageCount: pages.length, rows, warnings, complete: warnings.length === 0 };
}

/** Exclusive creation prevents a second collection from altering an audit snapshot. */
export async function savePortalSnapshot(collection: PortalCollection): Promise<string> {
  await mkdir(blueCrossSnapshotDirectory, { recursive: true, mode: 0o700 });
  const stamp = collection.collectedAt.replace(/[:.]/g, "-");
  const path = join(blueCrossSnapshotDirectory, `${stamp}-${randomUUID()}.json`);
  const file = await open(path, "wx", 0o600);
  try { await file.writeFile(JSON.stringify(collection)); }
  finally { await file.close(); }
  return path;
}

export async function collectBlueCrossPortal(interactive = false, recovery?: LoginRecoveryRequest): ReturnType<typeof collectBlueCrossPortalLocked> {
  let release: () => Promise<void>;
  try { release = await acquirePortalLock("bluecross"); }
  catch { return { status: "login-required", authReason: "profile-busy" }; }
  try { return await collectBlueCrossPortalLocked(interactive, recovery); }
  finally { await release(); }
}

async function collectBlueCrossPortalLocked(interactive = false, recovery?: LoginRecoveryRequest): Promise<{ status: "success" | "login-required"; authReason?: LoginReason; collection?: PortalCollection; snapshotPath?: string }> {
  await mkdir(blueCrossProfileDirectory, { recursive: true, mode: 0o700 });
  const { chromium } = await import("playwright");
  const context = await chromium.launchPersistentContext(blueCrossProfileDirectory, {
    // The bundled Chromium can be blocked by Windows Application Control even when installed.
    // Use the operator's installed Chrome on Windows for both visible login and later previews.
    channel: process.platform === "win32" ? "chrome" : undefined,
    headless: !interactive, acceptDownloads: false, serviceWorkers: "block"
  });
  try {
    if (process.platform === "win32") {
      try {
        const saved = await loadPrivate<{ cookies: Cookie[]; session?: { origin: string; value: string } }>(blueCrossAuthPath);
        const existing = await context.cookies();
        const restored = blueCrossAuthCookies(saved.cookies).filter(cookie =>
          (cookie.expires < 0 || cookie.expires > Date.now() / 1000) && !existing.some(current =>
            current.name === cookie.name && current.domain === cookie.domain && current.path === cookie.path));
        await context.addCookies(restored);
        const marker = blueCrossSessionMarker(saved.session?.origin ?? "", saved.session?.value);
        if (marker) await context.addInitScript(({ origin, key, value }) => {
          if (location.origin === origin && !sessionStorage.getItem(key)) sessionStorage.setItem(key, value);
        }, { origin: sessionOrigin, key: sessionKey, value: marker });
      } catch { /* A missing or expired session falls back to the normal login flow. */ }
    }
    let page = context.pages()[0] ?? await context.newPage();
    await page.goto(memberUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    let claims = page.locator("table[id*='grdClaimsGrid']");
    const openHistory = async () => {
      if (!isInsurerPortalPage(page, 'bluecross')) return false;
      const link = page.getByRole("link", { name: /view more claims|claims history/i }).first();
      const button = page.getByRole("button", { name: /view more claims|claims history/i }).first();
      if (await link.isVisible().catch(() => false)) { await link.click(); return true; }
      if (await button.isVisible().catch(() => false)) { await button.click(); return true; }
      return false;
    };
    let previousHistoryDiagnostic = "";
    let historyTabSwitches = 0;
    const recoverHistoryTab = async () => {
      const observed = await findPortalHistoryPage(context, page, "bluecross");
      if (observed.page && observed.page !== page) historyTabSwitches++;
      const details = { ...observed.diagnostic, tabSwitches: historyTabSwitches };
      const diagnostic = JSON.stringify(details);
      if (diagnostic !== previousHistoryDiagnostic) {
        previousHistoryDiagnostic = diagnostic;
        await atomicJson(join(blueCrossPrivateDirectory, "history-tab-diagnostic.json"), {
          version: 1, observedAt: new Date().toISOString(), ...details
        }).catch(() => { /* Secret-free diagnostics cannot disrupt authentication. */ });
      }
      if (!observed.page) return false;
      page = observed.page;
      claims = page.locator("table[id*='grdClaimsGrid']");
      return true;
    };
    const ready = async () => {
      if (await recoverHistoryTab()) return true;
      if (page.isClosed()) return false;
      if (!isInsurerPortalPage(page, 'bluecross')) return false;
      if (!await claims.isVisible().catch(() => false)) await openHistory().catch(() => {});
      return recoverHistoryTab();
    };
    // Give an existing trusted session time to restore before touching credentials.
    const authReason = await tryPortalLogin(page, "bluecross", ready, undefined, recovery);
    if (interactive && !await ready()) {
      const deadline = Date.now() + 600_000;
      while (!await ready() && Date.now() < deadline) await page.waitForTimeout(2000).catch(() => new Promise(resolve => setTimeout(resolve, 2000)));
    }
    if (!await ready()) return { status: "login-required", authReason: authReason || "human-required" };
    await authenticatedPortal("bluecross");
    let warning = "";
    if (process.platform === "win32") {
      try {
        const cookies = blueCrossAuthCookies(await context.cookies());
        const current = await page.evaluate(key => ({ origin: location.origin, value: sessionStorage.getItem(key) }), sessionKey);
        const marker = blueCrossSessionMarker(current.origin, current.value);
        if (cookies.length && marker) await savePrivate(blueCrossAuthPath,
          { cookies, session: { origin: sessionOrigin, value: marker } });
        else warning = "Blue Cross session state was unavailable for repeat previews.";
      } catch { warning = "Blue Cross session could not be saved for repeat previews."; }
    }
    let filtersChanged = false;
    // The current portal uses Telerik combo boxes, not native selects. Force the widest
    // available window and all covered lives before trusting its grand total.
    const setPortalCombo = async (suffix: string, desired: RegExp): Promise<boolean> => {
      const combo = page.locator(`div[id$='${suffix}']`);
      if (await combo.count() !== 1) return false;
      const option = combo.locator("li.rcbItem").filter({ hasText: desired }).first();
      if (!await option.count()) return false;
      const label = (await option.textContent())?.trim() || "";
      const input = combo.locator("input.rcbInput");
      if (await input.inputValue() === label) return true;
      if (suffix === "ddlFilterShowClaimsWithin" && label === "24 Months") {
        try {
          await input.press("End");
          await input.press("Enter");
          if (await input.inputValue() === label) { filtersChanged = true; return true; }
        } catch { /* Fall back to the portal's visible menu. */ }
      }
      try {
        await combo.locator("a[id$='_Arrow']").click();
        await option.click();
      } catch { return false; }
      if (await input.inputValue() !== label) return false;
      filtersChanged = true;
      return true;
    };
    if (!await setPortalCombo("ddlFilterCoveredLife", /^All Covered Lives$/i))
      warning = "All covered lives could not be selected.";
    if (!await setPortalCombo("ddlFilterShowClaimsWithin", /^24 Months$/i))
      warning += `${warning ? " " : ""}The widest claims history range could not be selected.`;
    // Retain support for a native-select version of the same read-only filters.
    for (const filter of await page.locator("select").all()) {
      const details = await filter.evaluate(element => ({
        label: [element.getAttribute("aria-label"), ...(Array.from((element as HTMLSelectElement).labels || []).map(label => label.textContent))].join(" "),
        options: Array.from((element as HTMLSelectElement).options).map(option => ({ value: option.value, label: option.textContent?.trim() || "" }))
      }));
      if (!/date|range|period|claim type|individual|member/i.test(details.label)) continue;
      const widest = details.options.find(option => /^all(?: claims| dates| members)?$/i.test(option.label))
        ?? details.options.find(option => /^(?:last )?(?:24 months|2 years)$/i.test(option.label));
      if (widest && await filter.inputValue() !== widest.value) {
        await filter.selectOption(widest.value);
        filtersChanged = true;
      }
    }
    if (filtersChanged) {
      const previous = await claims.evaluate(element => element.outerHTML);
      const refreshed = await page.getByRole("button", { name: /^Apply$/i }).click()
        .then(() => page.waitForFunction(
          oldTable => document.querySelector("table[id*='grdClaimsGrid']")?.outerHTML !== oldTable,
          previous, { timeout: 30_000 }
        )).then(() => true).catch(() => false);
      if (!refreshed) warning += `${warning ? " " : ""}Claims did not visibly refresh after changing the history filters.`;
    }
    const pages: PortalPage[] = [];
    for (let index = 0; index < 100; index++) {
      try {
        await claims.waitFor({ state: "visible", timeout: 30_000 });
        const html = await claims.evaluate(element => element.outerHTML);
        const next = page.getByRole("link", { name: /^(next|next page|suivant)\s*»?$/i }).first();
        const nextButton = page.locator("input.btn-next[id*='grdClaimsPageButton']").first();
        const numeric = claims.locator("tfoot a").filter({ hasText: new RegExp(`^${index + 2}$`) }).first();
        const control = await next.count() ? next : await nextButton.count() ? nextButton : numeric;
        const hasNext = await control.count() > 0 && await control.isVisible() && await control.isEnabled()
          && (await control.getAttribute("aria-disabled")) !== "true";
        pages.push({ html, hasNext });
        if (!hasNext) break;
        await control.click();
        await page.waitForFunction(previous => document.querySelector("table[id*='grdClaimsGrid']")?.outerHTML !== previous, html, { timeout: 30_000 });
      } catch {
        warning += `${warning ? " " : ""}Claims navigation failed; later pages were not collected.`;
        break;
      }
    }
    if (pages.length === 100 && pages.at(-1)?.hasNext)
      warning += `${warning ? " " : ""}Claims pagination exceeded 100 pages.`;
    const collection = parsePortalPages(pages, warning);
    const snapshotPath = await savePortalSnapshot(collection);
    return { status: "success", collection, snapshotPath };
  } finally { await context.close(); }
}
