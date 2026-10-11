/** Synthetic bulk/undo acceptance. Never connects to the installed worker or real financial records. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve, extname, sep } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { FinanceLibrary, FinanceConflict } from "../../worker/dist/finance-library.js";
import { categoryFixture, categoryDecisions } from "../../../tests/finance-category-fixture.mjs";
import { openFinanceFilters } from "./finance-filter-helpers.mjs";
const root = resolve("apps/web/dist"), temp = await mkdtemp(join(tmpdir(), "fh-category-browser-"));
const output = resolve("output/playwright/finance-changes"); await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname, file = resolve(root, "." + pathname.replace(/^\/familyhub/, ""));
    if (file !== root && !file.startsWith(root + sep)) return res.writeHead(403).end();
    try { res.setHeader("Content-Type", ({ ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" })[extname(file)] ?? "text/html"); res.end(await readFile(file === root || pathname.endsWith("/") ? join(root, "index.html") : file)); }
    catch { res.writeHead(404).end(); }
});
server.listen(0, "127.0.0.1"); await once(server, "listening");
const base = process.env.FAMILYHUB_TEST_BASE || `http://127.0.0.1:${server.address().port}/familyhub/`;
let browser;
try {
    browser = await chromium.launch({ headless: true });
    for (const width of [320, 390, 768, 1440]) {
        const finance = new FinanceLibrary(join(temp, String(width)));
        let initial = (await finance.import({ bundle: categoryFixture(), apply: true, expectedRevision: "empty" })).state;
        for (const [id, decision] of Object.entries(categoryDecisions)) initial = await finance.decide({ id, decision, expectedRevision: initial.revision });
        const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block", reducedMotion: "reduce", hasTouch: width < 500 });
        const page = await context.newPage(), errors = [], requests = [];
        let mode = "normal", release, gets = 0, failGet = false;
        page.on("pageerror", error => errors.push(error.message)); page.setDefaultTimeout(10000);
        await page.clock.setFixedTime(new Date("2026-10-11T12:00:00Z"));
        await page.addInitScript(() => localStorage.setItem("familyhub.worker.v1", JSON.stringify({ Endpoint: "https://synthetic-worker.invalid", ApiKey: "synthetic-key" })));
        await context.route("https://synthetic-worker.invalid/**", async route => {
            const request = route.request(), path = new URL(request.url()).pathname;
            const reply = (body, status = 200) => route.fulfill({ status, json: body });
            if (request.method() === "OPTIONS") return reply({});
            if (path === "/finances") { gets++; if (failGet) { failGet = false; return reply({ error: "Synthetic read unavailable" }, 503); } return reply(await finance.read()); }
            if (path === "/finances/changes") {
                const action = request.postDataJSON(); requests.push(action);
                const currentMode = mode; mode = "normal";
                if (currentMode === "hold") await new Promise(resolve => { release = resolve; });
                if (currentMode === "offline") return route.abort("connectionfailed");
                if (currentMode === "old-worker") return reply({ error: "Not found" }, 404);
                try {
                    const result = await finance.change(action);
                    if (currentMode === "lost-later") {
                        await finance.decide({ id: "number", expectedRevision: result.revision, decision: { nature: "expense", category: "travel", note: "Newer independent synthetic choice" } });
                    }
                    if (currentMode.startsWith("lost")) return route.abort("connectionfailed");
                    return reply(result);
                } catch (e) { return reply({ error: e.message }, e instanceof FinanceConflict ? 409 : 400); }
            }
            if (request.method() !== "GET") throw new Error("Unexpected synthetic write " + path);
            if (path === "/health") return reply({ status: "ok", version: "2.25.0", codex: "available" });
            if (path === "/invoices") return reply({ items: [], reconciliations: [], unmatchedReimbursements: [], setupRequired: true, accounts: [] });
            return reply({ state: "idle", accounts: [], jobs: [], schedule: null, daily: null });
        });
        await page.goto(base + "?view=finances");
        await page.getByRole("heading", { name: "Dépenses par catégorie", exact: true }).waitFor();
        const total = page.locator(".compact-finance-totals"), box = await total.boundingBox();
        assert.ok(box.height < 135, `Total too tall: ${box.height}px at ${width}`);
        assert.equal(await total.locator(":scope > div").count(), 1);
        assert.doesNotMatch(await total.innerText(), /suggestions non confirmées|opérations à revoir/);
        await total.getByRole("button", { name: /Calcul des dépenses/ }).click();
        await page.getByRole("dialog", { name: "Calcul des dépenses", exact: true }).getByText(/suggestions non confirmées/).waitFor();
        await page.keyboard.press("Escape");
        await page.screenshot({ path: join(output, "total-" + width + ".png") });
        const filters = await openFinanceFilters(page);
        await filters.getByLabel("Vue", { exact: true }).selectOption("custom");
        await filters.getByLabel("Du", { exact: true }).fill("2026-09-01");
        await filters.getByLabel("Au", { exact: true }).fill("2026-09-30");
        await filters.getByLabel("Compte", { exact: true }).selectOption("card");
        await filters.getByRole("button", { name: "Voir les résultats" }).click();
        const register = page.getByRole("heading", { name: "Opérations et catégories", exact: true }).locator("..").locator(".finance-register");
        const editor = page.getByRole("dialog", { name: "Vérifier l’opération", exact: true });
        const open = async () => { await register.getByRole("button").filter({ hasText: /MAPLE MARKET 01/ }).first().click(); await editor.waitFor(); };
        await open();
        const checkbox = editor.getByRole("checkbox", { name: /Appliquer la catégorie/ });
        assert.equal(await checkbox.isChecked(), false);
        await editor.getByLabel("Catégorie", { exact: true }).selectOption("groceries");
        await editor.getByLabel("Note de décision").fill("Only this synthetic row note");
        await checkbox.check();
        assert.match(await editor.innerText(), /10 opérations à enregistrer sur 11.*tout l’historique/s);
        await editor.getByText("Sources et traçabilité").click(); assert.match(await editor.innerText(), /original.csv.*SHA-256/s);
        assert.equal(await editor.evaluate(el => el.scrollWidth > el.clientWidth), false);
        await editor.screenshot({ path: join(output, "bulk-" + width + ".png") });
        mode = "hold"; const count = requests.length, beforeGets = gets;
        await editor.getByRole("button", { name: "Enregistrer 10 opérations", exact: true }).evaluate(el => { el.click(); el.click(); });
        await editor.getByRole("status").filter({ hasText: "Enregistrement en cours" }).waitFor();
        assert.equal(await editor.getByLabel("Catégorie", { exact: true }).isDisabled(), true);
        assert.equal(await editor.getByLabel("Nature", { exact: true }).isDisabled(), true);
        assert.equal(await editor.getByLabel("Note de décision").isDisabled(), true);
        assert.equal(await checkbox.isDisabled(), true); assert.equal(requests.length - count, 1);
        release(); await editor.waitFor({ state: "hidden" });
        assert.equal(gets, beforeGets, "A normal save must not re-fetch the whole ledger");
        const saved = await finance.read(); assert.equal(saved.operations.length, 1); assert.equal(saved.operations[0].count, 10);
        assert.equal(saved.decisions.b.category, "groceries"); assert.equal(saved.decisions.usd.category, "groceries");
        for (const id of ["refund", "transfer", "repayment", "investment", "review", "duplicate", "c"]) {
            assert.equal(saved.decisions[id].nature, initial.decisions[id].nature); assert.equal(saved.decisions[id].note, initial.decisions[id].note);
        }
        await page.reload(); await page.getByRole("heading", { name: "Dépenses par catégorie", exact: true }).waitFor();
        await page.getByText("Modifications récentes", { exact: true }).click();
        await page.getByRole("button", { name: /^Annuler la modification de 10 opérations/ }).click();
        await page.getByRole("status").filter({ hasText: "10 décisions précédentes restaurées" }).waitFor();
        assert.deepEqual((await finance.read()).decisions, initial.decisions);
        await open(); assert.equal(await checkbox.isChecked(), false);
        await editor.getByLabel("Catégorie", { exact: true }).selectOption("restaurants");
        await editor.getByLabel("Note de décision").fill("Synthetic lost response draft");
        mode = "lost";
        await editor.getByRole("button", { name: "Enregistrer la décision", exact: true }).click();
        await editor.getByRole("alert").filter({ hasText: "Enregistrement non confirmé" }).waitFor();
        assert.equal(await editor.getByLabel("Note de décision").inputValue(), "Synthetic lost response draft");
        const retryId = requests.at(-1).requestId, opCount = (await finance.read()).operations.length;
        await editor.getByRole("button", { name: "Enregistrer la décision", exact: true }).click();
        await editor.waitFor({ state: "hidden" });
        assert.equal(requests.at(-1).requestId, retryId); assert.equal((await finance.read()).operations.length, opCount);
        // An external concurrent decision is retained; the displayed draft cannot overwrite it.
        await open(); await editor.getByLabel("Catégorie", { exact: true }).selectOption("travel");
        const concurrent = await finance.read(); await finance.decide({ id: "a", expectedRevision: concurrent.revision, decision: { nature: "expense", category: "pets", note: "Newer synthetic choice" } });
        await editor.getByRole("button", { name: "Enregistrer la décision", exact: true }).click();
        await editor.getByRole("alert").filter({ hasText: /autre modification/ }).waitFor();
        assert.equal(await editor.getByLabel("Catégorie", { exact: true }).inputValue(), "travel");
        assert.equal(await editor.getByRole("button", { name: "Enregistrer la décision", exact: true }).isDisabled(), true);
        await editor.getByRole("button", { name: "Recharger la décision du PC et remplacer ce brouillon" }).click();
        await page.getByText("Données du PC actualisées.", { exact: true }).waitFor({ state: "attached" });
        assert.equal(await editor.getByLabel("Catégorie", { exact: true }).inputValue(), "pets");
        assert.equal(await editor.getByLabel("Note de décision").inputValue(), "Newer synthetic choice");
        await page.keyboard.press("Escape");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual((await finance.read()).data, initial.data); assert.deepEqual(errors, []);
        if (width === 1440) {
            await open(); await editor.getByLabel("Catégorie", { exact: true }).selectOption("restaurants");
            mode = "lost-later"; await editor.getByRole("button", { name: "Enregistrer la décision", exact: true }).click();
            await editor.getByRole("alert").filter({ hasText: "Enregistrement non confirmé" }).waitFor();
            failGet = true; await editor.getByRole("button", { name: "Enregistrer la décision", exact: true }).click();
            await editor.getByRole("alert").filter({ hasText: "Synthetic read unavailable" }).waitFor();
            await editor.getByRole("status").filter({ hasText: /Décision enregistrée; l’actualisation/ }).waitFor();
            await editor.getByRole("button", { name: "Recharger la décision du PC et remplacer ce brouillon" }).click();
            await page.getByText("Données du PC actualisées.", { exact: true }).waitFor({ state: "attached" });
            assert.equal(await editor.getByLabel("Catégorie", { exact: true }).inputValue(), "restaurants");
            mode = "old-worker"; await editor.getByRole("button", { name: "Enregistrer la décision", exact: true }).click();
            await editor.getByRole("alert").filter({ hasText: /2.25.0/ }).waitFor();
            await page.keyboard.press("Escape");
        }
        // The added category uses the same explicit single/bulk and persisted summary paths.
        await open();
        const category = editor.getByLabel("Catégorie", { exact: true });
        assert.equal(await category.getByRole("option", { name: "Jasmine school", exact: true }).count(), 1);
        await category.selectOption("jasmine-school");
        assert.equal(await checkbox.isChecked(), false);
        await editor.getByRole("button", { name: "Enregistrer la décision", exact: true }).click();
        await editor.waitFor({ state: "hidden" });
        assert.equal((await finance.read()).operations.at(-1).count, 1);
        await open(); await checkbox.check();
        await editor.getByRole("button", { name: "Enregistrer 11 opérations", exact: true }).click();
        await editor.waitFor({ state: "hidden" });
        const school = await finance.read();
        assert.equal(school.decisions.confirmed.category, "jasmine-school");
        assert.equal(school.decisions.refund.nature, "refund");
        assert.equal(school.decisions.repayment.nature, "repayment");
        assert.deepEqual(school.data, initial.data);
        await page.reload(); await page.getByRole("heading", { name: "Dépenses par catégorie", exact: true }).waitFor();
        await page.getByRole("button", { name: /^Jasmine school/ }).waitFor();
        await open(); assert.equal(await category.inputValue(), "jasmine-school");
        assert.equal(await editor.evaluate(el => el.scrollWidth > el.clientWidth), false);
        await page.keyboard.press("Escape");
        assert.deepEqual(errors, []);
        console.log(`Finance changes ${width}px: bulk/undo/retry/conflict, compact total and school single/bulk/reload/summary passed`);
        await context.close();
    }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); await rm(temp, { recursive: true, force: true }); }
