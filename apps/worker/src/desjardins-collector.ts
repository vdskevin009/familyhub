import { acquirePortalLock, authenticatedPortal, tryPortalLogin, type LoginReason } from "./portal-login.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Cookie, Page } from "playwright";
import { calendarDate, memberName } from "./healthcare-evidence.js";
import { dataDirectory, loadPrivate, savePrivate } from "./private-store.js";
import { desjardinsIdentity, type DesjardinsCollection, type DesjardinsRow } from "./desjardins.js";

export const desjardinsPrivateDirectory = join(dataDirectory, "desjardins");
export const desjardinsProfileDirectory = join(desjardinsPrivateDirectory, "browser-profile");
export const desjardinsSnapshotDirectory = join(desjardinsPrivateDirectory, "snapshots");
export const desjardinsAuthPath = join(desjardinsPrivateDirectory, "auth-state.dpapi");
export const desjardinsMemberAliasesPath = join(desjardinsPrivateDirectory, "member-aliases.dpapi");
export const desjardinsCollectorVersion = 1;
const origin = "https://www.agea-gbim.dsf-dfs.com";
const historyUrl = `${origin}/AGEA-GBIM/Rclmtn/RclmtnTrt/HistoriqueReclamation_ClaimHistory.aspx`;
const historyTable = "table.tableau-donnees";

export const desjardinsAuthCookies = <T extends { domain: string }>(cookies: T[]): T[] => cookies.filter(cookie =>
  /(?:^|\.)(?:desjardins\.com|dsf-dfs\.com)$/i.test(cookie.domain.replace(/^\./, "")));

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
export const desjardinsAliasFingerprint = (value: string): string => createHash("sha256")
  .update(clean(value).replace(/[,;:]+/g, " ").replace(/\s+/g, " ").trim().toUpperCase()).digest("hex");
type MemberAliases = Readonly<Record<string, DesjardinsRow["member"]>>;

export async function loadMemberAliases(): Promise<MemberAliases> {
  let saved: { version: number; entries: Record<string, string> };
  try { saved = await loadPrivate(desjardinsMemberAliasesPath); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error("Confirmed Desjardins member aliases could not be read.");
  }
  if (saved?.version !== 1 || !saved.entries || typeof saved.entries !== "object" || Array.isArray(saved.entries)
    || Object.keys(saved.entries).length > 100 || Object.entries(saved.entries).some(([fingerprint, member]) =>
      !/^[0-9a-f]{64}$/.test(fingerprint) || typeof member !== "string" || member === "unknown" || memberName(member) !== member))
    throw new Error("Confirmed Desjardins member aliases are invalid.");
  return saved.entries as MemberAliases;
}
export const desjardinsNameCandidates = (value: string, knownSurname: (word: string) => boolean): string[] => {
  const normalized = clean(value).replace(/[,;:]+/g, " ").replace(/\s+/g, " ").trim();
  const words = normalized.split(" ");
  // The portal uses surname-first headings and sometimes includes extra given names.
  // Every candidate must still pass the existing exact household-name recognizer.
  const candidates = [normalized];
  if (words.length > 1) candidates.push(`${words.slice(1).join(" ")} ${words[0]}`, `${words[1]} ${words[0]}`);
  if (words.length === 3) {
    // The middle token can be a second given name while the outer pair is an
    // exact known two-token beneficiary (in either portal ordering).
    candidates.push(`${words[0]} ${words[2]}`, `${words[2]} ${words[0]}`);
    // A known household surname can surround two given names in either order.
    // Never drop an unrecognized surname to make a beneficiary appear to match.
    if (knownSurname(words[0])) candidates.push(words[1], `${words[1]} ${words[2]}`);
    if (knownSurname(words[2])) candidates.push(words[0], `${words[0]} ${words[1]}`, `${words[0]} ${words[2]}`);
  }
  return [...new Set(candidates)];
};
const member = (value: string, aliases: MemberAliases): DesjardinsRow["member"] => {
  const candidates = desjardinsNameCandidates(value, word => memberName(`Kevin ${word}`) === "Kevin");
  const recognized = new Set(candidates.map(memberName).filter(result => result !== "unknown"));
  if (recognized.size > 1) return "unknown";
  const confirmed = aliases[desjardinsAliasFingerprint(value)];
  const inferred = recognized.size === 1 ? [...recognized][0] : "unknown";
  return confirmed && inferred !== "unknown" && confirmed !== inferred ? "unknown" : confirmed || inferred;
};
const memberPattern = (value: string): string => clean(value).replace(/[,;:]+/g, " ").split(/\s+/)
  .map(word => memberName(word) !== "unknown" ? "given"
    : memberName(`Kevin ${word}`) === "Kevin" ? "household-surname"
      : memberName(`Jasmine ${word}`) === "Jasmine" ? "known-middle" : "other").join("/");

/** Pure parser for the portal's variable-width service grid. A malformed row blocks apply. */
export function parseDesjardinsDetail(history: PortalHistoryRow, detail: PortalTableRow[], aliases: MemberAliases = {}): { rows: DesjardinsRow[]; warnings: string[] } {
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
      claimMember = member(name, aliases);
      line = 0;
      if (!claimId || claimMember === "unknown")
        warnings.push(`Claim identity or member was not recognized (name shape: ${memberPattern(name)}).`);
      continue;
    }
    const firstDate = [1, 2].find(index => date(cells[index] ?? "") && date(cells[index + 1] ?? ""));
    if (cells.length >= 7 && cells.length <= 11 && firstDate !== undefined) {
      line++;
      const serviceDate = date(cells[firstDate]);
      const endDate = date(cells[firstDate + 1]);
      const submitted = money(cells[firstDate + 2]);
      // The older seven-column health grid omits one intermediate benefit column.
      const paid = money(cells[firstDate + (cells.length === 7 ? 5 : 6)]);
      // Dental rows can place a procedure/tooth code between the description and dates.
      // A numeric code is not a service label; retain the descriptive cell only.
      const labels = cells.slice(0, firstDate).filter(label => /\p{L}/u.test(label) && !/^\d+$/.test(label));
      const service = labels.length === 1 ? labels[0] : "";
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
  extraWarnings: string[] = [], aliases: MemberAliases = {}): DesjardinsCollection {
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
      // Missing navigation evidence is already flagged at page level. Do not turn an unread detail into an amount conflict.
      if (!page.details[rowIndex]) continue;
      const parsed = parseDesjardinsDetail(history, page.details[rowIndex] ?? [], aliases);
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

/** Both passes must describe the same complete history before either can be applied. */
export function confirmDesjardinsRepeat(first: DesjardinsCollection, second: DesjardinsCollection): DesjardinsCollection {
  const warnings = [
    ...first.warnings.map(warning => `Pass 1: ${warning}`),
    ...second.warnings.map(warning => `Pass 2: ${warning}`)
  ];
  if (first.pageCount !== second.pageCount || JSON.stringify(first.rows) !== JSON.stringify(second.rows))
    warnings.push("Consecutive Desjardins previews differ; collection must be reviewed.");
  return { ...second, warnings, complete: warnings.length === 0 };
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

async function saveDesjardinsAuth(context: import("playwright").BrowserContext, page: Page): Promise<string> {
  if (process.platform !== "win32") return "";
  try {
    const cookies = desjardinsAuthCookies(await context.cookies());
    const session = await page.evaluate(() => ({ origin: location.origin,
      values: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => {
        const key = sessionStorage.key(index)!;
        return [key, sessionStorage.getItem(key) || ""];
      })) }));
    if (!cookies.length || session.origin !== origin || Object.keys(session.values).length > 100
      || JSON.stringify(session.values).length > 100_000)
      return "Desjardins session cookies were unavailable for repeat previews.";
    await savePrivate(desjardinsAuthPath, { cookies, session });
    return "";
  } catch { return "Desjardins session could not be saved for repeat previews."; }
}

/** Reuse the private session, optionally sign in once, then collect read-only history. MFA stays manual. */
export async function collectDesjardinsPortal(interactive = false, passes = 1): ReturnType<typeof collectDesjardinsPortalLocked> {
  let release: () => Promise<void>;
  try { release = await acquirePortalLock("desjardins"); }
  catch { return { status: "login-required", authReason: "profile-busy" }; }
  try { return await collectDesjardinsPortalLocked(interactive, passes); }
  finally { await release(); }
}

async function collectDesjardinsPortalLocked(interactive = false, passes = 1): Promise<{
  status: "success" | "login-required"; authReason?: LoginReason; collection?: DesjardinsCollection; snapshotPath?: string;
}> {
  await mkdir(desjardinsProfileDirectory, { recursive: true, mode: 0o700 });
  const { chromium } = await import("playwright");
  const context = await chromium.launchPersistentContext(desjardinsProfileDirectory, {
    channel: process.platform === "win32" ? "msedge" : undefined,
    headless: !interactive, acceptDownloads: false, serviceWorkers: "block"
  });
  try {
    const aliases = await loadMemberAliases();
    if (process.platform === "win32") {
      try {
        const saved = await loadPrivate<{ cookies: Cookie[]; session?: { origin: string; values: Record<string, string> } }>(desjardinsAuthPath);
        const existing = await context.cookies();
        const restored = desjardinsAuthCookies(saved.cookies).filter(cookie =>
          (cookie.expires < 0 || cookie.expires > Date.now() / 1000) && !existing.some(current =>
            current.name === cookie.name && current.domain === cookie.domain && current.path === cookie.path));
        await context.addCookies(restored);
        if (saved.session?.origin === origin && saved.session.values && typeof saved.session.values === "object")
          await context.addInitScript(({ expectedOrigin, values }) => {
            if (location.origin !== expectedOrigin) return;
            for (const [key, value] of Object.entries(values))
              if (typeof value === "string" && !sessionStorage.getItem(key)) sessionStorage.setItem(key, value);
          }, { expectedOrigin: origin, values: saved.session.values });
      } catch { /* Missing or expired browser state falls back to the visible login. */ }
    }
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(historyUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const table = page.locator(historyTable);
    const ready = async () => {
      if (new URL(page.url()).origin !== origin) return false;
      if (!/HistoriqueReclamation_ClaimHistory\.aspx/i.test(page.url())) {
        const history = page.getByRole("link", { name: /historique des r[ée]clamations|claims history/i }).first();
        if (await history.isVisible().catch(() => false)) await history.click();
      }
      return new URL(page.url()).origin === origin && /HistoriqueReclamation_ClaimHistory\.aspx/i.test(page.url())
        && await table.isVisible().catch(() => false);
    };
    const authReason = await tryPortalLogin(page, "desjardins", ready);
    if (interactive && !await ready()) {
      const deadline = Date.now() + 600_000;
      while (!await ready() && Date.now() < deadline) await page.waitForTimeout(2000);
    }
    if (!await ready()) return { status: "login-required", authReason: authReason || "human-required" };
    await authenticatedPortal("desjardins");
    const authWarning = await saveDesjardinsAuth(context, page);

    if (passes !== 1 && passes !== 2) throw new Error("Desjardins supports one or two manual preview passes.");
    let firstCollection: DesjardinsCollection | undefined;
    let collection: DesjardinsCollection | undefined;
    for (let pass = 0; pass < passes; pass++) {
    if (pass) {
      await page.goto(historyUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await table.waitFor({ state: "visible", timeout: 30_000 });
      if (!page.url().startsWith(origin) || !/HistoriqueReclamation_ClaimHistory\.aspx/i.test(page.url()))
        throw new Error("Desjardins session expired between preview passes.");
    }
    const warnings: string[] = authWarning ? [authWarning] : [];
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
    const endAuthWarning = await saveDesjardinsAuth(context, page);
    if (endAuthWarning && !warnings.includes(endAuthWarning)) warnings.push(endAuthWarning);
    const current = parseDesjardinsPages(pages, warnings, aliases);
    if (firstCollection) collection = confirmDesjardinsRepeat(firstCollection, current);
    else { firstCollection = current; collection = current; }
    }
    if (!collection) throw new Error("No Desjardins preview was collected.");
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
