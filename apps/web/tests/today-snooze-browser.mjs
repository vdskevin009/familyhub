/** Isolated synthetic lifecycle only. Never connects to a household worker. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { once } from "node:events";
import { resolve, join, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { OpportunityActions } from "../../worker/dist/opportunity-actions.js";
import { newContract } from "../../worker/dist/savings-model.js";
import { emptyMortgage } from "../../worker/dist/mortgage-model.js";
import { emptyPlan } from "../../worker/dist/grocery-planning.js";

export async function verifyTodaySnooze() {
  const root = resolve("apps/web/dist"), output = resolve("output/playwright/committee-20261118");
  await mkdir(output, { recursive: true });
  const temporary = await mkdtemp(join(tmpdir(), "familyhub-snooze-synthetic-"));
  const now = new Date("2026-11-18T20:00:00Z"), api = "https://snooze-fixture.invalid", errors = [], external = [], cases = [];
  const server = createServer(async (req, res) => {
    const name = new URL(req.url, "http://localhost").pathname.replace(/^\/familyhub/, ""), file = resolve(root, "." + (name.endsWith("/") ? name + "index.html" : name));
    if (file !== root && !file.startsWith(root + sep)) return res.writeHead(403).end();
    try { res.setHeader("Content-Type", ({ ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml" })[extname(file)] ?? "text/plain"); res.end(await readFile(file)); } catch { res.writeHead(404).end(); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/familyhub/`;
  let browser;
  async function setup(width, key, due = "2026-11-20", paired = true, zone = "America/Vancouver") {
    const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: zone, reducedMotion: "reduce", serviceWorkers: "block" });
    const page = await context.newPage(); page.setDefaultTimeout(15000); await page.clock.setFixedTime(now); page.on("pageerror", e => errors.push(e.message));
    const actions = new OpportunityActions(join(temporary, `${width}-${key}.json`));
    const contract = { ...newContract("home-insurance", "synthetic-policy"), name: "Sample home insurance", provider: "Example insurer", renewal: due, updatedAt: now.toISOString() };
    const snapshot = { items: [], reconciliations: [], busy: false, setupRequired: false, cleanupSuggestions: [], importantMail: [], unmatchedReimbursements: [], ignoredUnmatchedReimbursements: [], learning: { decisions: 0, undoable: [] }, accounts: [], progress: {}, lastSuccess: now.toISOString() };
    const sources = { "/invoices": snapshot, "/savings/contracts": { schema: 1, records: [{ contract, revision: "synthetic-contract" }], documents: [] }, "/savings/research": { jobs: [], daily: null, schedule: null }, "/finances": { schema: 1, revision: "synthetic-finance", data: null, decisions: {}, imports: [], decisionHistory: [] }, "/groceries/planning": emptyPlan(), "/groceries": { schema: 1, revision: "synthetic-purchases", records: [] }, "/mortgage": emptyMortgage() };
    const original = JSON.stringify(sources), state = { requests: [], mode: "normal", gate: null };
    if (paired) await context.addInitScript(endpoint => localStorage.setItem("familyhub.worker.v1", JSON.stringify({ Endpoint: endpoint, ApiKey: "synthetic-only" })), api);
    await context.route("**/*", async route => {
      const req = route.request(), url = new URL(req.url()); if (url.origin === new URL(base).origin) return route.continue();
      if (url.origin !== api) { external.push(url.origin); return route.abort(); }
      const reply = (body, status = 200) => route.fulfill({ status, json: body });
      if (req.method() === "OPTIONS") return reply({});
      if (url.pathname === "/opportunity-actions") {
        if (req.method() === "GET") return reply(await actions.read());
        assert.equal(req.method(), "POST"); state.requests.push(req.postDataJSON());
        if (state.gate) await state.gate;
        if (state.mode === "reject") return reply({ error: "Synthetic conflict" }, 409);
        const result = await actions.mutate(req.postDataJSON(), now);
        if (state.mode === "lost") return route.abort("failed");
        return reply(result);
      }
      assert.equal(req.method(), "GET", "No source/financial/push/research mutation allowed");
      if (url.pathname === "/health") return reply({ status: "ok", version: "synthetic", capabilities: [] });
      if (url.pathname === "/notifications") return reply({ schema: 1, revision: "synthetic", events: [], preferences: {}, devices: [], sourceErrors: [], scannedAt: null, pushConfigured: false, publicKey: null });
      return reply(sources[url.pathname] ?? {}, sources[url.pathname] ? 200 : 404);
    });
    const open = async () => {
      await page.goto(base); await page.locator('.today-priorities [data-domain="insurance"]').waitFor();
      await page.locator('.today-priorities [data-domain="insurance"]').getByRole("button", { name: /^Sources and options/ }).click();
      return page.locator("dialog[open]");
    };
    return { page, context, actions, state, sources, original, open };
  }
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.FAMILYHUB_TEST_BROWSER_CHANNEL || undefined });
    for (const width of [320, 360, 384, 390, 412, 768, 1280, 1440]) {
      const f = await setup(width, "normal"), { page } = f, dialog = await f.open();
      const short = dialog.getByRole("button", { name: "Snooze for 1 hour", exact: true }), long = dialog.getByRole("button", { name: "Snooze for 7 days", exact: true });
      await dialog.getByText(/A 7-day snooze returns after the deadline of/).waitFor(); await short.scrollIntoViewIfNeeded();
      for (const button of [short, long]) {
        const description = await button.evaluate(el => document.getElementById(el.getAttribute("aria-describedby"))?.textContent);
        assert.match(description ?? "", /A 7-day snooze returns after the deadline/);
      }
      await dialog.getByRole("button", { name: /^Close / }).focus(); await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); assert.equal(await short.evaluate(el => document.activeElement === el), true); const focus = await short.evaluate(el => ({ outline: getComputedStyle(el).outlineStyle, width: getComputedStyle(el).outlineWidth })); assert.notEqual(focus.outline, "none"); assert.notEqual(focus.width, "0px");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      for (const button of [short, long]) { const box = await button.boundingBox(); assert(box.width >= 48 && box.height >= 48); }
      const warningPair = await dialog.locator(".app-notice.warning").evaluate(el => ({ color:getComputedStyle(el).color, background:getComputedStyle(el).backgroundColor, fontSize:getComputedStyle(el.querySelector("span")).fontSize, lineHeight:getComputedStyle(el.querySelector("span")).lineHeight }));
      const luminance = rgb => rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((v,n,i)=>v+n*[.2126,.7152,.0722][i],0);
      const foreground=luminance(warningPair.color),background=luminance(warningPair.background),contrast=(Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05); assert(contrast>=4.5);
      cases.push({width,warningPair,contrast});
      await page.screenshot({ path: join(output, `after-${width}.png`), fullPage: false });
      let release; f.state.gate = new Promise(done => { release = done; }); await short.dblclick();
      await dialog.getByText(/Saving to your PC/).waitFor(); assert.equal(await long.isDisabled(), true); assert.equal(f.state.requests.length, 1);
      release(); await page.getByText(/Snoozed for 1 hour/).waitFor();
      const saved = Object.values((await f.actions.read()).decisions)[0]; assert.equal(saved.snoozedUntil, "2026-11-18T21:00:00.000Z"); assert.equal((await f.actions.read()).history.length, 1);
      assert.deepEqual(saved.context, { kind: "insurance-renewal", recordId: "synthetic-policy", dueDate: "2026-11-20" });
      assert.equal(await page.locator('.today-priorities [data-domain="insurance"]').count(), 0);
      await page.reload(); await page.getByRole("button", { name: /^Managed items/ }).click();
      const managed = page.locator('.opportunity-managed[data-domain="insurance"]'); await managed.waitFor(); const expectedReturn = await page.evaluate(iso => new Intl.DateTimeFormat("en-CA", {day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(iso)), saved.snoozedUntil); assert.equal(await managed.locator(".opportunity-status").innerText(), "Snoozed"); await managed.getByText("Returns: " + expectedReturn, {exact:true}).waitFor(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await managed.scrollIntoViewIfNeeded(); await page.screenshot({path:join(output,`managed-${width}.png`),fullPage:false});
      await managed.getByRole("button", { name: /^Sources and options/ }).click(); await page.getByRole("button", { name: "Restore to my actions", exact: true }).click(); await page.locator('.today-priorities [data-domain="insurance"]').waitFor();
      assert.equal(JSON.stringify(f.sources), f.original); assert.equal(Object.keys((await f.actions.read()).decisions).length, 0); await f.context.close();
      const failure = await setup(width, "failure"), bad = await failure.open(); failure.state.mode = "reject";
      await bad.getByRole("button", { name: "Snooze for 1 hour", exact: true }).click(); await bad.getByRole("alert").waitFor(); assert.equal((await failure.actions.read()).history.length, 0); assert.equal(failure.state.requests.length, 1);
      await bad.getByRole("alert").scrollIntoViewIfNeeded(); await failure.page.screenshot({ path: join(output, `error-${width}.png`), fullPage: false });
      await failure.page.keyboard.press("Escape"); assert.equal(await failure.page.evaluate(() => document.activeElement?.getAttribute("aria-label")?.startsWith("Sources and options")), true);
      await failure.context.close();
      const unknown = await setup(width, "unknown", null), missing = await unknown.open(); await missing.getByText("Unknown", { exact: true }).waitFor(); assert.equal(await missing.locator(".app-notice.warning").count(), 0); await missing.getByRole("button", { name: "Snooze for 1 hour", exact: true }).scrollIntoViewIfNeeded(); await unknown.page.screenshot({ path: join(output, `unknown-${width}.png`), fullPage: false }); await unknown.context.close();
      const empty = await setup(width, "unpaired", null, false); await empty.page.goto(base); await empty.page.getByRole("heading", { name: "Find your priorities", exact: true }).waitFor(); assert.equal(empty.state.requests.length, 0); await empty.page.screenshot({ path: join(output, `empty-${width}.png`), fullPage: false }); await empty.context.close();
      cases.push({ width, normal: true, shortPersisted: true, noDoubleWrite: true, restore: true, errorRetained: true, unknown: true, unpaired: true, sourceUnchanged: true });
    }
    for (const [key, due, pattern] of [["today", "2026-11-18", /This deadline is today/], ["past", "2026-11-17", /This deadline has passed/], ["distant", "2026-12-18", null]]) {
      const f = await setup(390, key, due, true, "UTC"), d = await f.open();
      if (pattern) await d.getByText(pattern).waitFor(); else assert.equal(await d.locator(".app-notice.warning").count(), 0); assert.equal(f.state.requests.length, 0); await f.context.close();
    }
    const onDeadline = await setup(390, "week-boundary", "2026-11-25");
    const onDeadlineDialog = await onDeadline.open();
    await onDeadlineDialog.getByText(/A 7-day snooze returns on the deadline/).waitFor();
    await onDeadlineDialog.getByRole("button", { name: "Snooze for 7 days", exact: true }).click();
    await onDeadline.page.getByText(/Snoozed for 7 days/).waitFor();
    const [weekDecision] = Object.values((await onDeadline.actions.read()).decisions);
    assert.equal(weekDecision.snoozedUntil, "2026-11-25T20:00:00.000Z");
    assert.equal(onDeadline.state.requests.length, 1);
    await onDeadline.context.close();
    const near = await setup(390, "midnight", "2026-11-19");
    const late = await near.page.evaluate(() => new Date(2026,10,18,23,30).toISOString());
    await near.page.clock.setFixedTime(new Date(late)); const nearDialog = await near.open();
    await nearDialog.getByText(/A one-hour snooze returns on the deadline/).waitFor(); assert.equal(near.state.requests.length,0); await near.context.close();
    const lost = await setup(390, "lost"), d = await lost.open(); lost.state.mode = "lost"; await d.getByRole("button", { name: "Snooze for 1 hour", exact: true }).click(); await d.getByRole("alert").waitFor(); assert.equal(lost.state.requests.length, 1); assert.equal((await lost.actions.read()).history.length, 1); await lost.page.keyboard.press("Escape"); await lost.page.getByRole("button", { name: "Refresh priorities", exact: true }).click(); await lost.page.getByRole("button", { name: /^Managed items/ }).waitFor(); assert.equal(await lost.page.locator('.today-priorities [data-domain="insurance"]').count(), 0); assert.equal(lost.state.requests.length, 1); await lost.context.close();
    assert.deepEqual(errors, []); assert.deepEqual(external, []); await writeFile(join(output, "acceptance.json"), JSON.stringify({ cases, deadlineStates: true, lostAcknowledgementReadback: true, errors, external, syntheticOnly: true }, null, 2));
    console.log("PASS Today snooze: eight widths, known/unknown/near/past dates, short return/time, persistence/restore, double activation, failed/lost acknowledgements, keyboard, empty and immutable sources; synthetic only.");
  } finally {
    await browser?.close(); await new Promise(done => server.close(done));
    if (!resolve(temporary).startsWith(resolve(tmpdir()) + sep)) throw Error("Unsafe temporary cleanup"); await rm(temporary, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await verifyTodaySnooze();
