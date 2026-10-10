import type { BrowserContext, Page } from "playwright";

type Insurer = "desjardins" | "bluecross";
export type HistoryTabDiagnostic = {
  contextPages: number;
  currentClosed: boolean;
  currentStage: "history" | "login" | "portal" | "other";
  historyPages: number;
  readyPages: number;
  selection: "current" | "other-tab" | "ambiguous" | "waiting";
};
const rules = {
  desjardins: { origin: "https://www.agea-gbim.dsf-dfs.com", path: /^\/AGEA-GBIM\/Rclmtn\/RclmtnTrt\/HistoriqueReclamation_ClaimHistory\.aspx$/i, grid: "table.tableau-donnees" },
  bluecross: { origin: "https://service.pac.bluecross.ca", path: /^\/ACESWeb\/Pages\/Claims\/Claims\.aspx$/i, grid: "table[id*='grdClaimsGrid']" }
};
export function isInsurerPortalPage(page: Page, insurer: Insurer): boolean {
  try { const url = new URL(page.url()); return !url.username && !url.password && url.origin === rules[insurer].origin; }
  catch { return false; }
}
function stage(page: Page, insurer: Insurer): HistoryTabDiagnostic["currentStage"] {
  try {
    const url = new URL(page.url());
    if (url.username || url.password) return "other";
    const rule = rules[insurer];
    if (url.origin === rule.origin) return rule.path.test(url.pathname) ? "history" : /\/login\/?$/i.test(url.pathname) ? "login" : "portal";
    if (insurer === "desjardins" && url.origin === "https://id.desjardins.com" && url.pathname === "/login") return "login";
  } catch { /* A closed/redirecting page is not authenticated evidence. */ }
  return "other";
}

/** Observe only this collector's context. Never navigate, submit login or move browser state. */
export async function findPortalHistoryPage(context: BrowserContext, current: Page, insurer: Insurer): Promise<{ page?: Page; diagnostic: HistoryTabDiagnostic }> {
  const pages = context.pages().filter(page => !page.isClosed());
  const history = pages.filter(page => stage(page, insurer) === "history");
  const ready: Page[] = [];
  for (const page of history) {
    const grid = page.locator(rules[insurer].grid);
    if (await grid.count().catch(() => 0) === 1 && await grid.isVisible().catch(() => false)) ready.push(page);
  }
  // Keep an already verified current page. Otherwise require one unique history tab.
  const selected = ready.includes(current) ? current : ready.length === 1 ? ready[0] : undefined;
  return { page: selected, diagnostic: {
    contextPages: pages.length, currentClosed: current.isClosed(), currentStage: stage(current, insurer),
    historyPages: history.length, readyPages: ready.length,
    selection: selected === current ? "current" : selected ? "other-tab" : ready.length > 1 ? "ambiguous" : "waiting"
  } };
}
