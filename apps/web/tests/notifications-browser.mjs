/** Built PWA, real local service worker, synthetic paired API and mocked device enrollment. No provider is contacted. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve, extname, sep } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { NotificationLibrary } from "../../worker/dist/notification-library.js";
import { SavingsLibrary } from "../../worker/dist/savings-library.js";
import { now, pushFixture, invoiceEvidence, financeEvidence, contractEvidence } from "../../../tests/notification-fixture.mjs";
const root = resolve("apps/web/dist"), server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname, path = resolve(root, "." + pathname.replace(/^\/familyhub/, ""));
  if (path !== root && !path.startsWith(root + sep)) return res.writeHead(403).end();
  try { const file = pathname.endsWith("/") ? join(path, "index.html") : path; res.setHeader("Content-Type", { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" }[extname(file)] ?? "text/plain"); res.end(await readFile(file)); } catch { res.writeHead(404).end(); }
});
server.listen(0, "127.0.0.1"); await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}/familyhub/`, temp = await mkdtemp(join(tmpdir(), "familyhub-notifications-browser-"));
const output = resolve("output/playwright/notifications"); await mkdir(output, { recursive: true });
const source = invoiceEvidence(), document = (id, role = "expense") => ({ Id: id, AccountLabel: "Synthetic", AccountEmail: "synthetic@example.test", SourceMessageId: id, ThreadId: id, InternetMessageId: id, Subject: "Synthetic source", Sender: "synthetic@example.test", Provider: "Synthetic clinic", ReceivedAt: "2026-10-10T12:00:00Z", Category: 0, Status: 0, DetectedAmount: 100, Currency: "CAD", Confidence: 95, Notes: "Synthetic fixture only", Attachments: [], DocumentType: role === "expense" ? "invoice" : "claim", DocumentRole: role, WorkerManaged: true, NeedsReview: false, Member: "unknown", ServiceDate: "2026-10-10", BilledAmount: 100 });
source.items = [{ ...document("payment-synthetic", "insurer-statement"), ...source.items[0], Insurer: "blue-cross" }, document("expense-synthetic"), { ...document("unmatched-synthetic", "insurer-statement"), Provider: "Synthetic unmatched", BilledAmount: null, ReimbursedAmount: 30, ServiceDate: null, Insurer: "unknown", NeedsReview: true }];
source.reconciliations[0] = { ...source.reconciliations[0], Member: "unknown", Provider: "Synthetic clinic", ServiceDate: "2026-10-10", OriginalAmount: 100, ReimbursedAmount: 80, Action: "review-amount", Status: "needs-attention", Summary: "Synthetic claim source", Confidence: 95, DocumentIds: ["expense-synthetic", "payment-synthetic"], ExpenseDocumentId: "expense-synthetic", ExpenseDocumentIds: ["expense-synthetic"], NextInsurer: null };
source.reconciliations[0].MatchAssignments = source.reconciliations[0].MatchAssignments.map(match => ({ ...match, ExpenseDocumentId: "expense-synthetic", Insurer: "blue-cross", Evidence: ["Synthetic operator-confirmed source association"] }));
source.unmatchedReimbursements = [{ DocumentId: "unmatched-synthetic", Reason: "needs-review" }];
Object.assign(source, { ignoredUnmatchedReimbursements: [], ignoredExpenses: [], cleanupSuggestions: [], importantMail: [], agentReviews: [], learning: { decisions: 0 }, busy: false, lastSuccess: now.toISOString() });
let browser, diagnosticPage;
try {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  for (const width of [320, 390, 768, 1440]) {
    const push = pushFixture(String(width)), sent = [], lib = new NotificationLibrary(join(temp, String(width), "notifications.json"), async () => push.config, async (_subscription, id) => { sent.push(id); return "accepted"; });
    const savings = new SavingsLibrary(join(temp, String(width), "contracts.json")), contract = contractEvidence(), finance = financeEvidence();
    finance.data.accounts.push({ ...finance.data.accounts[0], id: "usd-account", currency: "USD" });
    finance.data.transactions.push({ ...finance.data.transactions[0], id: "usd-expense", accountId: "usd-account", currency: "USD" });
    await savings.import({ contracts: [contract], documents: [] });
    await lib.scan({ invoices: source, finance, contracts: [contract], collections: [{ id: "test", label: "Synthetic collector", state: "error" }] }, [], now);
    const context = await browser.newContext({ viewport: { width, height: 900 }, permissions: ["notifications"] });
    await context.addInitScript(({ push }) => {
      localStorage.setItem("familyhub.worker.v1", JSON.stringify({ Endpoint: "https://synthetic-worker.invalid", ApiKey: "synthetic-key" }));
      window.__notificationCalls = []; window.__notificationPermission = sessionStorage.getItem("synthetic-permission") || "granted";
      Object.defineProperty(Notification, "permission", { get: () => window.__notificationPermission });
      Notification.requestPermission = async () => { window.__notificationCalls.push({ action: "permission", active: navigator.userActivation.isActive }); return window.__notificationPermission; };
      const subscription = () => ({ endpoint: push.subscription.endpoint, options: { applicationServerKey: Uint8Array.from(atob(push.config.publicKey.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)).buffer }, toJSON: () => push.subscription, unsubscribe: async () => { localStorage.removeItem("synthetic-push"); return true; } });
      PushManager.prototype.getSubscription = async () => localStorage.getItem("synthetic-push") ? subscription() : null;
      PushManager.prototype.subscribe = async options => { window.__notificationCalls.push({ action: "subscribe", visible: options.userVisibleOnly }); localStorage.setItem("synthetic-push", "1"); return subscription(); };
    }, { push });
    let offline = false, version = "2.24.0", rejectNext = false, posts = 0, emptyHistory = false, configured = true;
    const external = [], errors = [];
    await context.route("**/*", async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin === new URL(base).origin) return route.continue();
      if (url.hostname !== "synthetic-worker.invalid") { external.push(url.origin); return route.abort(); }
      if (offline) return route.abort();
      const reply = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
      try {
        if (req.method() === "OPTIONS") return reply({});
        if (url.pathname === "/health") return reply({ status: "ok", version });
        if (url.pathname === "/notifications") { if (req.method() === "GET") { const saved = await lib.read(); return reply({ ...saved, ...(emptyHistory ? { events: [] } : {}), ...(!configured ? { pushConfigured: false, publicKey: null } : {}) }); } posts++; if (rejectNext) { rejectNext = false; return reply({ error: "Les notifications ont changé. Actualisez avant de réessayer." }, 409); } return reply(await lib.mutate(req.postDataJSON())); }
        if (url.pathname === "/finances") return reply(finance);
        if (url.pathname === "/savings/contracts") return reply(await savings.list());
        if (url.pathname === `/savings/contracts/${contract.id}`) return reply(await savings.update(contract.id, req.postDataJSON()));
        if (url.pathname === "/savings/research") return reply({ jobs: [], schedule: null });
        if (url.pathname === "/invoices") return reply(source);
        if (/^\/invoices\/(bluecross|desjardins)$/.test(url.pathname)) return reply({ state: "idle", configured: false });
        if (/^\/portal-reconnect\//.test(url.pathname)) return reply({ state: "idle" });
        return reply({}, 404);
      } catch (e) { return reply({ error: e.message }, 400); }
    });
    const page = await context.newPage(); diagnosticPage = page; page.setDefaultTimeout(12000); page.on("pageerror", e => errors.push(e.message));
    const open = async (query = "view=notifications") => { await page.goto(base + "?" + query); await page.getByRole("heading", { name: query.includes("view=notifications") ? "Notifications" : query.includes("view=finances") ? "Finances" : query.includes("view=savings") ? "Dépenses récurrentes" : "Claims", exact: true }).waitFor(); };
    const noOverflow = async () => { const overflow = await page.evaluate(() => [...document.querySelectorAll("body *")].filter(e => e.getBoundingClientRect().width && (e.getBoundingClientRect().right > innerWidth + 1 || e.getBoundingClientRect().left < -1)).slice(0, 12).map(e => ({ tag: e.tagName, class: e.className, width: e.getBoundingClientRect().width, text: e.textContent.slice(0,100) }))); if (overflow.length) { console.log(JSON.stringify(overflow)); await page.screenshot({ path: join(output, `overflow-${width}.png`), fullPage: true }); } assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); };
    await open(); await page.locator(".notification-card").first().waitFor(); assert.equal((await page.evaluate(() => window.__notificationCalls)).length, 0);
    await page.getByRole("button", { name: "Marquer comme lu" }).first().click(); await page.getByText("Enregistré sur le PC.", { exact: true }).waitFor(); await page.getByLabel("Non lues seulement").check(); assert.equal(await page.locator(".notification-card:not(.unread)").count(), 0);
    await page.getByRole("button", { name: "Préférences", exact: true }).click(); const settings = page.getByRole("dialog", { name: "Préférences de notification" });
    await settings.getByLabel("Résumé hebdomadaire", { exact: true }).click(); await page.waitForFunction(() => !document.querySelector('fieldset')?.disabled);
    await page.keyboard.press("Escape"); assert.equal(await page.getByRole("button", { name: "Préférences", exact: true }).evaluate(e => e === document.activeElement), true); await page.reload(); await page.locator(".notification-card").first().waitFor(); await page.getByRole("button", { name: "Préférences", exact: true }).click(); assert.equal(await settings.getByLabel("Résumé hebdomadaire", { exact: true }).isChecked(), false);
    await settings.getByLabel(/Nom de l.appareil/).fill("Téléphone synthétique"); await settings.getByRole("button", { name: "Activer sur cet appareil", exact: true }).click(); await settings.getByRole("heading", { name: "Téléphone synthétique", exact: true }).waitFor();
    const calls = await page.evaluate(() => window.__notificationCalls); assert.deepEqual(calls, [{ action: "permission", active: true }, { action: "subscribe", visible: true }]); assert.equal(sent.length, 0, "enrollment must not replay historical alerts");
    await settings.getByRole("button", { name: "Envoyer un test", exact: true }).click(); await settings.getByText(/Dernier envoi accepté/).waitFor(); assert.equal(sent.length, 1); assert.equal((await lib.read()).devices[0].lastDelivery.confirmedAt, undefined);
    await settings.getByRole("button", { name: /J.ai reçu la notification/ }).click(); await settings.getByText(/Réception confirmée par vous\.$/).waitFor(); assert.ok((await lib.read()).devices[0].lastDelivery.confirmedAt);
    await noOverflow(); await page.screenshot({ path: join(output, `preferences-${width}.png`), fullPage: true });
    await settings.getByRole("button", { name: "Désactiver dans ce navigateur", exact: true }).click(); await settings.getByRole("button", { name: "Retirer cet appareil", exact: true }).click(); await settings.getByText("Aucun appareil inscrit.", { exact: true }).waitFor();
    rejectNext = true; await settings.getByLabel("Résumé hebdomadaire", { exact: true }).click(); await settings.getByText(/Actualisez avant de réessayer/).waitFor(); assert.equal((await lib.read()).preferences.weekly, false);
    await page.keyboard.press("Escape"); await page.getByRole("button", { name: "Actualiser", exact: true }).click(); await page.getByRole("button", { name: "Préférences", exact: true }).click(); await settings.getByLabel("Résumé hebdomadaire", { exact: true }).click(); await page.waitForFunction(() => !document.querySelector('fieldset')?.disabled); assert.equal((await lib.read()).preferences.weekly, true);
    await page.keyboard.press("Escape"); const notice = (await lib.read()).events.find(e => e.kind === "deadline"); await open(`view=notifications&notice=${notice.id}`); await page.waitForFunction(id => document.activeElement?.id === `notice-${id}`, notice.id); await page.locator(`#notice-${notice.id}`).getByRole("link", { name: "Ouvrir le dossier" }).click();
    await page.getByRole("dialog").filter({ has: page.getByText("Prix contractuel source conservé", { exact: false }) }).waitFor();
    const visibleDetails = page.locator("dialog[open]"); await visibleDetails.getByRole("button", { name: /Complete details|Edit/, exact: true }).click(); const form = page.getByRole("dialog", { name: "Edit contract", exact: true }); await form.getByText("Promotions, discounts and notes", { exact: true }).click(); await form.getByLabel("Fin de promotion confirmée", { exact: true }).fill("2026-11-01"); await form.getByLabel("Source de cette date", { exact: true }).fill("Synthetic contract page 4"); await form.getByRole("button", { name: "Save contract", exact: true }).click(); await page.getByText("Contract saved on this device and your paired PC.", { exact: true }).waitFor(); assert.equal((await savings.list()).records[0].contract.promotionEnd.date, "2026-11-01");
    await open("view=finances&record=subscription2"); await page.getByRole("dialog", { name: /Vérifier l.opération/ }).waitFor(); await page.keyboard.press("Escape"); assert.equal(await page.locator(".finance-tabs button").count(), 3); await page.getByRole("button", { name: "Tendances", exact: true }).waitFor();
    await open("view=finances&from=2026-10-05&to=2026-10-11&currency=USD"); await page.getByLabel("Du", { exact: true }).waitFor(); assert.equal(await page.getByLabel("Du", { exact: true }).inputValue(), "2026-10-05"); assert.equal(await page.getByLabel("Au", { exact: true }).inputValue(), "2026-10-11"); assert.equal(await page.getByLabel("Devise", { exact: true }).inputValue(), "USD"); await noOverflow();
    await page.evaluate(() => { sessionStorage.setItem("familyhub.ui.claims.query", JSON.stringify("Saved unrelated query")); sessionStorage.setItem("familyhub.ui.claims.person", JSON.stringify("Jasmine")); });
    await open("view=reimbursements&record=claim-synthetic"); await page.getByText("Dossier ouvert depuis une notification.", { exact: false }).waitFor(); await page.locator(".expense-card").filter({ hasText: "Synthetic clinic" }).waitFor();
    assert.equal(await page.evaluate(() => sessionStorage.getItem("familyhub.ui.claims.query")), JSON.stringify("Saved unrelated query"));
    await open("view=reimbursements&record=unmatched-synthetic&queue=unmatched"); await page.getByText("Synthetic unmatched", { exact: true }).first().waitFor(); await noOverflow();
    await open(); await page.locator(".notification-card").first().waitFor(); await noOverflow(); await page.screenshot({ path: join(output, `history-${width}.png`), fullPage: true });
    offline = true; await page.getByRole("button", { name: "Actualiser", exact: true }).click(); await page.getByText(/Cannot reach your FamilyHub PC/).waitFor(); assert.ok(await page.locator(".notification-card").count() > 0); offline = false;
    version = "2.23.3"; await page.reload(); await page.getByText(/notifications nécessitent le worker PC 2.24.0/).waitFor(); version = "2.24.0";
    if (width === 320) {
      configured = false; await open(); await page.locator(".notification-card").first().waitFor(); await page.getByRole("button", { name: "Préférences", exact: true }).click();
      assert.equal(await settings.getByRole("button", { name: "Activer sur cet appareil", exact: true }).isDisabled(), true); assert.deepEqual(await page.evaluate(() => window.__notificationCalls), []); await page.keyboard.press("Escape");
      configured = true; await page.evaluate(() => sessionStorage.setItem("synthetic-permission", "denied")); await open(); await page.locator(".notification-card").first().waitFor(); await page.getByRole("button", { name: "Préférences", exact: true }).click();
      await settings.getByText(/bloquée dans les réglages/).waitFor(); assert.equal(await settings.getByRole("button", { name: "Activer sur cet appareil", exact: true }).isDisabled(), true); assert.deepEqual(await page.evaluate(() => window.__notificationCalls), []); await page.keyboard.press("Escape");
      emptyHistory = true; await open(); await page.getByText("Aucune mise à jour disponible", { exact: true }).waitFor(); assert.equal(await page.locator(".notification-card").count(), 0); await noOverflow();
    }
    await page.evaluate(() => localStorage.removeItem("familyhub.worker.v1")); await context.close(); assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.ok(posts >= 7);
    console.log(`PASS notification history, preferences, enrollment lifecycle and source links at ${width}px`);
  }
  const unpaired = await browser.newContext({ viewport: { width: 320, height: 800 } }), page = await unpaired.newPage(); await page.goto(base + "?view=notifications"); await page.getByText(/Associez votre PC/).waitFor(); await unpaired.close();
} catch (error) {
  if (diagnosticPage && !diagnosticPage.isClosed()) {
    console.error(JSON.stringify({ url: diagnosticPage.url(), visible: await diagnosticPage.locator("body").innerText() }));
    await diagnosticPage.screenshot({ path: join(output, "failure.png"), fullPage: true });
  }
  throw error;
} finally { await browser?.close(); await new Promise(r => server.close(r)); await rm(temp, { recursive: true, force: true }); }
