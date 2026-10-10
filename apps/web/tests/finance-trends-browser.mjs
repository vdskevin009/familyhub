/** Synthetic browser acceptance. No installed worker, credentials or real source data. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve, extname, sep } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { trendsFixture } from "../../../tests/finance-trends-fixture.mjs";
import { FinanceLibrary } from "../../worker/dist/finance-library.js";

const root = resolve("apps/web/dist");
const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const file = resolve(root, "." + pathname.replace(/^\/familyhub/, ""));
    if (file !== root && !file.startsWith(root + sep)) return res.writeHead(403).end();
    try {
        const bytes = await readFile(file === root || pathname.endsWith("/") ? join(root, "index.html") : file);
        res.setHeader("Content-Type", ({ ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" })[extname(file)] ?? "text/html");
        res.end(bytes);
    } catch { res.writeHead(404).end(); }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = process.env.FAMILYHUB_TEST_BASE || `http://127.0.0.1:${server.address().port}/familyhub/`;
const temp = await mkdtemp(join(tmpdir(), "familyhub-trends-"));
const screenshots = resolve("output/playwright/trends");
await mkdir(screenshots, { recursive: true });
let browser;
try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    for (const width of [320, 390, 768, 1440]) {
        const finance = new FinanceLibrary(join(temp, String(width))), fixture = trendsFixture();
        let initial = (await finance.import({ bundle: fixture.bundle, apply: true, expectedRevision: "empty" })).state;
        for (const [id, decision] of Object.entries(fixture.decisions)) initial = await finance.decide({ id, expectedRevision: initial.revision, decision });
        const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block", reducedMotion: "reduce" });
        const page = await context.newPage(), errors = [];
        let posts = 0, mode = "normal";
        await page.clock.setFixedTime(new Date("2026-10-10T12:00:00Z"));
        page.on("pageerror", e => errors.push(e.message));
        page.setDefaultTimeout(12000);
        await page.addInitScript(() => localStorage.setItem("familyhub.worker.v1", JSON.stringify({ Endpoint: "https://synthetic-worker.invalid", ApiKey: "synthetic-key" })));
        await page.route("https://synthetic-worker.invalid/**", async route => {
            const req = route.request(), path = new URL(req.url()).pathname;
            const reply = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
            if (req.method() === "OPTIONS") return reply({});
            if (path === "/finances") {
                if (mode === "error") return reply({ error: "Synthetic unavailable" }, 503);
                const state = structuredClone(await finance.read());
                if (mode === "empty") state.data = null;
                if (mode === "missing") state.data.accounts.push({ ...state.data.accounts[0], id: "missing", name: "Missing synthetic card", type: "credit-card" });
                return reply(state);
            }
            if (path === "/finances/decision") { posts++; return reply(await finance.decide(req.postDataJSON())); }
            if (req.method() !== "GET") throw new Error("Unexpected synthetic mutation: " + path);
            if (path === "/health") return reply({ status: "ok", codex: "available", version: "2.23.3" });
            if (path === "/invoices") return reply({ items: [], reconciliations: [], unmatchedReimbursements: [], setupRequired: true, accounts: [] });
            return reply({ state: "idle", accounts: [], jobs: [], schedule: null, daily: null });
        });
        await page.goto(base + "?view=finances");
        await page.getByRole("heading", { name: "Dépenses par catégorie", exact: true }).waitFor();
        assert.equal(await page.locator(".finance-tabs button").count(), 3);
        await page.getByRole("button", { name: "Tendances", exact: true }).click();
        const view = page.locator(".finance-trends"), month = view.getByLabel("Mois analysé", { exact: true });
        await view.waitFor();
        assert.equal(await month.inputValue(), "2026-09");
        assert.equal(await view.locator(".trend-months button").count(), 12);
        assert.match(await view.locator(".trend-headline").innerText(), /790,00.*760,00/s);
        await month.fill("2026-10");
        assert.match(await view.locator(".trend-headline").innerText(), /780,00.*715,00/s);
        assert.match(await view.innerText(), /9 premiers jours/);
        await view.getByText("Valeurs jour par jour", { exact: true }).click();
        assert.equal(await view.locator(".trend-table tbody tr").count(), 9);
        assert.match(await view.locator(".trend-table tbody tr").last().innerText(), /780,00.*715,00/);
        await view.getByText("Méthode et couverture des sources", { exact: true }).click();
        assert.match(await view.locator(".trend-method").innerText(), /2026-04-01 au 2026-04-09/);
        assert.match(await view.locator(".trend-method").innerText(), /Older card history unavailable/);
        await view.getByText("Méthode et couverture des sources", { exact: true }).click();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.equal(await view.evaluate(el => el.scrollWidth > el.clientWidth), false);
        await view.screenshot({ path: join(screenshots, `overview-${width}.png`) });
        const food = view.locator(".trend-category").filter({ hasText: "Courses alimentaires" });
        await food.focus(); await page.keyboard.press("Enter");
        const sheet = page.getByRole("dialog", { name: /^Paiements.*Courses alimentaires$/ });
        await sheet.waitFor();
        assert.match(await sheet.innerText(), /2026-10-01.*2026-10-09/s);
        assert.equal(await sheet.locator('[aria-label="Opérations de dépenses"] button').count(), 2);
        assert.doesNotMatch(await sheet.innerText(), /oct-card-payment|oct-transfer/);
        await sheet.locator('[data-payment-id="oct-food"]').click();
        const editor = page.getByRole("dialog", { name: /Vérifier l.opération/ });
        await editor.getByText("Sources et traçabilité", { exact: true }).click();
        assert.match(await editor.innerText(), /original.csv.*SHA-256/s);
        await editor.getByRole("button", { name: "Retour aux paiements de la catégorie", exact: true }).click();
        await page.waitForFunction(() => document.activeElement?.getAttribute("data-payment-id") === "oct-food");
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => document.activeElement?.classList.contains("trend-category"));
        assert.equal(posts, 0);
        await food.click(); await sheet.locator('[data-payment-id="oct-food"]').click();
        await editor.getByLabel("Catégorie", { exact: true }).selectOption("restaurants");
        await editor.getByRole("button", { name: "Enregistrer la décision", exact: true }).click();
        await editor.waitFor({ state: "hidden" });
        await page.keyboard.press("Escape");
        assert.equal(posts, 1);
        assert.match(await view.locator(".trend-headline").innerText(), /780,00.*715,00/s);
        assert.match(await view.locator(".trend-category").filter({ hasText: "Restaurants et livraison" }).innerText(), /200,00/);
        assert.match(await food.innerText(), /-20,00/);
        await view.getByLabel("Afficher une catégorie", { exact: true }).selectOption("pets");
        assert.equal(await view.locator(".trend-category").count(), 0);
        await view.getByLabel("Afficher une catégorie", { exact: true }).selectOption("");
        await page.getByLabel("Compte", { exact: true }).selectOption("bank");
        assert.match(await view.locator(".trend-headline").innerText(), /600,00.*600,00/s);
        assert.match(await view.innerText(), /2 élément\(s\).*import complet/);
        assert.match(await view.innerText(), /ne sont pas disponibles pour cette sélection/);
        await page.getByLabel("Compte", { exact: true }).selectOption("");
        await month.fill("2026-04"); assert.match(await view.innerText(), /Historique insuffisant/);
        await month.fill("2026-11"); assert.match(await view.locator(".trend-headline").innerText(), /Non disponible.*Non disponible/s);
        await view.getByLabel("Année analysée", { exact: true }).selectOption("2026");
        await month.fill("2026-10");
        await page.getByRole("button", { name: "Dépenses", exact: true }).click();
        assert.match(await page.locator(".finance-totals").first().innerText(), /790,00/);
        assert.equal(posts, 1);
        await page.reload();
        await page.getByRole("button", { name: "Tendances", exact: true }).click();
        await month.fill("2026-10");
        assert.match(await view.locator(".trend-category").filter({ hasText: "Restaurants et livraison" }).innerText(), /200,00/);
        const saved = await new FinanceLibrary(join(temp, String(width))).read();
        assert.deepEqual(saved.data, initial.data);
        assert.equal(saved.decisions["oct-food"].category, "restaurants");
        assert.equal(saved.decisionHistory.length, initial.decisionHistory.length + 1);
        mode = "missing"; await page.getByRole("button", { name: "Actualiser", exact: true }).click();
        await view.getByText("Comparaison indisponible", { exact: true }).waitFor();
        assert.match(await view.locator(".trend-headline").innerText(), /780,00.*Non disponible/s);
        await page.getByLabel("Compte", { exact: true }).selectOption("missing");
        assert.match(await view.locator(".trend-headline").innerText(), /Non disponible.*Non disponible/s);
        await view.screenshot({ path: join(screenshots, `missing-${width}.png`) });
        mode = "error"; await page.getByRole("button", { name: "Actualiser", exact: true }).click();
        await page.getByText("Synthetic unavailable", { exact: true }).waitFor();
        mode = "empty"; await page.getByRole("button", { name: "Actualiser", exact: true }).click();
        await page.getByRole("heading", { name: "Aucun historique importé", exact: true }).waitFor();
        assert.equal(await view.count(), 0); assert.equal(posts, 1);
        assert.deepEqual(errors, []);
        await context.close();
        console.log(`PASS personal comparisons, missing history, drill-down persistence and keyboard/mobile layout at ${width}px`);
    }
} finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
}
