/** Built-PWA acceptance with synthetic data. No real worker, mailbox or provider is contacted. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join, resolve, extname } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
const root = resolve("apps/web/dist");
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const file = resolve(root, "." + pathname.replace(/^\/familyhub/, ""));
  if (file !== root && !file.startsWith(root + "/")) { response.writeHead(403); response.end(); return; }
  try {
    const bytes = await readFile(file === root || pathname.endsWith("/") ? join(root, "index.html") : file);
    response.setHeader("Content-Type", ({ ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png" })[extname(file)] || (file === root ? "text/html" : "application/octet-stream"));
    response.end(bytes);
  } catch { response.writeHead(404); response.end(); }
});
server.listen(0, "127.0.0.1"); await once(server, "listening");
const base = "http://127.0.0.1:" + server.address().port + "/familyhub/";
const output = await mkdtemp(join(tmpdir(), "familyhub-savings-browser-"));
let browser;
const report = { summary: "Synthetic comparison; no providers contacted.", missing: [], offers: [{
  provider: "Rogers", title: "Synthetic comparable plan", kind: "public-estimate", currentProvider: false,
  monthlyPrice: 60, promoMonths: 6, monthlyPriceAfterPromo: 80, upfrontFees: 10, annualLostDiscounts: 20,
  taxesIncluded: true, comparable: true, differences: [], conditions: ["Public price; eligibility unverified"],
  checkedAt: new Date().toISOString(), validUntil: null, sources: [{ title: "Synthetic source", url: "https://example.test/offer" }],
  liabilityLimit: null, collisionDeductible: null, comprehensiveDeductible: null, mortgageRate: null,
  termMonths: null, amortizationYears: null, rateType: "fixed", affectedContractIds: ["synthetic"]
}] };
try {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
    const page = await context.newPage(), errors = [], posts = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      if (!localStorage.getItem("synthetic-initialized")) {
        localStorage.clear(); sessionStorage.clear(); localStorage.setItem("synthetic-initialized", "yes");
        localStorage.setItem("familyhub.worker.v1", JSON.stringify({ Endpoint: "https://synthetic-worker.invalid", ApiKey: "synthetic-key" }));
      }
    });
    let job;
    await page.route("https://synthetic-worker.invalid/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      const reply = body => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body), headers: { "Access-Control-Allow-Origin": "*" } });
      if (request.method() === "OPTIONS") return reply({});
      if (path === "/health") return reply({ status: "ok", codex: "available", version: "2.19.0" });
      if (path === "/savings/research" && request.method() === "POST") {
        const body = request.postDataJSON(); posts.push(body);
        job = { id: "synthetic-job", contractId: body.contractId, baselineKey: body.baselineKey, baseline: body.baseline, status: "running", createdAt: new Date().toISOString() };
        return reply(job);
      }
      if (path === "/savings/research/synthetic-job") return reply({ ...job, status: "complete", report, completedAt: new Date().toISOString() });
      if (path === "/invoices") return reply({ items: [], reconciliations: [], unmatchedReimbursements: [], setupRequired: true, accounts: [] });
      return reply({ state: "idle", accounts: [] });
    });
    await page.goto(base + "?view=savings");
    await page.getByRole("heading", { name: "Savings", exact: true }).waitFor();
    assert.equal(await page.locator(".bottom-nav button").count(), 4);
    assert.equal(posts.length, 0, "Mount must not start research");
    await page.getByRole("button", { name: "Add contract", exact: true }).click();
    const form = page.getByRole("dialog", { name: "Add contract", exact: true });
    await form.getByLabel("Name", { exact: true }).fill("Synthetic internet");
    await form.getByLabel("Current provider", { exact: true }).fill("TELUS");
    await form.getByLabel("Current price (CAD, all-in)", { exact: true }).fill("100");
    await form.getByLabel("Price includes taxes and recurring fees?").selectOption("true");
    await form.getByLabel("Renewal / review date", { exact: true }).fill("2027-01-01");
    await form.getByLabel("Cancellation / break penalty (CAD)", { exact: true }).fill("40");
    await form.getByLabel("Annual discounts lost if switching (CAD)", { exact: true }).fill("20");
    await form.getByLabel("Service, coverage and usage requirements", { exact: true }).fill("PRIVATE-LOCAL-REQUIREMENT");
    await form.locator("summary").filter({ hasText: "Promotions, discounts and notes" }).click();
    await form.getByLabel("Private notes", { exact: true }).fill("PRIVATE-LOCAL-NOTES");
    await form.locator('input[type="file"]').setInputFiles({ name: "synthetic-policy.txt", mimeType: "text/plain", buffer: Buffer.from("PRIVATE-LOCAL-DOCUMENT") });
    await form.getByRole("button", { name: "Save contract", exact: true }).click();
    await page.getByRole("heading", { name: "Synthetic internet", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "Savings overflow at " + width);
    await page.reload(); await page.getByRole("heading", { name: "Synthetic internet", exact: true }).waitFor();
    await page.getByRole("button", { name: "Compare public offers", exact: true }).click();
    const research = page.getByRole("dialog", { name: "Compare public offers", exact: true });
    assert.ok(!(await research.innerText()).includes("PRIVATE-LOCAL"));
    await research.getByRole("button", { name: "Start public comparison", exact: true }).click();
    const results = page.getByRole("dialog", { name: "Synthetic internet: comparison", exact: true });
    await results.getByRole("heading", { name: "Rogers: Synthetic comparable plan", exact: true }).waitFor();
    assert.equal(posts.length, 1); assert.doesNotMatch(JSON.stringify(posts), /PRIVATE-LOCAL|synthetic-policy|Synthetic internet/);
    await results.getByLabel("I reviewed my saved requirements: service, coverage and benefits match.").check();
    await results.getByRole("button", { name: "Shortlist estimate", exact: true }).click();
    await results.getByRole("button", { name: "Close Synthetic internet: comparison", exact: true }).click();
    assert.match(await page.locator(".savings-summary").innerText(), /290/);
    await page.screenshot({ path: join(output, "savings-" + width + ".png"), fullPage: true });
    await page.getByRole("button", { name: "Results", exact: true }).click();
    await results.getByRole("button", { name: "Edit details", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "Edit contract", exact: true });
    assert.match(await edit.innerText(), /synthetic-policy.txt/);
    await edit.getByLabel("Current price (CAD, all-in)", { exact: true }).fill("110");
    await edit.getByRole("button", { name: "Save contract", exact: true }).click();
    await page.getByRole("button", { name: "Results", exact: true }).click();
    assert.match(await results.innerText(), /contract changed/);
    await results.getByRole("button", { name: "Close Synthetic internet: comparison", exact: true }).click();
    assert.match(await page.locator(".savings-summary").innerText(), /0 compatible/);
    await page.getByRole("button", { name: "Documents", exact: true }).last().click();
    for (const name of ["Desjardins", "Blue Cross", "Invoices"]) {
      await page.locator(".document-tabs").getByRole("button", { name, exact: true }).click();
      assert.equal(await page.locator(".document-tabs [aria-current=page]").innerText(), name);
      assert.equal(await page.locator("main h1").count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "Document overflow");
    }
    await page.goto(base + "?view=more");
    page.on("dialog", dialog => dialog.accept());
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export backup", exact: true }).click();
    const downloaded = await downloadEvent, backup = JSON.parse(await readFile(await downloaded.path(), "utf8"));
    assert.equal(backup.savings.Contracts.length, 1);
    assert.equal(Buffer.from(backup.savingsDocuments[0].data, "base64").toString(), "PRIVATE-LOCAL-DOCUMENT");
    assert.ok(!JSON.stringify(backup).includes("synthetic-key"), "Backup must exclude pairing secrets");
    const restore = page.locator(".backup-surface input[type=file]");
    await restore.setInputFiles({ name: "synthetic-backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
    await page.getByText("Backup restored. Worker pairing settings were intentionally not imported.").waitFor();
    assert.deepEqual(errors, [], "Browser console errors at " + width);
    assert.equal(posts.length, 1, "Backup and navigation must not replay research or contact providers");
    console.log("PASS Savings + Documents + document backup/restore at " + width + "px");
    await context.close();
  }
} finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); await rm(output, { recursive: true, force: true }); }
