import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Page } from "playwright";
import { calendarDate, memberName } from "./healthcare-evidence.js";
import { dataDirectory } from "./private-store.js";
import { desjardinsIdentity, type DesjardinsCollection, type DesjardinsRow } from "./desjardins.js";

export const desjardinsPrivateDirectory = join(dataDirectory, "desjardins");
export const desjardinsProfileDirectory = join(desjardinsPrivateDirectory, "browser-profile");
export const desjardinsSnapshotDirectory = join(desjardinsPrivateDirectory, "snapshots");
export const desjardinsCollectorVersion = 1;
const origin = "https://www.agea-gbim.dsf-dfs.com";
const loginUrl = `${origin}/AGEA-GBIM/Athntfctn/Authentification_Authentication.aspx?bhcp=1&cltr=fr-CA`;
const historyUrl = `${origin}/AGEA-GBIM/Rclmtn/RclmtnTrt/HistoriqueReclamation_ClaimHistory.aspx`;
const historyTable = "table.tableau-donnees";

export type PortalTableRow = { cells: string[]; colspans: number[] };
export type PortalHistoryRow = { date: string; method: string; paid: string; category: string; hasDetail: boolean };

const clean = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim();
const date = (value: string): string | null => calendarDate(clean(value).replace(/[‐‑‒–—−]/g, "-"));
const money = (value: string): number | null => {
  const normalized = clean(value).replace(/[\s$]/g, "");
  if (!/^\d+(?:[,.]\d{3})*,\d{2}$|^\d+,\d{2}$/.test(normalized)) return null;
  const result = Number(normalized.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(result) && result >= 0 && result < 1e9 ? result : null;
};
const cents = (value: number) => Math.round(value * 100);
const member = (value: string): DesjardinsRow["member"] => {
  const words = clean(value).split(" ");
  // The portal uses surname-first claim headings. Only known household names map to a member.
  return memberName(value) !== "unknown" ? memberName(value)
    : words.length > 1 ? memberName(`${words.slice(1).join(" ")} ${words[0]}`) : "unknown";
};

/** Pure parser for the portal's nine-column service grid. A malformed row blocks apply. */
export function parseDesjardinsDetail(history: PortalHistoryRow, detail: PortalTableRow[]): { rows: DesjardinsRow[]; warnings: string[] } {
  const warnings: string[] = [];
  const statementDate = date(history.date);
  const historyPaid = money(history.paid);
  if (!statementDate || historyPaid == null || !history.hasDetail) warnings.push("Processed-claims row has an invalid date, payment or detail action.");
  const rows: DesjardinsRow[] = [];
  let claimId = "";
  let claimMember: DesjardinsRow["member"] = "unknown";
  let line = 0;
  for (const entry of detail) {
    const cells = entry.cells.map(clean);
    if (cells.length === 1 && /numéro de réclamation\s*:/i.test(cells[0])) {
      const match = cells[0].match(/numéro de réclamation\s*:\s*([A-Za-z0-9-]+)/i);
      const name = cells[0].split(/,\s*numéro de réclamation/i)[0];
      claimId = match?.[1] || "";
      claimMember = member(name);
      line = 0;
      if (!claimId || claimMember === "unknown") warnings.push("Claim identity or member was not recognized.");
      continue;
    }
    if (cells.length === 9 && date(cells[1])) {
      line++;
      const serviceDate = date(cells[1]);
      const endDate = date(cells[2]);
      const submitted = money(cells[3]);
      const paid = money(cells[7]);
      const service = cells[0];
      if (!claimId || claimMember === "unknown" || !serviceDate || !endDate || !service
        || submitted == null || paid == null || paid > submitted || endDate < serviceDate) {
        warnings.push("A claim service line is incomplete or inconsistent.");
        continue;
      }
      rows.push({ member: claimMember, serviceDate, service, submitted, paid, statementDate,
        sourceClaimId: claimId, identity: desjardinsIdentity(claimId, null, line), needsReview: false });
    }
  }
  if (!rows.length) warnings.push("Claim detail has no recognized service line.");
  if (historyPaid != null && cents(rows.reduce((sum, row) => sum + (row.paid ?? 0), 0)) !== cents(historyPaid))
    warnings.push("Claim detail reimbursement does not match the processed-claims list.");
  return { rows, warnings };
}

export function parseDesjardinsPages(pages: Array<{ histories: PortalHistoryRow[]; details: PortalTableRow[][]; hasNext: boolean }>,
  extraWarnings: string[] = []): DesjardinsCollection {
  const warnings = [...extraWarnings];
  const rows: DesjardinsRow[] = [];
  const pageSignatures = new Set<string>();
  for (const [pageIndex, page] of pages.entries()) {
    const signature = createHash("sha256").update(JSON.stringify(page.histories)).digest("hex");
    if (pageSignatures.has(signature)) warnings.push(`Claims page ${pageIndex + 1} repeated during pagination.`);
    pageSignatures.add(signature);
    if (!page.histories.length || page.histories.length !== page.details.length)
      warnings.push(`Claims page ${pageIndex + 1} was incomplete.`);
    for (const [rowIndex, history] of page.histories.entries()) {
      const parsed = parseDesjardinsDetail(history, page.details[rowIndex] ?? []);
      rows.push(...parsed.rows);
      warnings.push(...parsed.warnings.map(warning => `Page ${pageIndex + 1}, claim ${rowIndex + 1}: ${warning}`));
    }
  }
  if (!pages.length) warnings.push("No processed-claims page was collected.");
  if (pages.at(-1)?.hasNext) warnings.push("Claims pagination was interrupted.");
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.identity)) warnings.push("A claim service identity repeated across pages.");
    ids.add(row.identity);
  }
  return { collectedAt: new Date().toISOString(), collectorVersion: desjardinsCollectorVersion,
    pageCount: pages.length, rows, warnings, complete: warnings.length === 0 };
}

async function tableRows(page: Page): Promise<PortalTableRow[]> {
  return page.locator(`${historyTable} tbody tr`).evaluateAll(rows => rows.map(row => ({
    cells: Array.from(row.querySelectorAll(":scope > td")).map(cell => cell.textContent?.replace(/\s+/g, " ").trim() || ""),
    colspans: Array.from(row.querySelectorAll(":scope > td")).map(cell => Number(cell.getAttribute("colspan") || 1))
  })));
}

async function histories(page: Page): Promise<PortalHistoryRow[]> {
  return page.locator(`${historyTable} tbody tr`).evaluateAll(rows => rows.map(row => {
    const cells = Array.from(row.querySelectorAll(":scope > td"));
    return { date: cells[0]?.textContent?.trim() || "", method: cells[1]?.textContent?.trim() || "",
      paid: cells[2]?.textContent?.trim() || "", category: cells[3]?.textContent?.trim() || "",
      hasDetail: !!cells[4]?.querySelector("a") && /détails|details/i.test(cells[4]?.textContent || "") };
  }));
}

async function nextControl(page: Page, number: number) {
  const candidates = [
    page.getByRole("link", { name: new RegExp(`^${number}$`) }).last(),
    page.getByRole("link", { name: /^(suivant|next|»|›|>)$/i }).last(),
    page.locator("input[type=submit][value*='Suivant'], input[type=submit][value*='Next']").last()
  ];
  for (const candidate of candidates) if (await candidate.count() && await candidate.isVisible() && await candidate.isEnabled()) return candidate;
  return null;
}

/** Visible login and MFA are always performed by the operator. The collector only reads history. */
export async function collectDesjardinsPortal(interactive = false): Promise<{
  status: "success" | "login-required"; collection?: DesjardinsCollection; snapshotPath?: string;
}> {
  await mkdir(desjardinsProfileDirectory, { recursive: true, mode: 0o700 });
  const { chromium } = await import("playwright");
  const context = await chromium.launchPersistentContext(desjardinsProfileDirectory, {
    channel: process.platform === "win32" ? "msedge" : undefined,
    headless: !interactive, acceptDownloads: false, serviceWorkers: "block"
  });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(interactive ? loginUrl : historyUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const table = page.locator(historyTable);
    if (interactive) {
      const deadline = Date.now() + 10 * 60_000;
      while (!await table.isVisible().catch(() => false) && Date.now() < deadline) await page.waitForTimeout(2000);
    } else await table.waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
    if (!await table.isVisible().catch(() => false)) return { status: "login-required" };
    if (!page.url().startsWith(origin) || !/HistoriqueReclamation_ClaimHistory\.aspx/i.test(page.url()))
      return { status: "login-required" };

    const warnings: string[] = [];
    const patient = page.locator("select[id$='cbPour']");
    const category = page.locator("select[id$='cbCategorie']");
    const pageSize = page.locator("select[id$='cbNbResltRechr']");
    if (await patient.count() !== 1 || await category.count() !== 1 || await pageSize.count() !== 1)
      warnings.push("Processed-claims filters were not recognized.");
    else {
      await patient.selectOption({ label: "Tous les patients" });
      await category.selectOption({ label: "Toutes les catégories" });
      await pageSize.selectOption({ label: "100" });
      await page.locator("input[id$='btnRechercher']").click();
      await table.waitFor({ state: "visible", timeout: 30_000 });
      if (!/HistoriqueReclamation_ClaimHistory\.aspx/i.test(page.url())) warnings.push("Search did not return to processed claims.");
    }
    const pages: Array<{ histories: PortalHistoryRow[]; details: PortalTableRow[][]; hasNext: boolean }> = [];
    for (let pageIndex = 0; pageIndex < 100; pageIndex++) {
      const visible = await histories(page);
      const pageSignature = createHash("sha256").update(JSON.stringify(visible)).digest("hex");
      const details: PortalTableRow[][] = [];
      for (let rowIndex = 0; rowIndex < visible.length; rowIndex++) {
        try {
          if (!visible[rowIndex].hasDetail) throw new Error("No detail action");
          await page.locator(`${historyTable} tbody tr`).nth(rowIndex).getByRole("link", { name: /détails|details/i }).click();
          await page.waitForURL(/DetailReclamation_ClaimDetails\.aspx/i, { timeout: 30_000 });
          if (!page.url().startsWith(origin)) throw new Error("Unexpected detail origin");
          details.push(await tableRows(page));
          await page.locator("input[id$='btnRetour']").click();
          await page.waitForURL(/HistoriqueReclamation_ClaimHistory\.aspx/i, { timeout: 30_000 });
          const restored = await histories(page);
          if (createHash("sha256").update(JSON.stringify(restored)).digest("hex") !== pageSignature)
            throw new Error("History changed after returning from a claim detail");
        } catch {
          warnings.push(`Page ${pageIndex + 1}, claim ${rowIndex + 1}: detail navigation failed.`);
          break;
        }
      }
      const next = await nextControl(page, pageIndex + 2).catch(() => null);
      const hasNext = next !== null;
      pages.push({ histories: visible, details, hasNext });
      if (details.length !== visible.length || !hasNext) break;
      try {
        const before = (await page.locator(`${historyTable} tbody tr`).allTextContents()).map(clean);
        await next.click();
        await page.waitForFunction(previous => {
          const rows = Array.from(document.querySelectorAll("table.tableau-donnees tbody tr"));
          return rows.length > 0 && JSON.stringify(rows.map(row => row.textContent?.replace(/\s+/g, " ").trim())) !== previous;
        }, JSON.stringify(before), { timeout: 30_000 });
      } catch { warnings.push("Claims pagination failed."); break; }
    }
    if (pages.length === 100 && pages.at(-1)?.hasNext) warnings.push("Claims pagination exceeded 100 pages.");
    const collection = parseDesjardinsPages(pages, warnings);
    await mkdir(desjardinsSnapshotDirectory, { recursive: true, mode: 0o700 });
    const snapshotPath = join(desjardinsSnapshotDirectory, `${collection.collectedAt.replace(/[:.]/g, "-")}-${randomUUID()}.json`);
    const file = await open(snapshotPath, "wx", 0o600);
    try { await file.writeFile(JSON.stringify(collection)); } finally { await file.close(); }
    return { status: "success", collection, snapshotPath };
  } finally { await context.close(); }
}

export async function loadDesjardinsSnapshot(path: string | undefined, at: string | undefined): Promise<DesjardinsCollection> {
  if (!path || !at || Date.now() - Date.parse(at) > 24 * 60 * 60_000 || Date.parse(at) > Date.now() + 60_000
    || resolve(path).toLowerCase() !== resolve(desjardinsSnapshotDirectory, path.split(/[\\/]/).at(-1) || "").toLowerCase())
    throw new Error("No recent Desjardins preview is available; run a dry-run first.");
  const collection = JSON.parse(await readFile(path, "utf8")) as DesjardinsCollection;
  if (collection.collectorVersion !== desjardinsCollectorVersion || collection.collectedAt !== at || !Array.isArray(collection.rows)
    || !Array.isArray(collection.warnings) || typeof collection.complete !== "boolean")
    throw new Error("No recent Desjardins preview is available; run a dry-run first.");
  return collection;
}
