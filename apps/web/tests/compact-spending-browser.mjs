/** Synthetic compact UI acceptance. All worker responses are isolated; no household or provider access. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve, extname, sep } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { FinanceLibrary } from "../../worker/dist/finance-library.js";
import { newContract, baselineKey, publicBaseline } from "../../worker/dist/savings-model.js";
import { trendsFixture } from "../../../tests/finance-trends-fixture.mjs";

const root = resolve("apps/web/dist"), temp = await mkdtemp(join(tmpdir(), "familyhub-compact-"));
const output = resolve("output/playwright/compact"); await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const file = resolve(root, "." + pathname.replace(/^\/familyhub/, ""));
    if (file !== root && !file.startsWith(root + sep)) return res.writeHead(403).end();
    try { res.setHeader("Content-Type", ({ ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" })[extname(file)] ?? "text/html"); res.end(await readFile(file === root || pathname.endsWith("/") ? join(root, "index.html") : file)); }
    catch { res.writeHead(404).end(); }
});
server.listen(0, "127.0.0.1"); await once(server, "listening");
const base = process.env.FAMILYHUB_TEST_BASE || `http://127.0.0.1:${server.address().port}/familyhub/`;
const first = { ...newContract("telecom", "synthetic-network"), name: "Synthetic internet package", provider: "TELUS", price: 120, taxesIncluded: true, needs: "Synthetic service match", cancellationFee: 0, annualLostDiscounts: 0,
    billing: { amount: 120, currency: "CAD", count: 1, unit: "months", asOf: "2026-09-05", source: "Synthetic original", taxesIncluded: true },
    services: [{ id: "network-main", name: "Synthetic internet", pricing: "documented", monthlyAmount: 120, taxesIncluded: true, source: "Synthetic original" }, { id: "network-included", name: "Synthetic included streaming", pricing: "included", monthlyAmount: null, taxesIncluded: null, source: "Synthetic original" }] };
const second = { ...newContract("subscription", "synthetic-music"), name: "Synthetic music", provider: "Spotify", price: 20, taxesIncluded: true, needs: "Synthetic music service", cancellationFee: 0, annualLostDiscounts: 0 };
const third = { ...newContract("other", "synthetic-unknown"), name: "Synthetic unknown amount", provider: "Unconfirmed source" };
const contracts = [first, second, third];
contracts.forEach(contract => { contract.updatedAt = "2026-10-10T12:00:00Z"; });
const offer = { provider: "Synthetic alternative", title: "Synthetic comparable offer", kind: "public-estimate", currentProvider: false, monthlyPrice: 80, promoMonths: 0, monthlyPriceAfterPromo: null, upfrontFees: 0, annualLostDiscounts: 0, taxesIncluded: true, comparable: true, differences: ["Synthetic service condition " + "long evidence ".repeat(35)], conditions: ["Eligibility must be confirmed from the dated source"], checkedAt: "2026-10-10T12:00:00Z", validUntil: "2026-10-31", sources: [{ title: "Synthetic offer source", url: "https://example.test/offer" }], liabilityLimit: null, collisionDeductible: null, comprehensiveDeductible: null, mortgageRate: null, termMonths: null, amortizationYears: null, rateType: "fixed", affectedContractIds: [first.id] };
const job = (contract, id, offers) => ({ id, contractId: contract.id, baselineKey: createHash("sha256").update(baselineKey(contract)).digest("hex"), baseline: publicBaseline(contract), status: "complete", createdAt: "2026-10-10T12:00:00Z", completedAt: "2026-10-10T12:01:00Z", report: { summary: "Synthetic report with all conditions retained. ".repeat(50) + " [Readable official source](https://example.test/source). " + "UNBROKEN".repeat(65), missing: ["Synthetic unresolved eligibility"], offers } });
const jobs = [job(first, "old-network", [{ ...offer, title: "Synthetic old offer" }]), job(first, "new-network", [{ ...offer, comparable: false, title: "Synthetic inapplicable offer" }, offer]), job(second, "music-job", [{ ...offer, title: "Synthetic music alternative", monthlyPrice: 10, affectedContractIds: [second.id] }]), job(third, "empty-job", [])];
jobs[0].createdAt = "2026-10-09T12:00:00Z"; jobs[0].completedAt = "2026-10-09T12:01:00Z";
let browser;
try {
    browser = await chromium.launch({ headless: true });
    for (const width of [320, 390, 768, 1440]) {
        const fixture = trendsFixture();
        fixture.bundle.bankActivities.push({ ...fixture.bundle.bankActivities[0], id: "synthetic-recurring", sourceRowId: "synthetic-recurring", matchingFingerprint: "synthetic-recurring", transactionDate: "2026-09-05", descriptionOriginal: "TELUS SYNTHETIC", signedOutflowCents: 12000, debitCents: 12000, creditCents: null, accountId: "card" });
        fixture.decisions["synthetic-recurring"] = { nature: "expense", category: "other", note: "Synthetic source", updatedAt: "" };
        for (const [index, category] of ["pets", "jasmine-school", "transport", "health", "household", "other"].entries()) {
            const id = "synthetic-extra-category-" + index;
            fixture.bundle.bankActivities.push({ ...fixture.bundle.bankActivities[0], id, sourceRowId: id, matchingFingerprint: id, transactionDate: "2026-09-06", descriptionOriginal: "SYNTHETIC CATEGORY " + index, signedOutflowCents: 100 + index, debitCents: 100 + index, creditCents: null, accountId: "card" });
            fixture.decisions[id] = { nature: "expense", category, note: "Synthetic navigation fixture", updatedAt: "" };
        }
        const library = new FinanceLibrary(join(temp, String(width)));
        let finance = (await library.import({ bundle: fixture.bundle, apply: true, expectedRevision: "empty" })).state;
        for (const [id, decision] of Object.entries(fixture.decisions)) finance = await library.decide({ id, decision, expectedRevision: finance.revision });
        const before = JSON.stringify(finance), context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 500, serviceWorkers: "block", reducedMotion: "reduce" });
        const page = await context.newPage(), errors = [], writes = [];
        page.setDefaultTimeout(10000); page.on("pageerror", e => errors.push(e.message));
        await page.clock.setFixedTime(new Date("2026-10-11T12:00:00Z"));
        await page.addInitScript(() => localStorage.setItem("familyhub.worker.v1", JSON.stringify({ Endpoint: "https://synthetic-worker.invalid", ApiKey: "synthetic-key" })));
        await context.route("https://synthetic-worker.invalid/**", async route => {
            const request = route.request(), path = new URL(request.url()).pathname;
            const reply = body => route.fulfill({ json: body });
            if (request.method() === "OPTIONS") return reply({});
            if (request.method() !== "GET") { writes.push(path); return route.fulfill({ status: 403, json: { error: "No mutation in this test" } }); }
            if (path === "/finances") return reply(finance);
            if (path === "/groceries") return reply({ records: [] });
            if (path === "/notifications") return route.fulfill({ status: 503, json: { error: "Synthetic notification server unavailable" } });
            if (path === "/savings/contracts") return reply({ records: contracts.map(contract => ({ contract, revision: "synthetic-" + contract.id })) });
            if (path === "/savings/research") return reply({ jobs, schedule: null, daily: null });
            if (path === "/health") return reply({ status: "ok", codex: "available", version: "2.24.0" });
            if (path === "/invoices") return reply({ items: [], reconciliations: [], unmatchedReimbursements: [], setupRequired: true, accounts: [] });
            return reply({ state: "idle", accounts: [], jobs: [] });
        });
        const click = async locator => width < 500 ? locator.tap() : locator.click();
        const overflow = async locator => assert.equal(await locator.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
        const bounded = async dialog => {
            await overflow(dialog);
            assert(await dialog.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; }), "Dialog stays inside viewport");
        };
        await page.goto(base + "?view=finances");
        await page.getByRole("heading", { name: "Dépenses par catégorie", exact: true }).waitFor();
        const noBellOverlap = async () => assert(await page.locator(".shell-tools button").evaluate(el => {
            const a = el.getBoundingClientRect(), action = document.querySelector(".page-heading-actions button")?.getBoundingClientRect();
            return !action || a.right <= action.left || a.left >= action.right || a.bottom <= action.top || a.top >= action.bottom;
        }), "Compact bell does not cover a header action");
        await noBellOverlap();
        assert.equal(await page.getByLabel("Vue", { exact: true }).inputValue(), "month");
        const tabs = await page.locator(".finance-tabs button").evaluateAll(els => els.map(el => el.getBoundingClientRect().top));
        assert(tabs.every(top => Math.abs(top - tabs[0]) < 2), "Tabs remain on one line");
        assert.equal(await page.locator(".bottom-nav button").count(), 5);
        const categories = page.locator(".finance-expense-charts > section").first();
        assert.equal(await categories.locator(".finance-bars li:visible").count(), 5, "Overview retains five leading categories");
        const more = categories.locator(".finance-more-categories > summary");
        await click(more);
        assert.equal(await categories.locator(".finance-bars li:visible").count(), await categories.locator(".finance-bars li").count(), "Every other category remains reachable");
        const remainder = categories.locator(".finance-more-categories .finance-bar-track > span");
        assert((await remainder.evaluateAll(els => els.map(el => parseFloat(el.style.width)))).every(width => width < 1), "Secondary categories share the leading chart scale");
        await categories.locator(".finance-more-categories .finance-bars button").first().click();
        const payments = page.getByRole("dialog", { name: /^Paiements/ });
        await payments.waitFor(); await page.keyboard.press("Escape");
        await page.waitForFunction(() => document.activeElement?.closest(".finance-more-categories"));
        await click(more);

        const filters = page.getByRole("button", { name: /^Filtres/ }), filterDialog = page.getByRole("dialog", { name: "Filtres des finances", exact: true });
        assert.equal(await filterDialog.isVisible(), false);
        const total = await page.locator(".finance-totals").first().innerText();
        for (let i = 0; i < 3; i++) {
            await click(filters); await bounded(filterDialog); assert.equal(await filters.getAttribute("aria-expanded"), "true");
            await page.keyboard.press("Shift+Tab"); assert.equal(await filterDialog.getByRole("button", { name: "Voir les résultats" }).evaluate(el => el === document.activeElement), true);
            await page.keyboard.press("Tab"); assert.match(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), /Fermer/);
            await page.keyboard.press("Escape"); await page.waitForFunction(() => document.activeElement?.textContent?.startsWith("Filtres"));
        }
        await click(filters); await filterDialog.getByLabel("Vue", { exact: true }).selectOption("year"); await filterDialog.getByRole("button", { name: "Voir les résultats" }).click();
        assert.match(await page.locator(".finance-scope").innerText(), /2026/);
        await click(filters); await filterDialog.getByLabel("Vue", { exact: true }).selectOption("month"); await filterDialog.getByLabel("Mois", { exact: true }).selectOption("9"); await filterDialog.getByRole("button", { name: "Voir les résultats" }).click();
        assert.equal(await page.locator(".finance-totals").first().innerText(), total);
        const info = page.getByRole("button", { name: "Informations : Calcul des dépenses", exact: true });
        await click(info); const infoDialog = page.getByRole("dialog", { name: "Calcul des dépenses", exact: true }); await bounded(infoDialog);
        assert.match(await infoDialog.innerText(), /hypothécaire|capital\/intérêts/); await page.keyboard.press("Escape"); assert(await info.evaluate(el => el === document.activeElement));
        await page.screenshot({ path: join(output, `finances-${width}.png`) });
        await page.goto(base + "?view=savings");
        await page.getByRole("button", { name: /Ouvrir le contrat Synthetic internet package/ }).waitFor();
        await noBellOverlap();
        const disclosure = page.locator(".saved-comparisons > summary"), paid = page.getByRole("region", { name: "Paiements TTC de la période" });
        await page.waitForFunction(() => document.querySelector(".saved-comparisons .count-badge")?.textContent === "3");
        const paidBefore = await paid.innerText(); assert.match(paidBefore, /120,00/);
        assert.equal(await page.locator(".recurring-package-service").filter({ hasText: "Inclus" }).count(), 1);
        await click(disclosure); assert.equal(await page.locator(".saved-comparison-list > button").count(), 3);
        await page.keyboard.press("Escape"); assert(await disclosure.evaluate(el => el === document.activeElement));
        await page.locator(".savings-toolbar select").selectOption("telecom"); assert.equal(await page.locator(".count-badge").filter({ hasText: /^1$/ }).count(), 1);
        await page.locator(".savings-toolbar select").selectOption("all"); assert.equal(await paid.innerText(), paidBefore);
        const lead = page.getByRole("button", { name: "Économie possible pour Synthetic internet package, ouvrir la comparaison", exact: true });
        await lead.waitFor(); assert.match(await lead.innerText(), /À vérifier/); assert.doesNotMatch(await lead.innerText(), /\$/);
        const result = page.getByRole("dialog", { name: "Synthetic internet package : comparaison", exact: true });
        for (let i = 0; i < 3; i++) {
            await click(lead); await bounded(result);
            assert.equal(await result.getByLabel("Result history").inputValue(), "new-network");
            const chosen = result.locator('[id="comparison-offer-new-network-1"]');
            assert.equal(await chosen.getAttribute("open"), "");
            await chosen.locator(":scope > summary").click(); assert.equal(await chosen.getAttribute("open"), null);
            await page.keyboard.press("Enter"); assert.equal(await chosen.getAttribute("open"), "");
            assert.match(await chosen.innerText(), /Eligibility and conditions/);
            assert.equal(await chosen.getByRole("link", { name: "Synthetic offer source" }).getAttribute("href"), "https://example.test/offer");
            await chosen.getByText("Eligibility and conditions", { exact: true }).click(); assert.match(await chosen.innerText(), /Eligibility must be confirmed/);
            await chosen.getByText("Eligibility and conditions", { exact: true }).click();
            await page.keyboard.press("Escape"); await page.waitForFunction(() => document.activeElement?.classList.contains("comparison-lead"));
        }
        await click(lead); await result.locator(".comparison-context > summary").click(); await overflow(result.locator(".sheet-content"));
        assert.equal(await result.getByRole("link", { name: "Readable official source" }).getAttribute("href"), "https://example.test/source");
        await result.locator(".comparison-context > summary").click();
        await result.getByLabel("Result history").selectOption("old-network");
        assert.equal(await result.locator(".saved-offer").count(), 1); assert.match(await result.locator(".saved-offer > summary").innerText(), /Synthetic old offer/);
        await result.getByLabel("Result history").selectOption("new-network"); await result.locator(".saved-offer > summary").nth(1).click();
        await result.screenshot({ path: join(output, `comparison-${width}.png`) }); await page.keyboard.press("Escape");
        await page.getByRole("button", { name: /Économie possible pour Synthetic music/ }).click();
        assert.equal(await page.getByRole("dialog", { name: "Synthetic music : comparaison" }).getByLabel("Result history").inputValue(), "music-job"); await page.keyboard.press("Escape");
        await page.getByRole("button", { name: /Ouvrir le contrat Synthetic internet package/ }).click(); await page.getByRole("button", { name: "Results", exact: true }).click();
        await page.keyboard.press("Escape"); await page.getByRole("dialog", { name: "Contrat · Synthetic internet package", exact: true }).waitFor();
        await page.waitForFunction(() => document.activeElement?.hasAttribute("data-savings-results"));
        assert.equal(await page.getByRole("button", { name: "Results", exact: true }).evaluate(el => el === document.activeElement), true, "Contract result link regains focus");
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => document.activeElement?.classList.contains("recurring-package"));
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({ path: join(output, `services-${width}.png`), fullPage: true });
        await page.getByRole("button", { name: "Courses", exact: true }).filter({ visible: true }).click(); await page.getByRole("heading", { name: "Courses", exact: true }).waitFor(); assert.match(page.url(), /view=groceries/);
        await page.getByRole("button", { name: "Plus", exact: true }).filter({ visible: true }).click(); assert.equal(await page.locator(".other-link strong").filter({ hasText: /^Courses$/ }).count(), 0);
        const bell = page.getByRole("button", { name: "Ouvrir les notifications", exact: true }); assert.equal((await bell.innerText()).trim(), ""); await click(bell); assert.match(page.url(), /view=notifications/);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(writes, []); assert.equal(JSON.stringify(await library.read()), before); assert.deepEqual(errors, []);
        await context.close(); console.log(`PASS compact controls, comparison evidence/focus/touch and direct navigation at ${width}px`);
    }
} finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); await rm(temp, { recursive: true, force: true }); }
