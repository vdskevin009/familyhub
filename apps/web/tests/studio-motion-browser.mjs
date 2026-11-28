/** Browser regression for the built PWA. The paired endpoint is fully fictional and read-only. */
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";
import { emptyPlan } from "../../worker/dist/grocery-planning.js";
import { emptyMortgage } from "../../worker/dist/mortgage-model.js";
import { contributionRingFixture } from "./contribution-ring-fixtures.mjs";
import { contrastRatio } from "./theme-test-colour.mjs";

const root = resolve(process.env.FAMILYHUB_BROWSER_DIST || "apps/web/dist");
const baseline = process.env.FAMILYHUB_STUDIO_BASELINE === "1";
const output = resolve("output/playwright/studio-motion", baseline ? "before" : "after");
const release = JSON.parse(await readFile(resolve(root, "release.json"), "utf8"));
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  const file = resolve(root, path.slice("/familyhub/".length) || "index.html");
  if (!path.startsWith("/familyhub/") || !file.startsWith(root + sep)) return res.writeHead(404).end();
  try {
    const data = await readFile(file);
    res.setHeader("content-type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" })[extname(file)] || "application/octet-stream");
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = "http://127.0.0.1:" + server.address().port;
const app = origin + "/familyhub/";
const worker = "https://studio-fixture.invalid";
const errors = [], writes = [], external = [], measurements = [];
const now = new Date();
const sourceDay = now.toISOString().slice(0, 10);
const claim = { Id: "studio-fixture-claim", Member: "unknown", Provider: "Example clinic", ServiceDate: sourceDay,
  OriginalAmount: 200, ReimbursedAmount: 80, PotentialRemaining: 120, Currency: "CAD", NextInsurer: "Desjardins",
  Action: "submit-secondary", Summary: "Synthetic reimbursement", Confidence: .95, DocumentIds: [], WorkflowStatus: "open" };
const snapshot = { items: [], reconciliations: [claim], busy: false, setupRequired: false, cleanupSuggestions: [],
  importantMail: [], unmatchedReimbursements: [], ignoredUnmatchedReimbursements: [], learning: { decisions: 0, undoable: [] },
  accounts: [], progress: {}, lastSuccess: now.toISOString(), coverage: { since: sourceDay, complete: false, heldMessages: 1 } };
const responses = {
  "/invoices": snapshot,
  "/savings/contracts": { schema: 1, records: [], documents: [] },
  "/savings/research": { jobs: [], schedule: null, daily: null },
  "/finances": { schema: 1, revision: "fictional", data: null, decisions: {}, imports: [], decisionHistory: [] },
  "/groceries/planning": emptyPlan(),
  "/groceries": { schema: 1, revision: "fictional", records: [] },
  "/mortgage": emptyMortgage(),
  "/opportunity-actions": { schema: 1, revision: "fictional", decisions: {}, history: [] },
  "/notifications": { schema: 1, revision: "fictional", events: [], preferences: {}, devices: [], sourceErrors: [], scannedAt: null, pushConfigured: false, publicKey: null },
  "/health": { status: "ok", capabilities: [] },
};
const fit = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false);
const capture = (page, name) => page.screenshot({ path: resolve(output, name + ".png"), animations: "disabled" });
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.FAMILYHUB_TEST_BROWSER_CHANNEL || undefined });
  for (const [width, scheme, motion] of [
    [320, "light", "no-preference"], [390, "light", "no-preference"], [390, "dark", "no-preference"],
    [390, "dark", "reduce"], [1440, "light", "no-preference"], [1440, "dark", "reduce"],
  ]) {
    const key = [width, scheme, motion].join("-");
    const mobile = width < 760;
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: mobile, hasTouch: mobile, colorScheme: scheme, reducedMotion: motion, locale: "fr-CA", serviceWorkers: "block" });
    const activate = control => mobile ? control.tap() : control.click();
    let mode = "ready";
    await context.addInitScript(endpoint => localStorage.setItem("familyhub.worker.v1", JSON.stringify({ Endpoint: endpoint, ApiKey: "fictional-only" })), worker);
    await context.route("**/*", route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin === origin) return route.continue();
      if (url.origin !== worker) { external.push(url.hostname); return route.abort(); }
      const headers = { "access-control-allow-origin": origin, "access-control-allow-headers": "content-type,x-familyhub-key", "access-control-allow-methods": "GET, OPTIONS" };
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
      if (req.method() !== "GET") { writes.push(req.method() + " " + url.pathname); return route.abort(); }
      return route.fulfill({ headers, json: url.pathname === "/contributions/progress" ? contributionRingFixture(mode) : responses[url.pathname] ?? { items: [], records: [], status: "ok" } });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(app);
    const nav = page.getByRole("navigation", { name: width < 760 ? "Mobile navigation" : "Main navigation", exact: true });
    const primary = page.locator(".opportunity-first");
    await primary.getByRole("heading", { name: "Review this reimbursement", exact: true }).waitFor();
    await primary.getByRole("link", { name: "Check evidence", exact: true }).waitFor();
    assert.equal(await page.locator("html").getAttribute("lang"), "en-CA");
    assert.equal(await page.locator("html").getAttribute("data-theme"), scheme, "Unconfigured theme follows System");
    await page.getByRole("button", { name: /1 partial source/ }).waitFor();
    await page.getByText("Partial coverage", { exact: true }).waitFor();
    const prioritize = await page.evaluate(() => ({
      button: document.querySelector(".opportunity-first a").getBoundingClientRect().bottom,
      summary: document.querySelector(".today-benefits").getBoundingClientRect().top,
      nav: document.querySelector(".bottom-nav").getBoundingClientRect().top,
    }));
    assert.ok(prioritize.button < prioritize.summary, "An actionable item still precedes totals");
    if (width < 760) assert.ok(prioritize.button <= prioritize.nav, "The lead action is above the mobile nav");
    assert.equal(await nav.locator('[aria-current="page"]').count(), 1);
    const contrast = await primary.evaluate(el => {
      const title = el.querySelector("h3"), link = el.querySelector("a");
      return [getComputedStyle(title).color, getComputedStyle(el).backgroundColor, getComputedStyle(link).color, getComputedStyle(link).backgroundColor];
    });
    assert.ok(contrastRatio(contrast[0], contrast[1]) >= 4.5);
    assert.ok(contrastRatio(contrast[2], contrast[3]) >= 4.5);
    await fit(page);
    await capture(page, "today-" + key);

    if (!baseline && width < 760) {
      await nav.evaluate(el => {
        window.studioMotion = [];
        el.addEventListener("transitionrun", event => window.studioMotion.push([event.pseudoElement, event.propertyName]));
      });
    }
    await activate(nav.getByRole("button", { name: "Finances", exact: true }));
    await page.getByRole("heading", { name: "Finances", exact: true }).waitFor();
    assert.equal(await nav.getByRole("button", { name: "Finances", exact: true }).getAttribute("aria-current"), "page");
    if (!baseline && width < 760) {
      assert.equal(await nav.getAttribute("data-animate"), "pointer");
      if (motion === "no-preference") {
        await page.waitForFunction(() => window.studioMotion.some(([pseudo, property]) => pseudo === "::before" && property === "transform"));
        const navMove = await nav.evaluate(el => {
          const style = getComputedStyle(el, "::before");
          return { duration: parseFloat(style.transitionDuration) * 1000, property: style.transitionProperty };
        });
        assert.equal(navMove.property, "transform");
        assert.ok(navMove.duration > 0 && navMove.duration <= 220);
      } else {
        assert.equal(await nav.evaluate(el => getComputedStyle(el, "::before").transitionDuration), "0s");
        assert.deepEqual(await page.evaluate(() => window.studioMotion), []);
      }
    }

    await page.getByRole("button", { name: "Contributions", exact: true }).click();
    const rrsp = page.getByRole("article", { name: "RRSP", exact: true });
    const progress = rrsp.getByRole("progressbar");
    const show = rrsp.getByRole("button", { name: "View RRSP contributions", exact: true });
    await show.waitFor();
    assert.equal(await progress.getAttribute("value"), "37.5");
    assert.match(await rrsp.innerText(), /\$2,500\.00/);
    if (!baseline) assert.equal(await page.getByRole("button", { name: "Refresh", exact: true }).count(), 0, "Contributions does not offer a competing ledger refresh");
    assert.equal(await page.getByRole("button", { name: "Refresh contributions", exact: true }).count(), 1);
    await fit(page);
    await capture(page, "contributions-verified-" + key);

    const dialog = page.getByRole("dialog");
    await show.focus();
    await page.keyboard.press("Enter");
    await dialog.waitFor();
    if (!baseline) {
      assert.equal(await dialog.getAttribute("data-enter"), "instant");
      assert.equal(await dialog.evaluate(el => getComputedStyle(el).animationName), "none");
    }
    for (const k of ["Tab", "Shift+Tab", "Tab"]) {
      await page.keyboard.press(k);
      assert.ok(await dialog.evaluate(el => el.contains(document.activeElement)));
    }
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.ok(await show.evaluate(el => el === document.activeElement), "Keyboard close returns to its trigger");

    await activate(show);
    await dialog.waitFor();
    if (!baseline) {
      const appearance = await dialog.evaluate(el => ({ animation: getComputedStyle(el).animationName, duration: parseFloat(getComputedStyle(el).animationDuration) * 1000 }));
      assert.equal(appearance.animation, motion === "reduce" ? "none" : "sheet-enter");
      assert.ok(appearance.duration <= 235);
    }
    if (width === 390) await capture(page, "contributions-details-" + key);
    await dialog.getByRole("button", { name: /^Close / }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.ok(await show.evaluate(el => el === document.activeElement), "Pointer close returns to its trigger");

    mode = "legacy-authority";
    const refresh = page.getByRole("button", { name: "Refresh contributions", exact: true });
    await refresh.click();
    await rrsp.getByText("Partial data. Progress unconfirmed.", { exact: true }).waitFor();
    assert.equal(await progress.count(), 0);
    assert.doesNotMatch(await rrsp.innerText(), /Amount remaining|Goal reached|Goal exceeded/);
    await fit(page);
    if (width === 390) { await refresh.blur(); await capture(page, "contributions-partial-" + key); }

    await nav.getByRole("button", { name: "Today", exact: true }).focus();
    await page.keyboard.press("Enter");
    await primary.getByRole("link", { name: "Check evidence", exact: true }).waitFor();
    if (!baseline && width < 760) assert.equal(await nav.getAttribute("data-animate"), null, "Keyboard navigation snaps immediately");
    await page.goBack();
    await page.getByRole("heading", { name: "Finances", exact: true }).waitFor();
    if (!baseline && width < 760) assert.equal(await nav.getAttribute("data-animate"), null, "Back does not replay the last pointer animation");
    measurements.push({ width, scheme, motion, firstActionBottom: Math.round(prioritize.button), summaryTop: Math.round(prioritize.summary), heroTextContrast: contrastRatio(contrast[0], contrast[1]), actionTextContrast: contrastRatio(contrast[2], contrast[3]) });
    await context.close();
    console.log("PASS", key, baseline ? "baseline capture" : "action hierarchy, exact navigation, ring states, overlay/focus and motion");
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  assert.deepEqual(external, []);
  await writeFile(resolve(output, "report.json"), JSON.stringify({ release: release.revision, browser: browser.version(), measurements, errors, writes, external }, null, 2));
} finally { await browser?.close(); server.close(); }
