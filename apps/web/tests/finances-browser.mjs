/** Synthetic built-PWA acceptance. No private worker or financial provider is contacted. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve, extname, sep } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { financeFixture } from "../../../tests/finance-fixture.mjs";
import { FinanceLibrary } from "../../worker/dist/finance-library.js";
import { SavingsLibrary } from "../../worker/dist/savings-library.js";
const root = resolve("apps/web/dist");
const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const file = resolve(root, "." + pathname.replace(/^\/familyhub/, ""));
    if (file !== root && !file.startsWith(root + sep)) {
        res.writeHead(403).end();
        return;
    }
    try {
        const bytes = await readFile(
            file === root || pathname.endsWith("/")
                ? join(root, "index.html")
                : file,
        );
        res.setHeader(
            "Content-Type",
            {
                ".js": "text/javascript",
                ".css": "text/css",
                ".html": "text/html",
                ".svg": "image/svg+xml",
                ".png": "image/png",
            }[extname(file)] ?? "text/html",
        );
        res.end(bytes);
    } catch {
        res.writeHead(404).end();
    }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}/familyhub/`;
const temp = await mkdtemp(join(tmpdir(), "familyhub-finance-browser-"));
const screenshots = resolve("output/playwright/finance");
await mkdir(screenshots, { recursive: true });
let browser;
try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    for (const width of [320, 390, 768, 1440]) {
        const finance = new FinanceLibrary(
            join(temp, String(width), "finances"),
        );
        const savings = new SavingsLibrary(
            join(temp, String(width), "contracts.json"),
        );
        const context = await browser.newContext({
            viewport: { width, height: 900 },
            serviceWorkers: "block",
        });
        const page = await context.newPage(),
            errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.setDefaultTimeout(10000);
        await page.addInitScript(() =>
            localStorage.setItem(
                "familyhub.worker.v1",
                JSON.stringify({
                    Endpoint: "https://synthetic-worker.invalid",
                    ApiKey: "synthetic-key",
                }),
            ),
        );
        let rejectNext = false,
            posts = 0;
        await page.route(
            "https://synthetic-worker.invalid/**",
            async (route) => {
                const req = route.request(),
                    path = new URL(req.url()).pathname;
                const reply = (body, status = 200) =>
                    route.fulfill({
                        status,
                        contentType: "application/json",
                        body: JSON.stringify(body),
                    });
                try {
                    if (req.method() === "OPTIONS") return reply({});
                    if (path === "/health")
                        return reply({
                            status: "ok",
                            codex: "available",
                            version: "2.23.0",
                        });
                    if (path === "/finances")
                        return reply(await finance.read());
                    if (path === "/finances/import") {
                        posts++;
                        return reply(await finance.import(req.postDataJSON()));
                    }
                    if (path === "/finances/decision") {
                        posts++;
                        if (rejectNext) {
                            rejectNext = false;
                            return reply(
                                {
                                    error: "Synthetic conflict: actualisez avant de réessayer",
                                },
                                409,
                            );
                        }
                        return reply(await finance.decide(req.postDataJSON()));
                    }
                    if (path === "/savings/contracts")
                        return reply(await savings.list());
                    if (path === "/savings/contracts/import")
                        return reply(await savings.import(req.postDataJSON()));
                    if (path.startsWith("/savings/contracts/"))
                        return reply(
                            await savings.update(
                                path.split("/").at(-1),
                                req.postDataJSON(),
                            ),
                        );
                    if (path.startsWith("/savings/documents/"))
                        return reply(
                            await savings.document(path.split("/").at(-1)),
                        );
                    if (path === "/savings/research")
                        return reply({ jobs: [], schedule: null, daily: null });
                    if (path === "/invoices")
                        return reply({
                            items: [],
                            reconciliations: [],
                            unmatchedReimbursements: [],
                            setupRequired: true,
                            accounts: [],
                        });
                    return reply({ state: "idle", accounts: [] });
                } catch (e) {
                    return reply({ error: e.message }, 400);
                }
            },
        );
        await page.goto(base + "?view=finances");
        await page
            .getByRole("heading", { name: "Aucun historique importé" })
            .waitFor();
        assert.equal(await page.locator(".bottom-nav button").count(), 5);
        assert.equal(await page.locator(".finance-tabs button").count(), 2);
        assert.equal(posts, 0);
        await page.locator(".finance-import > summary").click();
        const file = page.locator(".finance-import input[type=file]");
        await file.setInputFiles({
            name: "invalid.json",
            mimeType: "application/json",
            buffer: Buffer.from("{}"),
        });
        await page
            .getByRole("alert")
            .filter({ hasText: "Format attendu" })
            .waitFor();
        const bundle = financeFixture();
        bundle.accounts.push({
            ...bundle.accounts[0],
            accountId: "usd",
            alias: "Compte USD synthétique",
            currency: "USD",
        });
        bundle.bankActivities.push({
            ...bundle.bankActivities[0],
            id: "usd-expense",
            accountId: "usd",
            descriptionOriginal: "SYNTHETIC RESTAURANT USD",
            currency: "USD",
            debitCents: 2500,
            signedOutflowCents: 2500,
        });
        await file.setInputFiles({
            name: "synthetic.json",
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify(bundle)),
        });
        await page
            .getByRole("button", { name: /Confirmer l.import sur le PC/ })
            .click();
        await page
            .getByRole("heading", { name: "Dépenses par catégorie" })
            .waitFor();
        await page.locator(".finance-import > summary").click();
        assert.equal(
            await page.getByLabel("Du", { exact: true }).inputValue(),
            "2026-04-01",
        );
        assert.equal(
            await page.getByLabel("Au", { exact: true }).inputValue(),
            "2026-09-30",
        );
        assert.match(
            await page.locator(".finance-totals").first().innerText(),
            /2\s?852/,
        );
        assert.match(
            await page
                .getByRole("button", { name: /SPOTIFY SYNTHETIC.*Hausse/ })
                .innerText(),
            /2026-08-10.*2026-09-10/s,
        );
        await page.getByLabel("Devise").selectOption("USD");
        assert.match(
            await page.locator(".finance-totals").first().innerText(),
            /25,00/,
        );
        assert.equal(
            await page
                .locator(".finance-register button")
                .filter({ hasText: "SYNTHETIC RESTAURANT USD" })
                .count(),
            1,
        );
        await page.getByLabel("Devise").selectOption("CAD");
        await page.getByLabel("Catégorie").selectOption("groceries");
        await page
            .locator(".finance-register button")
            .filter({ hasText: "SAFEWAY SYNTHETIC" })
            .filter({ hasText: "124,50" })
            .click();
        const sheet = page.getByRole("dialog", {
            name: /Vérifier l.opération/,
        });
        await sheet
            .getByText("Sources et traçabilité", { exact: true })
            .click();
        assert.match(await sheet.innerText(), /original.csv.*SHA-256/s);
        await sheet
            .getByLabel("Note de décision")
            .fill("Synthetic reviewed purchase");
        rejectNext = true;
        await sheet
            .getByRole("button", { name: "Enregistrer la décision" })
            .click();
        await sheet
            .getByRole("alert")
            .filter({ hasText: "Synthetic conflict" })
            .waitFor();
        assert.equal((await finance.read()).decisions.groceries, undefined);
        await sheet
            .getByRole("button", { name: "Enregistrer la décision" })
            .click();
        await sheet.waitFor({ state: "hidden" });
        await page.reload();
        await page
            .getByRole("heading", { name: "Dépenses par catégorie" })
            .waitFor();
        assert.equal(
            (await finance.read()).decisions.groceries.note,
            "Synthetic reviewed purchase",
        );
        assert.ok(
            !(await page.evaluate(() => JSON.stringify(localStorage))).includes(
                "SAFEWAY SYNTHETIC",
            ),
            "Ledger must not be cached in browser storage",
        );
        await page.getByLabel("Du", { exact: true }).fill("2026-03-15");
        assert.match(
            await page.locator(".finance-chart-grid").innerText(),
            /Période partielle/,
        );
        await page.getByLabel("Du", { exact: true }).fill("2026-04-01");
        await page.getByLabel("Population de référence").selectOption("bc");
        assert.match(await page.locator(".finance-view").innerText(), /2023/);
        assert.equal(
            await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth,
            ),
            false,
            "Expense overflow at " + width,
        );
        await page.screenshot({
            path: join(screenshots, "expenses-" + width + ".png"),
            fullPage: true,
        });
        await page
            .getByRole("button", { name: "Investissements", exact: true })
            .click();
        await page
            .getByRole("heading", { name: "REER de test", exact: true })
            .waitFor();
        assert.match(
            await page.locator(".finance-view").innerText(),
            /Fonds synthétique/,
        );
        assert.match(
            await page.locator(".finance-view").innerText(),
            /Cotisations identifiées/,
        );
        await page.getByRole("button", { name: /CPG de test.*gic/ }).click();
        await page
            .getByRole("heading", { name: "Échéance du CPG : 2027-08-01" })
            .waitFor();
        assert.equal(
            await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth,
            ),
            false,
            "Investment overflow at " + width,
        );
        await page.screenshot({
            path: join(screenshots, "investments-" + width + ".png"),
            fullPage: true,
        });
        await page.goto(base + "?view=savings");
        await page
            .getByRole("button", { name: "Add contract", exact: true })
            .click();
        const form = page.getByRole("dialog", {
            name: "Add contract",
            exact: true,
        });
        await form
            .getByLabel("Name", { exact: true })
            .fill("Synthetic package");
        await form
            .locator("summary")
            .filter({ hasText: /Facture d.origine et services inclus/ })
            .click();
        await form.getByLabel("Montant facturé", { exact: true }).fill("120");
        await form.getByLabel("Taxes de cette facture").selectOption("true");
        await form.getByLabel("Date du montant").fill("2026-10-01");
        await form
            .getByLabel("Source / période originale")
            .fill("Synthetic invoice, one month");
        await form.getByRole("button", { name: "Ajouter un service" }).click();
        await form.getByLabel("Nom du service").fill("Synthetic streaming");
        await form.getByLabel("Coût").selectOption("included");
        await form
            .getByLabel("Source du service")
            .fill("Synthetic package terms");
        await form
            .locator("input[type=file]")
            .setInputFiles({
                name: "synthetic-invoice.txt",
                mimeType: "text/plain",
                buffer: Buffer.from("SYNTHETIC DOCUMENT"),
            });
        await form
            .getByRole("button", { name: "Save contract", exact: true })
            .click();
        await page
            .getByRole("heading", { name: "Synthetic package", exact: true })
            .waitFor();
        const services = page.getByRole("region", {
            name: "Services et dépenses récurrentes",
        });
        assert.match(await services.innerText(), /Inclus/);
        assert.match(await services.innerText(), /120,00/);
        await services
            .getByRole("button", { name: /Synthetic streaming/ })
            .click();
        const edit = page.getByRole("dialog", {
            name: "Edit contract",
            exact: true,
        });
        assert.match(await edit.innerText(), /synthetic-invoice.txt/);
        await edit.getByRole("button", { name: "Close", exact: true }).click();
        await page.reload();
        await page
            .getByRole("heading", { name: "Synthetic package", exact: true })
            .waitFor();
        assert.match(await services.innerText(), /120,00/);
        assert.equal(
            await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth,
            ),
            false,
            "Service overflow at " + width,
        );
        await page.screenshot({
            path: join(screenshots, "services-" + width + ".png"),
            fullPage: true,
        });
        assert.deepEqual(errors, [], "Browser errors at " + width);
        await context.close();
        console.log(
            "PASS Finances imports, edits, currencies, charts and package evidence at " +
                width +
                "px",
        );
    }
} finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
}
