/** Built app, synthetic private API, disposable browser contexts. No real service or household data. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { resolve, join, extname, sep } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { OpportunityActions } from "../../worker/dist/opportunity-actions.js";
import { emptyMortgage } from "../../worker/dist/mortgage-model.js";
import { emptyPlan } from "../../worker/dist/grocery-planning.js";
import { newContract } from "../../worker/dist/savings-model.js";

const root = resolve("apps/web/dist"), output = resolve("artifacts/proactive");
const temporary = await mkdtemp(join(tmpdir(), "familyhub-proactive-test-"));
const household = JSON.parse(await readFile("apps/web/tests/fixtures/household.json", "utf8"));
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname.replace(/^\/familyhub/, "");
  const file = resolve(root, "." + (pathname.endsWith("/") ? pathname + "index.html" : pathname));
  if (file !== root && !file.startsWith(root + sep)) return response.writeHead(403).end();
  try {
    response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" })[extname(file)] || "text/plain");
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
server.listen(0, "127.0.0.1"); await once(server, "listening");
const base = "http://127.0.0.1:" + server.address().port + "/familyhub/";
const apiOrigin = "https://opportunity-fixture.invalid";
let browser, diagnostic;
const allErrors = [], external = [], mutations = [], metrics = [];

async function noOverflow(page, label) {
  const size = await page.evaluate(() => ({ actual: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(size.scroll <= size.actual + 1, label + " horizontal overflow: " + JSON.stringify(size));
}
async function waitReady(page) {
  await page.getByRole("heading", { name: "Aujourd’hui", exact: true }).waitFor();
  await page.locator(".today-source-status").filter({ hasText: "7 sources accessibles" }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".today-priorities .opportunity-card").length >= 3);
}
async function setup(width, paired = true) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
  const snapshot = structuredClone(household.snapshot); snapshot.lastSuccess = new Date().toISOString();
  const actions = new OpportunityActions(join(temporary, String(width) + (paired ? "-paired" : "-unpaired") + ".json"));
  const contract = { ...newContract("home-insurance", "synthetic-home"), name: "Synthetic home policy", provider: "Synthetic insurer", renewal: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), updatedAt: new Date().toISOString() };
  const contracts = { schema: 1, records: [{ contract, revision: "synthetic-contract-revision" }], documents: [] };
  const plan = { ...emptyPlan(), revision: "synthetic-plan", items: [{ id: "synthetic-oats", name: "Synthetic oats", quantity: 1, size: 1, unit: "kg", preference: "", substitutions: false, active: true, origin: "synthetic" }] };
  const state = { failed: false, rejectNext: false, snapshot, lifecycleRequests: [], actionReadGate: null, blockFinancesChunk: false, blockedChunks: 0 };
  await context.addInitScript(({ paired, endpoint, stale }) => {
    if (sessionStorage.getItem("synthetic-proactive-initialized")) return;
    sessionStorage.setItem("synthetic-proactive-initialized", "1");
    if (paired) localStorage.setItem("familyhub.worker.v1", JSON.stringify({ Endpoint: endpoint, ApiKey: "synthetic-only" }));
    localStorage.setItem("familyhub.reimbursements.v1", JSON.stringify(stale));
  }, { paired, endpoint: apiOrigin, stale: { ...household.state, Reconciliations: [{ ...household.snapshot.reconciliations[0], Provider: "LOCAL_ONLY_STALE_CARD", PotentialRemaining: 999999 }] } });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === new URL(base).origin) {
      if (state.blockFinancesChunk && /\/FinancesView-[^/]+\.js$/.test(url.pathname)) { state.blockedChunks++; return route.abort("internetdisconnected"); }
      return route.continue();
    }
    if (url.origin !== apiOrigin) { external.push(url.origin); return route.abort(); }
    const reply = (body, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "Access-Control-Allow-Origin": new URL(base).origin, "Access-Control-Allow-Headers": "content-type,x-familyhub-key" }, body: JSON.stringify(body) });
    if (request.method() === "OPTIONS") return reply({});
    if (request.method() !== "GET") {
      mutations.push(url.pathname);
      assert.equal(url.pathname, "/opportunity-actions", "Only explicit opportunity lifecycle writes are allowed");
    }
    if (url.pathname === "/opportunity-actions") {
      if (request.method() === "GET") {
        if (state.actionReadGate) await state.actionReadGate;
        return reply(await actions.read());
      }
      state.lifecycleRequests.push(request.postDataJSON());
      if (state.rejectNext) { state.rejectNext = false; return reply({ error: "Synthetic revision conflict" }, 409); }
      try { return reply(await actions.mutate(request.postDataJSON())); } catch (error) { return reply({ error: error.message }, 409); }
    }
    if (url.pathname === "/invoices") return reply(state.snapshot);
    if (url.pathname === "/savings/contracts") return reply(contracts);
    if (url.pathname === "/savings/research") return reply({ jobs: [], schedule: null, daily: null });
    if (url.pathname === "/finances") return reply({ schema: 1, revision: "synthetic-finance", data: null, decisions: {}, imports: [], decisionHistory: [] });
    if (url.pathname === "/groceries/planning") return reply(plan);
    if (url.pathname === "/groceries") return reply({ schema: 1, revision: "synthetic-purchases", records: [] });
    if (url.pathname === "/mortgage") return state.failed ? reply({ error: "Synthetic unavailable" }, 503) : reply(emptyMortgage());
    if (url.pathname === "/health") return reply({ status: "ok", version: "2.27.0", capabilities: [] });
    if (url.pathname === "/notifications") return reply({ schema: 1, revision: "synthetic-notifications", events: [], preferences: {}, devices: [], sourceErrors: [], scannedAt: null, pushConfigured: false, publicKey: null });
    if (/^\/invoices\/(bluecross|desjardins)$/.test(url.pathname)) return reply({ state: "idle", configured: false });
    if (/^\/portal-reconnect\//.test(url.pathname)) return reply({ state: "idle" });
    return reply({}, 404);
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000); page.on("pageerror", error => allErrors.push(error.message)); diagnostic = page;
  return { page, context, actions, state, contract };
}

try {
  await mkdir(output, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: process.env.FAMILYHUB_TEST_BROWSER_CHANNEL || undefined });
  for (const width of [320, 360, 384, 390, 412, 1280]) {
    const { page, context, actions, state, contract } = await setup(width);
    await page.goto(base); await waitReady(page);
    assert.equal(await page.locator(".bottom-nav button").count(), 5);
    const nav = page.locator(".bottom-nav:visible, .app-rail nav:visible");
    assert.equal(await nav.locator('button[aria-current="page"]' ).getAttribute("aria-label") ?? await nav.locator('button[aria-current="page"]' ).innerText(), "Aujourd’hui");
    assert.equal(await page.locator(".today-priorities .opportunity-card").count(), 3);
    assert.equal(await page.getByText("LOCAL_ONLY_STALE_CARD", { exact: false }).count(), 0);
    assert.equal(await page.locator(".benefit-tile").count(), 3);
    await page.locator(".benefit-tile").nth(2).getByText("Non mesuré", { exact: true }).waitFor();
    assert.equal((await actions.read()).history.length, 0, "Viewing the home does not mutate decisions");
    await noOverflow(page, "Today " + width);
    const controls = await page.locator(".today-view button:visible, .today-view a.button:visible").evaluateAll(elements => elements.map(element => ({ text: element.textContent, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })));
    assert.deepEqual(controls.filter(control => control.width < 47.9 || control.height < 47.9), [], "Today controls have 48px touch areas");

    await page.locator(".benefit-tile").nth(2).click();
    const amounts = page.getByRole("dialog", { name: "Comprendre les montants", exact: true }); await amounts.waitFor();
    await amounts.getByText(/Une carte lue, masquée ou résolue ne prouve aucune économie/).waitFor();
    await noOverflow(page, "Amounts " + width); await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /^Voir les \d+ actions$/ }).click();
    const claimCard = page.locator(".today-priorities .opportunity-card").filter({ has: page.locator('a[href*="view=reimbursements"]') }).first();
    const claimHref = await claimCard.getByRole("link").getAttribute("href");
    const claimId = new URL(claimHref, base).searchParams.get("record");
    assert.ok(state.snapshot.reconciliations.some(record => record.Id === claimId), "The exact target is an authoritative case");
    await claimCard.getByRole("link").click();
    await page.getByRole("heading", { name: "Claims", exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get("record"), claimId);
    await page.getByText("Dossier ouvert depuis un lien direct.", { exact: false }).waitFor();
    await page.goBack(); await waitReady(page);

    // Persisted lifecycle survives a full page reload; failed writes never disappear optimistically.
    const target = page.locator(".today-priorities .opportunity-card").first();
    const targetHref = await target.getByRole("link").getAttribute("href");
    const targetUrl = new URL(targetHref, base);
    assert.equal(targetUrl.searchParams.get("view"), "savings");
    assert.equal(targetUrl.searchParams.get("record"), contract.id, "Lifecycle exercises the exact insurance renewal, not an unrelated card");
    const renewalContext = { kind: "insurance-renewal", recordId: contract.id, dueDate: contract.renewal };
    await target.getByRole("button", { name: /^Sources et options/ }).click();
    let dialog = page.locator("dialog[open]");
    await dialog.getByRole("button", { name: "Reporter de 7 jours", exact: true }).click();
    await page.getByText(/Piste reportée de 7 jours/).waitFor();
    const snoozed = Object.values((await actions.read()).decisions);
    assert.equal(snoozed.length, 1); assert.equal(snoozed[0].state, "snoozed");
    assert.deepEqual(state.lifecycleRequests.at(-1).context, renewalContext, "Renewal context is sent with the single lifecycle mutation");
    assert.deepEqual(snoozed[0].context, renewalContext, "Renewal notification context is persisted with the home decision");
    if (width === 320) {
      let releaseActions;
      state.actionReadGate = new Promise(done => { releaseActions = done; });
      try {
        await page.reload();
        await page.locator(".today-source-status").click();
        await page.waitForFunction(() => [...document.querySelectorAll(".today-source-list .opportunity-status")].filter(element => element.textContent === "Accessible").length === 7);
        assert.equal(await page.locator(".today-priorities").getAttribute("aria-busy"), "true");
        assert.equal(await page.locator(".today-priorities .opportunity-card").count(), 0, "A pending decision read must not flash a previously snoozed card");
        await page.keyboard.press("Escape");
      } finally { releaseActions(); state.actionReadGate = null; }
      await waitReady(page);
    } else { await page.reload(); await waitReady(page); }
    assert.deepEqual(Object.values((await actions.read()).decisions)[0].context, renewalContext);

    assert.equal(await page.locator(".today-priorities").locator("a").evaluateAll((elements, href) => elements.filter(element => element.getAttribute("href") === href).length, targetHref), 0);
    await page.getByRole("button", { name: /^Pistes gérées/ }).click();
    await page.locator(".opportunity-managed").getByRole("button", { name: /^Sources et options/ }).click();
    dialog = page.locator("dialog[open]");
    await dialog.getByRole("button", { name: "Réafficher dans mes actions", exact: true }).click();
    await page.getByText("Piste réaffichée dans vos actions.", { exact: true }).waitFor();
    assert.equal(state.lifecycleRequests.at(-1).action, "restore");
    assert.deepEqual(state.lifecycleRequests.at(-1).context, renewalContext);
    assert.equal(Object.keys((await actions.read()).decisions).length, 0);
    await page.reload(); await waitReady(page);
    assert.equal(await page.locator(".today-priorities a").evaluateAll((elements, href) => elements.filter(element => element.getAttribute("href") === href).length, targetHref), 1, "Restored renewal reappears after reload");
    assert.equal(Object.keys((await actions.read()).decisions).length, 0, "Restoration survives a fresh worker-state read");

    if (width === 384) {
      await page.locator(".today-priorities .opportunity-card").first().getByRole("button", { name: /^Sources et options/ }).click();
      state.rejectNext = true;
      await page.locator("dialog[open]").getByRole("button", { name: "Masquer cette piste", exact: true }).click();
      await page.locator("dialog[open]").getByText(/La liste a changé sur un autre appareil/).waitFor();
      assert.equal(Object.keys((await actions.read()).decisions).length, 0);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Actualiser les priorités", exact: true }).click(); await waitReady(page);

      await page.locator(".today-priorities .opportunity-card").first().getByRole("button", { name: /^Sources et options/ }).click();
      await page.locator("dialog[open]").getByText("Marquer comme traitée ne valide aucun gain ni aucune soumission.", { exact: true }).waitFor();
      await page.locator("dialog[open]").getByRole("button", { name: "Marquer comme traitée", exact: true }).click();
      await page.getByText(/Piste marquée comme traitée/).waitFor();
      assert.equal(state.lifecycleRequests.at(-1).action, "resolve");
      assert.deepEqual(state.lifecycleRequests.at(-1).context, renewalContext);
      const resolved = Object.values((await actions.read()).decisions);
      assert.equal(resolved.length, 1); assert.equal(resolved[0].state, "resolved");
      assert.deepEqual(resolved[0].context, renewalContext);
      await page.reload(); await waitReady(page);
      assert.equal(await page.locator(".today-priorities a").evaluateAll((elements, href) => elements.filter(element => element.getAttribute("href") === href).length, targetHref), 0, "Treated renewal stays managed after reload");
      await page.locator(".benefit-tile").nth(2).getByText("Non mesuré", { exact: true }).waitFor();
      await page.getByRole("button", { name: /^Pistes gérées/ }).click();
      await page.locator(".opportunity-managed").getByRole("button", { name: /^Sources et options/ }).click();
      await page.locator("dialog[open]").getByRole("button", { name: "Réafficher dans mes actions", exact: true }).click();
      await page.getByText("Piste réaffichée dans vos actions.", { exact: true }).waitFor();
      assert.equal(state.lifecycleRequests.at(-1).action, "restore");
      assert.deepEqual(state.lifecycleRequests.at(-1).context, renewalContext);
      await page.reload(); await waitReady(page);
      assert.equal(Object.keys((await actions.read()).decisions).length, 0);
      assert.equal(await page.locator(".today-priorities a").evaluateAll((elements, href) => elements.filter(element => element.getAttribute("href") === href).length, targetHref), 1);

      state.failed = true;
      await page.getByRole("button", { name: "Actualiser les priorités", exact: true }).click();
      await page.locator(".today-source-status").filter({ hasText: "1 source à revoir" }).waitFor();
      await page.getByRole("button", { name: /^Voir les \d+ actions$/ }).click();
      await page.getByRole("heading", { name: "Sources à actualiser", exact: true }).waitFor();
      await page.locator(".today-source-status").click();
      await page.locator("dialog[open]").getByRole("heading", { name: "Hypothèque", exact: true }).waitFor();
      await noOverflow(page, "Partial sources"); await page.keyboard.press("Escape");
      state.failed = false; state.snapshot.lastSuccess = "2000-01-01T12:00:00Z";
      await page.getByRole("button", { name: "Actualiser les priorités", exact: true }).click(); await waitReady(page);
      await page.locator(".recovery-tile").getByText("À vérifier", { exact: true }).waitFor();
      await context.setOffline(true);
      await page.getByText("Connexion interrompue", { exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Actualiser les priorités", exact: true }).isDisabled(), true);
      await noOverflow(page, "Offline"); await context.setOffline(false);
      state.snapshot.lastSuccess = new Date().toISOString();
    }

    // Every previous main or secondary section remains reachable through the Plus menu.
    for (const [label, route] of [["Finances", "finances"], ["Hypothèque", "mortgage"], ["Documents", "documents"], ["Notifications", "notifications"], ["Courrier important", "inbox"], ["Planifier", "plan"], ["Money · outils locaux", "money"], ["Réglages et outils", "more"]]) {
      await nav.getByRole("button", { name: "Plus", exact: true }).click();
      await page.locator(".other-link").filter({ hasText: label }).click();
      assert.equal(new URL(page.url()).searchParams.get("view"), route);
      await page.locator("main h1").first().waitFor();
      assert.equal(await nav.getByRole("button", { name: "Plus", exact: true }).getAttribute("aria-current"), "page");
      if (route === "documents") for (const [name, source] of [["Factures", "invoices"], ["Desjardins", "desjardins"], ["Blue Cross", "blue-cross"]]) {
        await page.getByRole("navigation", { name: "Sources documentaires", exact: true }).getByRole("button", { name, exact: true }).click();
        assert.equal(new URL(page.url()).searchParams.get("view"), source);
      }
    }
    await page.goto(base + "?view=groceries&tab=compare");
    await page.getByRole("navigation", { name: "Gestion Courses", exact: true }).getByRole("button", { name: "Comparer", exact: true }).waitFor();
    await noOverflow(page, "Grocery deep link " + width);
    await page.goto(base); await waitReady(page);
    await page.screenshot({ path: join(output, "today-" + width + ".png"), fullPage: true });
    metrics.push({ width, defaultToday: true, fiveTabs: true, overflow: false, persistence: true, deepLinks: true });
    await context.close();
  }
  // A missing lazy section leaves the navigation usable; retry reloads the same route without clearing saved data.
  {
    const { page, context, state } = await setup(360);
    await page.goto(base); await waitReady(page);
    const saved = await page.evaluate(() => ({ records: localStorage.getItem("familyhub.reimbursements.v1"), pairing: localStorage.getItem("familyhub.worker.v1") }));
    state.blockFinancesChunk = true;
    const nav = page.locator(".bottom-nav:visible, .app-rail nav:visible");
    await nav.getByRole("button", { name: "Plus", exact: true }).click();
    await page.locator(".other-link").filter({ hasText: "Finances" }).click();
    await page.getByRole("heading", { name: "Section indisponible", exact: true }).waitFor();
    assert.ok(state.blockedChunks >= 1, "The synthetic request failure must reach the unloaded Finances chunk");
    assert.equal(await nav.getByRole("button").count(), 5);
    assert.equal(new URL(page.url()).searchParams.get("view"), "finances");
    await noOverflow(page, "Unloaded section failure");
    const retryBox = await page.getByRole("button", { name: "Réessayer", exact: true }).boundingBox();
    assert.ok(retryBox.width >= 48 && retryBox.height >= 48);
    await nav.getByRole("button", { name: "Aujourd’hui", exact: true }).click(); await waitReady(page);
    await nav.getByRole("button", { name: "Plus", exact: true }).click();
    await page.locator(".other-link").filter({ hasText: "Finances" }).click();
    await page.getByRole("heading", { name: "Section indisponible", exact: true }).waitFor();
    await page.getByRole("button", { name: "Retour à l’accueil", exact: true }).click(); await waitReady(page);
    await nav.getByRole("button", { name: "Plus", exact: true }).click();
    await page.locator(".other-link").filter({ hasText: "Finances" }).click();
    await page.getByRole("heading", { name: "Section indisponible", exact: true }).waitFor();
    state.blockFinancesChunk = false;
    await page.getByRole("button", { name: "Réessayer", exact: true }).click();
    await page.getByRole("heading", { name: "Finances", exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get("view"), "finances", "Retry preserves the requested section");
    assert.deepEqual(await page.evaluate(() => ({ records: localStorage.getItem("familyhub.reimbursements.v1"), pairing: localStorage.getItem("familyhub.worker.v1") })), saved, "Section recovery does not clear private records or worker pairing");
    await noOverflow(page, "Recovered Finances section");
    await context.close();
  }
  const { page, context } = await setup(360, false);
  await page.goto(base);
  await page.getByRole("heading", { name: "Retrouver vos priorités", exact: true }).waitFor();
  assert.equal(await page.locator(".benefit-tile").count(), 0);
  await page.getByRole("button", { name: "Ouvrir les réglages", exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.get("view"), "more");
  await context.close();
  assert.deepEqual(external, []); assert.deepEqual(allErrors, []);
  assert.ok(mutations.length >= 12); assert.ok(mutations.every(path => path === "/opportunity-actions"));
  await writeFile(join(output, "report.json"), JSON.stringify({ metrics, errors: allErrors, external, lifecycleWrites: mutations.length }, null, 2));
  console.log("PASS proactive home: six widths, source authority, partial/offline/unpaired states, five-tab navigation, exact links, persisted renewal context, delayed reads, restores, rejected writes, and failed-chunk recovery.");
} catch (error) {
  if (diagnostic && !diagnostic.isClosed()) { await diagnostic.screenshot({ path: join(output, "failure.png"), fullPage: true }); await writeFile(join(output, "failure.txt"), await diagnostic.locator("body").innerText()); }
  throw error;
} finally {
  await browser?.close(); await new Promise(done => server.close(done));
  if (!resolve(temporary).startsWith(resolve(tmpdir()) + sep)) throw new Error("Temporary cleanup escaped test directory");
  await rm(temporary, { recursive: true, force: true });
}
