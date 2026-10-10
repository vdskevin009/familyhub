/** Synthetic finance acceptance; never connects to the installed worker or a bank. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve, extname, sep } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { cardPaymentFixture, cardPaymentDecisions } from "../../../tests/card-payment-fixture.mjs";
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
const temp = await mkdtemp(join(tmpdir(), "familyhub-card-payments-"));
const screenshots = resolve("output/playwright/card-payments");
await mkdir(screenshots, { recursive: true });
let browser;
try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    for (const width of [320, 390, 768, 1440]) {
        const finance = new FinanceLibrary(join(temp, String(width)));
        const imported = (await finance.import({ bundle: cardPaymentFixture(), apply: true, expectedRevision: "empty" })).state;
        const initial = await finance.decide({ id: "fixture-refund", expectedRevision: imported.revision, decision: cardPaymentDecisions["fixture-refund"] });
        const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
        const page = await context.newPage(), errors = [];
        let posts = 0;
        page.on("pageerror", e => errors.push(e.message));
        page.setDefaultTimeout(10000);
        await page.addInitScript(() => localStorage.setItem("familyhub.worker.v1", JSON.stringify({ Endpoint: "https://synthetic-worker.invalid", ApiKey: "synthetic-key" })));
        await page.route("https://synthetic-worker.invalid/**", async route => {
            const req = route.request(), path = new URL(req.url()).pathname;
            const reply = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
            if (req.method() === "OPTIONS") return reply({});
            if (path === "/finances") return reply(await finance.read());
            if (path === "/finances/decision") { posts++; return reply(await finance.decide(req.postDataJSON())); }
            if (req.method() !== "GET") throw new Error("Unexpected synthetic mutation: " + path);
            if (path === "/health") return reply({ status: "ok", codex: "available", version: "2.23.3" });
            if (path === "/invoices") return reply({ items: [], reconciliations: [], unmatchedReimbursements: [], setupRequired: true, accounts: [] });
            return reply({ state: "idle", accounts: [], jobs: [], schedule: null, daily: null });
        });
        await page.goto(base + "?view=finances");
        await page.getByRole("heading", { name: "Dépenses par catégorie", exact: true }).waitFor();
        const scope = page.getByLabel("Opérations affichées", { exact: true });
        const register = page.getByRole("heading", { name: "Opérations et catégories", exact: true }).locator("..").locator(".finance-register");
        assert.equal(await scope.inputValue(), "expenses");
        assert.equal(await register.getByRole("button").count(), 2);
        assert.doesNotMatch(await register.innerText(), /PAYMENT-THANKYOU|TFR-TO/);
        assert.match(await page.locator(".finance-totals").first().innerText(), /30,00/);
        assert.equal(await page.locator(".finance-tabs button").count(), 3);
        const bar = page.locator(".finance-expense-charts > section").first().getByRole("button", { name: /^À catégoriser/ });
        await bar.focus(); await page.keyboard.press("Enter");
        const sheet = page.getByRole("dialog", { name: /^Paiements.*À catégoriser$/ });
        await sheet.waitFor();
        const included = sheet.locator('[aria-label="Opérations de dépenses"]');
        const excluded = sheet.locator('[aria-label="Opérations hors dépenses"]');
        assert.equal(await included.getByRole("button").count(), 2);
        assert.doesNotMatch(await included.innerText(), /PAYMENT-THANKYOU|TFR-TO/);
        assert.match(await sheet.innerText(), /30,00.*2 opération\(s\) dans les dépenses/s);
        assert.equal(await excluded.isVisible(), false);
        const disclosure = sheet.locator(".finance-excluded-payments > summary");
        assert.match(await disclosure.innerText(), /Hors dépenses · 2 opération/);
        await disclosure.focus(); await page.keyboard.press("Enter");
        await excluded.waitFor();
        assert.equal(await excluded.getByRole("button").count(), 2);
        assert.match(await excluded.innerText(), /Paiement de carte.*-1\s?350,00/s);
        assert.match(await excluded.innerText(), /Transfert.*1\s?350,00/s);
        assert.equal(await sheet.evaluate(el => el.scrollWidth > el.clientWidth), false);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await sheet.screenshot({ path: join(screenshots, "separated-" + width + ".png") });
        const repayment = sheet.locator('[data-payment-id="fixture-card-repayment"]');
        await repayment.focus(); await page.keyboard.press("Enter");
        const editor = page.getByRole("dialog", { name: /Vérifier l.opération/ });
        await editor.waitFor();
        assert.equal(await editor.getByLabel("Nature", { exact: true }).inputValue(), "repayment");
        await editor.getByText("Sources et traçabilité", { exact: true }).click();
        assert.match(await editor.innerText(), /original.csv.*SHA-256/s);
        await editor.getByRole("button", { name: "Retour aux paiements de la catégorie", exact: true }).click();
        await excluded.waitFor();
        await page.waitForFunction(() => document.activeElement?.getAttribute("data-payment-id") === "fixture-card-repayment");
        const search = sheet.getByLabel("Rechercher dans cette catégorie", { exact: true });
        await search.fill("PAYMENT-THANKYOU");
        assert.equal(await included.getByRole("button").count(), 0);
        assert.equal(await excluded.getByRole("button").count(), 1);
        assert.match(await disclosure.innerText(), /1 opération\(s\) sur 2/);
        await search.fill("NO SYNTHETIC MATCH");
        assert.equal(await excluded.getByRole("button").count(), 0);
        await search.fill("");
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => document.activeElement?.textContent?.startsWith("À catégoriser"));
        await scope.selectOption("excluded");
        assert.equal(await register.getByRole("button").count(), 2);
        for (const [account, visible, absent] of [["card", "PAYMENT-THANKYOU", "TFR-TO"], ["bank", "TFR-TO", "PAYMENT-THANKYOU"]]) {
            await page.getByLabel("Compte", { exact: true }).selectOption(account);
            assert.equal(await register.getByRole("button").count(), 1);
            assert.match(await register.innerText(), new RegExp(visible));
            assert.doesNotMatch(await register.innerText(), new RegExp(absent));
            await scope.selectOption("expenses");
            assert.equal(await register.getByRole("button").count(), account === "card" ? 2 : 0);
            assert.doesNotMatch(await register.innerText(), /PAYMENT-THANKYOU|TFR-TO/);
            assert.match(await page.locator(".finance-totals").first().innerText(), account === "card" ? /30,00/ : /0,00/);
            await scope.selectOption("excluded");
        }
        assert.equal(posts, 0, "Viewing, filtering and opening sources must not save decisions");
        assert.deepEqual(await finance.read(), initial);
        await page.getByLabel("Compte", { exact: true }).selectOption("");
        await register.getByRole("button").filter({ hasText: "PAYMENT-THANKYOU" }).click();
        await editor.getByLabel("Note de décision", { exact: true }).fill("Synthetic repayment reviewed");
        await editor.getByRole("button", { name: "Enregistrer la décision", exact: true }).click();
        await editor.waitFor({ state: "hidden" });
        assert.equal(posts, 1);
        await page.reload();
        await scope.waitFor();
        assert.equal(await scope.inputValue(), "expenses");
        assert.doesNotMatch(await register.innerText(), /PAYMENT-THANKYOU|TFR-TO/);
        const saved = await new FinanceLibrary(join(temp, String(width))).read();
        assert.deepEqual(saved.data, initial.data);
        assert.deepEqual(saved.decisions["fixture-refund"], initial.decisions["fixture-refund"]);
        assert.equal(saved.decisions["fixture-card-repayment"].nature, "repayment");
        assert.equal(saved.decisions["fixture-card-repayment"].note, "Synthetic repayment reviewed");
        assert.deepEqual(errors, []);
        await context.close();
        console.log(`PASS excluded settlement legs, account filters, source/edit persistence and keyboard return at ${width}px`);
    }
} finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
}
