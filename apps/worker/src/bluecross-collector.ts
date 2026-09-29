import { mkdir, open } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { dataDirectory } from "./private-store.js";
import { parseBlueCrossExport, type BlueCrossRow } from "./bluecross.js";

export const blueCrossPrivateDirectory = join(dataDirectory, "bluecross");
export const blueCrossProfileDirectory = join(blueCrossPrivateDirectory, "browser-profile");
export const blueCrossSnapshotDirectory = join(blueCrossPrivateDirectory, "snapshots");
export const blueCrossCollectorVersion = 1;
const memberUrl = "https://www.pac.bluecross.ca/Member";

export type PortalCollection = {
  collectedAt: string; collectorVersion: number; pageCount: number;
  rows: BlueCrossRow[]; warnings: string[]; complete: boolean;
};
export type PortalPage = { html: string; hasNext: boolean };

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

export async function collectBlueCrossPortal(interactive = false): Promise<{ status: "success" | "login-required"; collection?: PortalCollection; snapshotPath?: string }> {
  await mkdir(blueCrossProfileDirectory, { recursive: true, mode: 0o700 });
  const { chromium } = await import("playwright");
  const context = await chromium.launchPersistentContext(blueCrossProfileDirectory, {
    headless: !interactive, acceptDownloads: false, serviceWorkers: "block"
  });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(memberUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const claims = page.locator("table[id*='grdClaimsGrid']");
    const openHistory = async () => {
      const link = page.getByRole("link", { name: /view more claims|claims history/i }).first();
      const button = page.getByRole("button", { name: /view more claims|claims history/i }).first();
      if (await link.isVisible().catch(() => false)) { await link.click(); return true; }
      if (await button.isVisible().catch(() => false)) { await button.click(); return true; }
      return false;
    };
    if (!interactive && !await claims.isVisible().catch(() => false)) {
      const link = page.getByRole("link", { name: /view more claims|claims history/i }).first();
      await link.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
    }
    if (!await claims.isVisible().catch(() => false)) await openHistory();
    if (interactive) {
      const deadline = Date.now() + 300_000;
      while (!await claims.isVisible().catch(() => false) && Date.now() < deadline) {
        await openHistory().catch(() => {});
        if (!await claims.isVisible().catch(() => false)) await page.waitForTimeout(2000);
      }
      if (!await claims.isVisible().catch(() => false)) return { status: "login-required" };
    } else if (!await claims.isVisible().catch(() => false)) return { status: "login-required" };
    // Only change read-only history filters when the portal exposes a clearly named native select.
    for (const filter of await page.locator("select").all()) {
      const details = await filter.evaluate(element => ({
        label: [element.getAttribute("aria-label"), ...(Array.from((element as HTMLSelectElement).labels || []).map(label => label.textContent))].join(" "),
        options: Array.from((element as HTMLSelectElement).options).map(option => ({ value: option.value, label: option.textContent?.trim() || "" }))
      }));
      if (!/date|range|period|claim type|individual|member/i.test(details.label)) continue;
      const widest = details.options.find(option => /^all(?: claims| dates| members)?$/i.test(option.label))
        ?? details.options.find(option => /^(?:last )?(?:24 months|2 years)$/i.test(option.label));
      if (widest) await filter.selectOption(widest.value);
    }
    const pages: PortalPage[] = [];
    let warning = "";
    for (let index = 0; index < 100; index++) {
      try {
        await claims.waitFor({ state: "visible", timeout: 30_000 });
        const html = await claims.evaluate(element => element.outerHTML);
        const next = page.getByRole("link", { name: /^(next|next page|suivant|>)$/i }).first();
        const nextButton = page.getByRole("button", { name: /^(next|next page|suivant|>)$/i }).first();
        const numeric = claims.locator("tfoot a").filter({ hasText: new RegExp(`^${index + 2}$`) }).first();
        const control = await next.count() ? next : await nextButton.count() ? nextButton : numeric;
        const hasNext = await control.count() > 0 && await control.isVisible() && await control.isEnabled()
          && (await control.getAttribute("aria-disabled")) !== "true";
        pages.push({ html, hasNext });
        if (!hasNext) break;
        await control.click();
        await page.waitForFunction(previous => document.querySelector("table[id*='grdClaimsGrid']")?.outerHTML !== previous, html, { timeout: 30_000 });
      } catch {
        warning = "Claims navigation failed; later pages were not collected.";
        break;
      }
    }
    if (pages.length === 100 && pages.at(-1)?.hasNext) warning = "Claims pagination exceeded 100 pages.";
    const collection = parsePortalPages(pages, warning);
    const snapshotPath = await savePortalSnapshot(collection);
    return { status: "success", collection, snapshotPath };
  } finally { await context.close(); }
}
