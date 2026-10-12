/** Synthetic inline selections, partial commits, replay and preservation; no installed worker. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { resolve, join, extname, sep } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { FinanceLibrary, FinanceConflict } from "../../worker/dist/finance-library.js";
import { categoryFixture, categoryDecisions } from "../../../tests/finance-category-fixture.mjs";
import { openFinanceFilters } from "./finance-filter-helpers.mjs";
const root = resolve("apps/web/dist"), temp = await mkdtemp(join(tmpdir(), "fh-inline-")), output = resolve("output/playwright/finance-inline");
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname, file = resolve(root, "." + pathname.replace(/^\/familyhub/, ""));
    if (file !== root && !file.startsWith(root + sep)) return res.writeHead(403).end();
    try { res.setHeader("Content-Type", ({ ".js": "text/javascript", ".css": "text/css" })[extname(file)] ?? "text/html"); res.end(await readFile(file === root || pathname.endsWith("/") ? join(root, "index.html") : file)); } catch { res.writeHead(404).end(); }
});
server.listen(0, "127.0.0.1"); await once(server, "listening");
const base = process.env.FAMILYHUB_TEST_BASE || `http://127.0.0.1:${server.address().port}/familyhub/`;
let browser;
try {
    browser = await chromium.launch({ headless: true });
    for (const width of [320, 390, 768, 1440]) {
        const finance = new FinanceLibrary(join(temp, String(width))), bundle = categoryFixture();
        bundle.bankActivities.push({ ...bundle.bankActivities[0], id: "later", sourceRowId: "later", matchingFingerprint: "later", descriptionOriginal: "LATER UNIQUE SYNTHETIC", transactionDate: "2026-09-12", signedOutflowCents: 100, debitCents: 100, creditCents: null });
        let initial = (await finance.import({ bundle, apply: true, expectedRevision: "empty" })).state;
        for (const row of bundle.bankActivities) {
            const old = categoryDecisions[row.id];
            const decision = old && !["expense", "refund"].includes(old.nature) ? old : { nature: row.signedOutflowCents < 0 ? "refund" : "expense", category: "groceries", note: "Retained synthetic note " + row.id, updatedAt: "" };
            initial = await finance.decide({ id: row.id, decision, expectedRevision: initial.revision });
        }
        const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block", reducedMotion: "reduce", hasTouch: width < 500 });
        const page = await context.newPage(), errors = [], requests = [];
        let gets = 0, mode = "normal", release, second = 0;
        page.setDefaultTimeout(15000); page.on("pageerror", e => errors.push(e.message));
        await page.clock.setFixedTime(new Date("2026-10-12T12:00:00Z"));
        await page.addInitScript(() => localStorage.setItem("familyhub.worker.v1", JSON.stringify({ Endpoint: "https://synthetic-worker.invalid", ApiKey: "synthetic-key" })));
        await context.route("https://synthetic-worker.invalid/**", async route => {
            const req = route.request(), path = new URL(req.url()).pathname;
            const reply = (json, status = 200) => route.fulfill({ status, json });
            if (req.method() === "OPTIONS") return reply({});
            if (path === "/finances") { gets++; return reply(await finance.read()); }
            if (path === "/finances/changes") {
                const input = req.postDataJSON(); requests.push(input);
                if (mode === "hold") { mode = "normal"; await new Promise(r => { release = r; }); }
                if (mode === "second" && ++second === 2) { mode = "normal"; return route.abort("connectionfailed"); }
                if (mode === "conflict") { mode = "normal"; await finance.decide({ id: "number", expectedRevision: input.expectedRevision, decision: { nature: "expense", category: "groceries", note: "New independent synthetic note" } }); }
                try { const result = await finance.change(input);
                    if (mode === "lost-later") { mode = "normal"; await finance.decide({ id: input.id, expectedRevision: result.revision, decision: { nature: "expense", category: "travel", note: "Newer independent synthetic decision" } }); return route.abort("connectionfailed"); }
 if (mode === "lost-second" && ++second === 2) { mode = "normal"; return route.abort("connectionfailed"); } if (mode === "lost") { mode = "normal"; return route.abort("connectionfailed"); } return reply(result); }
                catch (e) { return reply({ error: e.message }, e instanceof FinanceConflict ? 409 : 400); }
            }
            if (req.method() !== "GET") throw Error("Unexpected synthetic write " + path);
            if (path === "/health") return reply({ status: "ok", version: "2.25.2", codex: "available" });
            return reply({ items: [], accounts: [], jobs: [], state: "idle", schedule: null, daily: null });
        });
        await page.goto(base + "?view=finances"); await page.getByRole("heading", { name: "Dépenses par catégorie", exact: true }).waitFor();
        const filters = await openFinanceFilters(page); await filters.getByLabel("Vue", { exact: true }).selectOption("custom"); await filters.getByLabel("Du", { exact: true }).fill("2026-04-01"); await filters.getByLabel("Au", { exact: true }).fill("2026-10-09"); await filters.getByRole("button", { name: "Voir les résultats" }).click();
        await page.locator('[data-finance-bar="groceries"]').click();
        const sheet = page.getByRole("dialog", { name: "Paiements · Courses alimentaires", exact: true }), toolbar = sheet.locator(".finance-inline-toolbar");
        const row = id => sheet.locator(`[data-inline-payment="${id}"]`), select = id => sheet.locator(`[data-payment-select="${id}"]`);
        await sheet.waitFor(); assert.equal(await sheet.locator(".finance-category-payments > :first-child input[type=search]").count(), 1);
        assert.equal(await sheet.getByLabel("Note de décision").count(), 0);
        const order = await sheet.locator('.finance-register[aria-label="Opérations de dépenses"] [data-inline-payment]').evaluateAll(rows => rows.map(r => r.dataset.inlinePayment));
        assert.deepEqual(order, ["c", "b", "accent", "punctuation", "a", "number", "confirmed", "later", "refund"]);
        const alphabetical = await row("a").getByLabel("Catégorie", { exact: true }).locator("option").allTextContents();
        assert.deepEqual(alphabetical, [...alphabetical].sort((a, b) => a.localeCompare(b, "fr-CA", { sensitivity: "base" })));
        assert.equal(await row("refund").getByLabel("Nature", { exact: true }).locator('option[value="expense"]').count(), 0);
        assert.equal(await row("a").getByLabel("Nature", { exact: true }).locator('option[value="refund"]').count(), 0);
        // A two-row lot leaves the category; focus advances to the next two original visible rows.
        await select("c").check(); await select("b").check(); await toolbar.getByLabel("Catégorie du lot").selectOption("restaurants");
        assert.equal(await sheet.evaluate(el => el.scrollWidth > el.clientWidth), false, "Selected edit state must fit the sheet");
        assert.equal(await toolbar.evaluate(el => el.scrollWidth > el.clientWidth), false, "Lot controls must not overflow");
        await sheet.locator(".sheet-content").evaluate(el => { el.scrollTop = 0; });
        await sheet.screenshot({ path: join(output, `inline-edit-${width}.png`) });
        mode = "hold"; const beforeGets = gets; await sheet.getByRole("button", { name: "Enregistrer et suivante", exact: true }).click();
        await sheet.getByRole("status").filter({ hasText: "Enregistrement" }).waitFor(); assert.equal(await row("a").getByLabel("Nature", { exact: true }).isDisabled(), true);
        release(); await row("c").waitFor({ state: "detached" }); await row("b").waitFor({ state: "detached" });
        await select("accent").waitFor(); await page.waitForFunction(() => document.activeElement?.getAttribute("data-payment-select") === "accent");
        assert.equal(await select("accent").isChecked(), true); assert.equal(await select("punctuation").isChecked(), true);
        assert.equal(gets, beforeGets); assert.equal((await finance.read()).decisions.c.note, initial.decisions.c.note);
        await sheet.getByRole("button", { name: "Annuler le brouillon", exact: true }).click();
        // Lost acknowledgement retries the exact request ID without a duplicate audit event.
        await row("a").getByLabel("Catégorie", { exact: true }).selectOption("health"); mode = "lost";
        await sheet.getByRole("button", { name: "Enregistrer", exact: true }).click(); await sheet.getByRole("alert").waitFor(); const lost = requests.at(-1).requestId;
        await sheet.getByRole("button", { name: "Enregistrer", exact: true }).click(); await row("a").waitFor({ state: "detached" });
        assert.equal(requests.at(-1).requestId, lost); assert.equal((await finance.read()).operations.filter(op => op.id === lost).length, 1);
        // An uncertain older acknowledgement cannot overwrite a newer independent decision.
        await row("later").getByLabel("Catégorie", { exact: true }).selectOption("health"); mode = "lost-later";
        await sheet.getByRole("button", { name: "Enregistrer", exact: true }).click(); await sheet.getByRole("alert").waitFor();
        const oldRequest = requests.at(-1).requestId;
        await sheet.getByRole("button", { name: "Enregistrer", exact: true }).click();
        await sheet.getByRole("button", { name: "Actualiser les décisions", exact: true }).waitFor();
        assert.equal(requests.at(-1).requestId, oldRequest); assert.equal((await finance.read()).decisions.later.category, "travel");
        await sheet.getByRole("button", { name: "Actualiser les décisions", exact: true }).click(); await sheet.getByRole("button", { name: "Annuler le brouillon", exact: true }).click();
        assert.equal((await finance.read()).decisions.later.note, "Newer independent synthetic decision");
        // A failure after one committed row preserves only the remaining draft/selection.
        await select("accent").check(); await select("punctuation").check(); await toolbar.getByLabel("Catégorie du lot").selectOption("pets"); mode = "second"; second = 0;
        await sheet.getByRole("button", { name: "Enregistrer", exact: true }).click(); await sheet.getByRole("alert").waitFor();
        assert.equal(await row("accent").count(), 0); assert.equal(await select("punctuation").isChecked(), true);
        await sheet.getByRole("button", { name: "Enregistrer", exact: true }).click(); await row("punctuation").waitFor({ state: "detached" });
        // A genuine revision conflict requires explicit refresh/review, never silent overwrite.
        await row("number").getByLabel("Catégorie", { exact: true }).selectOption("transport"); mode = "conflict";
        await sheet.getByRole("button", { name: "Enregistrer", exact: true }).click(); await sheet.getByRole("button", { name: "Actualiser les décisions", exact: true }).waitFor();
        assert.equal(await sheet.getByRole("button", { name: "Enregistrer", exact: true }).isDisabled(), true);
        await sheet.getByRole("button", { name: "Actualiser les décisions", exact: true }).click(); await sheet.getByRole("button", { name: "Enregistrer", exact: true }).click(); await row("number").waitFor({ state: "detached" });
        assert.equal((await finance.read()).decisions.number.note, "New independent synthetic note");
        // Same-name category scope retains excluded natures, other-account facts and notes.
        await row("confirmed").getByLabel("Catégorie", { exact: true }).selectOption("jasmine-school");
        await toolbar.getByRole("checkbox", { name: /Appliquer la catégorie à tous du même nom/ }).check(); await sheet.getByRole("button", { name: "Enregistrer et suivante", exact: true }).click();
        await sheet.getByRole("status").filter({ hasText: "terminé" }).waitFor();
        let saved = await finance.read(); const group = saved.operations.at(-1); assert.equal(group.kind, "same-name");
        for (const id of ["transfer", "repayment", "investment", "review", "duplicate"]) assert.equal(saved.decisions[id].nature, initial.decisions[id].nature);
        for (const id of ["transfer", "repayment", "investment", "review", "duplicate", "confirmed", "refund", "usd"]) assert.equal(saved.decisions[id].note, initial.decisions[id].note);
        assert.deepEqual(saved.data, initial.data); assert.deepEqual(saved.decisionHistory.slice(0, initial.decisionHistory.length), initial.decisionHistory);
        await sheet.getByText("Historique et annulation", { exact: true }).click(); await sheet.locator(".finance-inline-undo-row").first().getByRole("button").click();
        await row("confirmed").waitFor(); saved = await finance.read(); assert.equal(saved.decisions.confirmed.category, "groceries"); assert.equal(saved.decisions.transfer.category, initial.decisions.transfer.category);
        // Conflicting same-name drafts are rejected before any request.
        await row("confirmed").getByLabel("Catégorie", { exact: true }).selectOption("health");
        await row("refund").getByLabel("Catégorie", { exact: true }).selectOption("transport");
        await toolbar.getByRole("checkbox", { name: /Appliquer la catégorie à tous du même nom/ }).check();
        const beforeConflict = requests.length;
        await sheet.getByRole("button", { name: "Enregistrer", exact: true }).click();
        await sheet.getByRole("alert").filter({ hasText: "catégories différentes" }).waitFor(); assert.equal(requests.length, beforeConflict);
        await sheet.getByRole("button", { name: "Annuler le brouillon", exact: true }).click();
        // Same-name expansion must not swallow a second selected row's explicit nature.
        await select("confirmed").check(); await select("refund").check();
        await toolbar.getByLabel("Nature du lot").selectOption("transfer"); await toolbar.getByLabel("Catégorie du lot").selectOption("other");
        await toolbar.getByRole("checkbox", { name: /Appliquer la catégorie à tous du même nom/ }).check();
        mode = "lost-second"; second = 0;
        await sheet.getByRole("button", { name: "Enregistrer", exact: true }).click(); await sheet.getByRole("alert").waitFor();
        const lostSecond = requests.at(-1).requestId; assert.equal(requests.at(-1).allSameName, false);
        await sheet.getByRole("button", { name: "Enregistrer", exact: true }).click();
        assert.equal(requests.at(-1).requestId, lostSecond); assert.equal(requests.at(-1).allSameName, false);
        await sheet.getByRole("status").filter({ hasText: "terminé" }).waitFor();
        saved = await finance.read(); assert.equal(saved.decisions.confirmed.nature, "transfer"); assert.equal(saved.decisions.refund.nature, "transfer");
        assert.equal(saved.decisions.refund.note, initial.decisions.refund.note); assert.equal(requests.at(-1).allSameName, false);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.equal(await sheet.evaluate(el => el.scrollWidth > el.clientWidth), false);
        await sheet.screenshot({ path: join(output, `inline-${width}.png`) }); await sheet.getByRole("button", { name: "Fermer la catégorie", exact: true }).click();
        await page.waitForFunction(() => document.activeElement?.hasAttribute("data-finance-bar") && document.activeElement.getClientRects().length > 0);
        assert.deepEqual(errors, []); await context.close(); console.log(`PASS inline batches, partial progress, replay, conflicts, next focus, notes/audit, same-name exclusions and undo at ${width}px`);
    }
} finally { if (browser) await browser.close(); await new Promise(r => server.close(r)); await rm(temp, { recursive: true, force: true }); }
