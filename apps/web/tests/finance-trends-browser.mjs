import { openFinanceFilters, selectFinanceFilter } from "./finance-filter-helpers.mjs";
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
    browser = await chromium.launch({ ...(process.env.FAMILYHUB_TEST_BROWSER_CHANNEL ? { channel: process.env.FAMILYHUB_TEST_BROWSER_CHANNEL } : {}), headless: true, args: ["--no-sandbox"] });
    for (const width of [320, 390, 768, 1440]) {
        const finance = new FinanceLibrary(join(temp, String(width))), fixture = trendsFixture();
        fixture.bundle.accounts.push({...fixture.bundle.accounts[0],accountId:"usd-synthetic",alias:"USD fictif sans mouvements",currency:"USD",observedBalanceCents:null});
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
                if (mode === "zero") state.data.transactions = [];
                if (mode === "net-zero") {
                    state.data.transactions = state.data.transactions.filter(r => !r.date.startsWith("2026-10") || ["oct-food", "oct-refund"].includes(r.id));
                    state.data.transactions.find(r => r.id === "oct-refund").outflowCents = -20000;
                }
                if (mode === "refund") state.data.transactions = state.data.transactions.filter(r => r.id === "oct-refund");
                if (mode === "target-gap") state.data.coverage.find(c => c.accountId === "card").latest = "2026-09-30";
                if (mode === "missing") state.data.accounts.push({ ...state.data.accounts[0], id: "missing", name: "Missing synthetic card", type: "credit-card" });
                return reply(state);
            }
            if (path === "/finances/changes") { posts++; return reply(await finance.change(req.postDataJSON())); }
            if (req.method() !== "GET") throw new Error("Unexpected synthetic mutation: " + path);
            if (path === "/health") return reply({ status: "ok", codex: "available", version: "2.23.3" });
            if (path === "/invoices") return reply({ items: [], reconciliations: [], unmatchedReimbursements: [], setupRequired: true, accounts: [] });
            return reply({ state: "idle", accounts: [], jobs: [], schedule: null, daily: null });
        });
        await page.goto(base + "?view=finances");
        await page.getByRole("button", { name:"Tendances",exact:true }).click();
        const view=page.locator('.finance-trends');await view.waitFor();
        assert.equal(await view.getByLabel('Mois analysé',{exact:true}).inputValue(),'2026-10','Direct entry opens the current month');
        assert.equal(await view.locator('.trend-annual').count(),0);
        assert.equal(await view.locator('[data-trend-month]').count(),4);
        assert.equal(await page.getByRole('button',{name:'Source récente',exact:true}).count(),0);
        assert.equal(await page.getByRole('button',{name:'Registre historique',exact:true}).count(),0);
        const openMonth=async month=>{await view.getByLabel('Mois analysé',{exact:true}).fill(month);await page.waitForFunction(month=>document.querySelector('[data-trend-month][aria-current="date"]')?.getAttribute('data-trend-month')===month,month);};
        const headline=view.locator('.trend-headline');
        assert.match(await headline.innerText(),/780,00.*65,00.*715,00/s);
        assert.match(await view.innerText(),/9 premiers jours/);
        assert(await view.getByRole('img',{name:/Cumul quotidien observé/}).isVisible(),'Curve is visible without disclosure');
        await view.getByText('Valeurs jour par jour',{exact:true}).click();
        assert.equal(await view.locator('.trend-table tbody tr').count(),9);
        assert.match(await view.locator('.trend-table tbody tr').last().innerText(),/780,00.*715,00/);
        await view.getByText('Valeurs jour par jour',{exact:true}).click();
        await view.getByRole('button',{name:'Informations : Lecture des tendances',exact:true}).click();
        const method=page.getByRole('dialog',{name:'Lecture des tendances',exact:true});
        await method.getByText('Méthode et couverture des sources',{exact:true}).click();
        assert.match(await method.innerText(),/2026-04-01 au 2026-04-09/);assert.match(await method.innerText(),/Older card history unavailable/);assert.match(await method.innerText(),/pas une économie garantie/);
        await page.keyboard.press('Escape');
        const delta=view.locator('[data-trend-delta]'),detail=page.getByRole('dialog',{name:'Écart à la référence',exact:true});
        const reconcile=async()=>{
          const total=Number(await delta.getAttribute('data-trend-delta'));
          const rows=await detail.locator('[data-difference-cents]').evaluateAll(els=>els.map(el=>Number(el.dataset.differenceCents)));
          assert(rows.length>=2);assert.equal(rows.reduce((a,b)=>a+b,0),total);
          assert.equal(await detail.locator('[data-trend-category="housing"]').count(),1);
          assert.equal(await detail.locator('[data-trend-category="groceries"]').count(),1);
          assert.equal(await detail.evaluate(el=>el.scrollWidth>el.clientWidth),false);
        };
        for(let repeat=0;repeat<3;repeat++){
          await openMonth(repeat===1?'2026-09':'2026-10');await delta.focus();await page.keyboard.press('Enter');await detail.waitFor();await reconcile();
          for(let i=0;i<4;i++)await page.keyboard.press('Tab');assert(await detail.evaluate(el=>el.contains(document.activeElement)));
          if(repeat===1)await page.goBack();else await page.keyboard.press('Escape');
          await detail.waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement?.hasAttribute('data-trend-delta'));
        }
        await page.screenshot({path:join(screenshots,`overview-${width}.png`),fullPage:true});
        await delta.click();await detail.waitFor();await detail.screenshot({path:join(screenshots,`attribution-${width}.png`)});
        const food=detail.locator('[data-trend-category="groceries"]');await food.focus();await page.keyboard.press('Enter');
        const sheet=page.getByRole('dialog',{name:/^Paiements.*Courses alimentaires$/});await sheet.waitFor();
        assert.equal(await sheet.locator('[aria-label="Opérations de dépenses"] button').count(),2);
        assert.doesNotMatch(await sheet.innerText(),/oct-card-payment|oct-transfer/);
        await sheet.locator('[data-payment-id="oct-food"]').click();
        const editor=page.getByRole('dialog',{name:/Vérifier l.opération/});
        await editor.getByText('Sources et traçabilité',{exact:true}).click();assert.match(await editor.innerText(),/original.csv.*SHA-256/s);
        await editor.getByRole('button',{name:'Retour aux paiements de la catégorie',exact:true}).click();await sheet.waitFor();
        await page.goBack();await sheet.waitFor({state:'hidden'});await detail.waitFor();
        await page.waitForFunction(()=>document.activeElement?.getAttribute('data-trend-category')==='groceries');
        assert.equal(posts,0);
        await food.click();await sheet.locator('[data-payment-id="oct-food"]').click();
        await editor.getByLabel('Catégorie',{exact:true}).selectOption('restaurants');await editor.getByRole('button',{name:'Enregistrer la décision',exact:true}).click();
        await editor.waitFor({state:'hidden'});await page.keyboard.press('Escape');await detail.waitFor();await reconcile();
        assert.match(await food.innerText(),/-20,00/);assert.match(await detail.locator('[data-trend-category="restaurants"]').innerText(),/200,00/);
        await page.keyboard.press('Escape');assert.equal(posts,1);assert.match(await headline.innerText(),/780,00.*715,00/s);
        await selectFinanceFilter(page,'Compte','bank');assert.match(await headline.innerText(),/600,00.*0,00.*600,00/s);
        await selectFinanceFilter(page,'Compte','');
        await selectFinanceFilter(page,'Devise','USD');assert.match(await headline.innerText(),/Non disponible/);assert.equal(await delta.count(),0);await selectFinanceFilter(page,'Devise','CAD');
        await openMonth('2026-04');assert.match(await headline.innerText(),/Référence indisponible/);assert.equal(await delta.count(),0);
        await openMonth('2026-11');assert.match(await headline.innerText(),/Non disponible/);assert.equal(await delta.count(),0);
        await openMonth('2026-10');
        const saved=await new FinanceLibrary(join(temp,String(width))).read();assert.deepEqual(saved.data,initial.data);assert.equal(saved.decisions['oct-food'].category,'restaurants');
        mode='missing';await page.getByRole('button',{name:'Actualiser',exact:true}).click();await view.getByRole('status').filter({hasText:'Référence indicative'}).waitFor();assert.match(await headline.innerText(),/780,00/);
        mode='target-gap';await page.getByRole('button',{name:'Actualiser',exact:true}).click();await view.getByRole('status').filter({hasText:'Référence indicative'}).waitFor();assert.match(await headline.innerText(),/780,00/);
        mode='zero';await page.getByRole('button',{name:'Actualiser',exact:true}).click();await view.locator('.trend-total').filter({hasText:/^Non disponible/}).waitFor();assert.equal(await delta.count(),0);
        mode='net-zero';await page.getByRole('button',{name:'Actualiser',exact:true}).click();await view.locator('.trend-total').filter({hasText:/^0,00/}).waitFor();assert.match(await headline.innerText(),/0,00.*-715,00.*715,00/s);
        mode='refund';await page.getByRole('button',{name:'Actualiser',exact:true}).click();await view.locator('.trend-total').filter({hasText:/-20,00/}).waitFor();assert.match(await headline.innerText(),/Référence indisponible/);assert.equal(await delta.count(),0);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
        mode='error';await page.getByRole('button',{name:'Actualiser',exact:true}).click();await page.getByText('Synthetic unavailable',{exact:true}).waitFor();
        mode='empty';await page.getByRole('button',{name:'Actualiser',exact:true}).click();await page.getByRole('heading',{name:'Aucun historique importé',exact:true}).waitFor();assert.equal(await view.count(),0);
        assert.deepEqual(errors,[]);
        await context.close();
        console.log(`PASS direct month A, reconciled signed B, refunds/zero/missing/partial, accounts/currency and nested keyboard/Back at ${width}px`);
    }
} finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
}
