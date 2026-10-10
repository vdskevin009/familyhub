import type { Page } from "playwright";
import { classifyLoginScreen } from "./portal-login.js";

export const desjardinsReaderSelectors = {
  patient: "select[id$='cbPour']",
  category: "select[id$='cbCategorie']",
  pageSize: "select[id$='cbNbResltRechr']",
  search: "input[id$='btnRechercher']"
} as const;
export type ReaderStage = "filters-inspect" | "filter-patient" | "filter-category" | "filter-page-size" | "search-submit" | "search-history" | "history-read" | "detail-open" | "detail-read" | "detail-return" | "pagination";
type FilterName = "patient" | "category" | "pageSize";
const expected = { patient: ["Tous les patients", "All Patients"], category: ["Toutes les catégories", "All Services"], pageSize: ["100"] };

/** Only fixed vocabulary and counts leave the DOM; never patient names, IDs or values. */
export async function inspectDesjardinsFilters(page: Page) {
  const result = {} as Record<FilterName, { controls: number; options: number; expected: number; selectedExpected: boolean; alternatives: string[] }>;
  for (const name of ["patient", "category", "pageSize"] as const) {
    const control = page.locator(desjardinsReaderSelectors[name]);
    const controls = await control.count();
    if (controls !== 1) { result[name] = { controls, options: 0, expected: 0, selectedExpected: false, alternatives: [] }; continue; }
    result[name] = { controls, ...await control.evaluate((select, args) => {
      const options = Array.from((select as HTMLSelectElement).options);
      const normalize = (text: string) => text.normalize("NFKC").replace(/\s+/g, " ").trim();
      const matches = options.filter(option => args.labels.includes(normalize(option.label)));
      const vocabulary = ["Tous", "Tous les patients", "Tous les assurés", "Tous les bénéficiaires", "Toutes", "Toutes les catégories", "100", "All Patients", "All Services"];
      return { options: options.length, expected: matches.length, selectedExpected: matches.length === 1 && matches[0].selected,
        alternatives: vocabulary.filter(label => options.some(option => normalize(option.label) === label)) };
    }, { labels: expected[name] }) };
  }
  return result;
}

export function createReaderStages(report: (entry: { stage: ReaderStage; state: "started" | "complete" | "failed"; errorKind?: "timeout" | "network" | "structure" | "other" }) => Promise<void>) {
  return async function stage<T>(stage: ReaderStage, action: () => Promise<T>): Promise<T> {
    await report({ stage, state: "started" });
    try { const result = await action(); await report({ stage, state: "complete" }); return result; }
    catch (error) {
      const message = error instanceof Error ? error.message : "";
      const errorKind = /timeout|timed out/i.test(message) ? "timeout" : /net::|network|ECONNRESET/i.test(message) ? "network"
        : /structure|option|filter/i.test(message) ? "structure" : "other";
      await report({ stage, state: "failed", errorKind });
      throw error;
    }
  };
}

/** Observe saved-session redirects only. This function has no credential dependency. */
export async function observeDesjardinsSession(page: () => Page, ready: () => Promise<boolean>, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  do {
    if (await ready()) return true;
    const current = page();
    if (current.isClosed() || await desjardinsSessionExpired(current) || await current.locator('input[type="password"]').first().isVisible().catch(() => false)
      || classifyLoginScreen(await current.locator('body').innerText().catch(() => ''))) return false;
    if (Date.now() >= deadline) return false;
    await current.waitForTimeout(500);
  } while (Date.now() < deadline);
  return false;
}

export async function inspectDesjardinsNavigation(page: Page) {
  const links: Record<string, number> = {};
  for (const name of ["Historique", "Réclamations traitées", "Historique des réclamations", "Processed claims", "Claims history", "History"])
    links[name] = await page.getByRole('link', { name, exact: true }).count();
  return { links, historyGrid: await page.locator('table.tableau-donnees').count(),
    sessionExpired: await desjardinsSessionExpired(page),
    passwordVisible: await page.locator('input[type="password"]').first().isVisible().catch(() => false),
    challenge: classifyLoginScreen(await page.locator('body').innerText().catch(() => '')) ?? null };
}

export async function desjardinsSessionExpired(page: Page) {
  try {
    const url = new URL(page.url());
    if (url.origin !== 'https://www.agea-gbim.dsf-dfs.com' || url.username || url.password) return false;
    return /(?:^|\n)\s*(?:Session expirée|Expired session)\s*(?:\n|$)/i.test(await page.locator('body').innerText());
  } catch { return false; }
}

/** Validate all filters before the first event; missing labels are a structure failure, never a network retry. */
export async function configureDesjardinsFilters(page: Page, stage: ReturnType<typeof createReaderStages>) {
  const guard = () => {
    const url = new URL(page.url());
    if (url.username || url.password || url.origin !== 'https://www.agea-gbim.dsf-dfs.com'
      || !/^\/AGEA-GBIM\/Rclmtn\/RclmtnTrt\/HistoriqueReclamation_ClaimHistory\.aspx$/i.test(url.pathname))
      throw new Error('Processed-claims filter structure changed (location).');
  };
  guard();
  const values = await stage('filters-inspect', async () => {
    const values = {} as Record<FilterName, string>;
    for (const name of ['patient', 'category', 'pageSize'] as const) {
      guard();
      const control = page.locator(desjardinsReaderSelectors[name]);
      if (await control.count() !== 1) throw new Error(`Processed-claims filter structure changed (${name}).`);
      const value = await control.evaluate((select, labels) => {
        const options = Array.from((select as HTMLSelectElement).options);
        const matches = options.filter(option => labels.includes(option.label.normalize('NFKC').replace(/\s+/g, ' ').trim()) && !option.disabled);
        return matches.length === 1 && options.filter(option => option.value === matches[0].value).length === 1 ? matches[0].value : null;
      }, expected[name]);
      if (value === null) throw new Error(`Processed-claims filter structure changed (${name}).`);
      values[name] = value;
    }
    return values;
  });
  for (const [name, step] of [['patient', 'filter-patient'], ['category', 'filter-category'], ['pageSize', 'filter-page-size']] as const)
    await stage(step, async () => { guard(); await page.locator(desjardinsReaderSelectors[name]).selectOption({ value: values[name] }, { timeout: 5000 }); });
  await stage('search-submit', async () => { guard(); await page.locator(desjardinsReaderSelectors.search).click({ timeout: 10_000 }); });
  await stage('search-history', async () => {
    await page.waitForURL(/HistoriqueReclamation_ClaimHistory\.aspx/i, { timeout: 30_000 });
    guard(); await page.locator('table.tableau-donnees').waitFor({ state: 'visible', timeout: 30_000 });
  });
}
