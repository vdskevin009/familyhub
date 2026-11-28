/** Synthetic browser acceptance for contribution goals; never accesses bank or worker data. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join, extname, sep } from "node:path";
import { once } from "node:events";
import { contributionRingFixture } from "./contribution-ring-fixtures.mjs";

const root = resolve(process.env.FAMILYHUB_BROWSER_DIST || "apps/web/dist");
const output = resolve("output/playwright/" + (process.env.CONTRIBUTIONS_TEST_THEME_CSS ? "contribution-goals-dark-token-check" : "contribution-goals"));
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const file = resolve(root, "." + pathname.replace(/^\/familyhub/, ""));
  if (!pathname.startsWith("/familyhub/") || (file !== root && !file.startsWith(root + sep))) return res.writeHead(403).end();
  try {
    const bytes = await readFile(file === root || pathname.endsWith("/") ? join(root, "index.html") : file);
    res.setHeader("Content-Type", ({ ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" })[extname(file)] || "text/html");
    res.end(bytes);
  } catch { res.writeHead(404).end(); }
});
server.listen(0, "127.0.0.1"); await once(server, "listening");
const origin = "http://127.0.0.1:" + server.address().port;
const base = origin + "/familyhub/";
const fake = "https://synthetic-worker.invalid";
let browser;
const measurements = [];
try {
  browser = await chromium.launch({ headless: true, channel: process.env.FAMILYHUB_TEST_BROWSER_CHANNEL || (process.platform === "win32" ? "chrome" : undefined) });
  const matrix = [[320, "no-preference"], [390, "no-preference"], [390, "reduce"], [768, "no-preference"], [1440, "no-preference"]];
  for (const [width, motion] of matrix) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, locale: width === 390 && motion === "reduce" ? "en-CA" : "fr-CA", serviceWorkers: "block", reducedMotion: motion });
    const page = await context.newPage(), errors = [], allWrites = [], unexpected = [];
    page.setDefaultTimeout(9000); page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript(endpoint => localStorage.setItem("familyhub.worker.v1", JSON.stringify({ Endpoint: endpoint, ApiKey: "fixture-only" })), fake);
    let mode = "ready";
    let releaseRequest;
    const requested = [];
    await context.route("**/*", async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin === origin) return route.continue();
      if (url.origin !== fake) { unexpected.push(url.hostname); return route.abort(); }
      const headers = { "access-control-allow-origin": origin, "access-control-allow-methods": "GET, OPTIONS", "access-control-allow-headers": "x-familyhub-key" };
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
      if (req.method() !== "GET") { allWrites.push(req.method() + ":" + url.pathname); return route.abort(); }
      if (url.pathname === "/health") return route.fulfill({ json: { status: "ok", capabilities: [] }, headers });
      if (url.pathname === "/finances") return route.fulfill({ json: { schema: 1, revision: "empty", data: null, imports: [], decisions: {}, decisionHistory: [] }, headers });
      if (url.pathname !== "/contributions/progress") return route.fulfill({ json: { items: [], records: [], jobs: [], state: "idle" }, headers });
      requested.push(mode);
      if (releaseRequest) await releaseRequest;
      const fixture = contributionRingFixture(mode);
      // Simulate an unchanged older worker serving its known French display rationale.
      if (mode === "ready") fixture.plans[0].inferredPayments[0].rationale = "Même référence de destination que des virements antérieurs explicitement attribués. Réception bancaire non vérifiée.";
      return route.fulfill({ status: mode === "offline" ? 503 : 200, json: fixture, headers });
    });
    const rrsp = page.locator(".contribution-card").first(), resp = page.locator(".contribution-card").last();
    const rings = page.locator("[data-contribution-ring]");
    const neutralRings = page.locator("[data-contribution-unconfirmed]");
    const refresh = page.getByRole("button", { name: "Refresh contributions", exact: true });
    const show = page.getByRole("button", { name: "View RRSP contributions", exact: true });
    const progress = rrsp.getByRole("progressbar");
    const dialog = page.getByRole("dialog");
    const reload = async state => {
      mode = state;
      const response = page.waitForResponse(res => res.request().method() === "GET" && res.url() === fake + "/contributions/progress");
      await refresh.click();
      await response;
      await page.waitForFunction(() => document.querySelector(".contributions-view button[aria-disabled]")?.getAttribute("aria-disabled") === "false");
    };
    const words = locator => locator.innerText().then(content => content.replace(/\s+/g, " "));
    await page.goto(base + "?view=contributions");
    await show.waitFor();
    assert.equal(await page.locator("html").getAttribute("lang"), "en-CA", "System/browsing language must not override the product language");
    assert.equal(await page.getByRole("heading", { name: "RRSP", exact: true }).count(), 1);
    assert.equal(await page.getByRole("heading", { name: "RESP", exact: true }).count(), 1);
    if (process.env.CONTRIBUTIONS_TEST_FONT) await page.addStyleTag({ content: "body { font-family: " + process.env.CONTRIBUTIONS_TEST_FONT + " !important; }" });
    if (process.env.CONTRIBUTIONS_TEST_THEME_CSS) {
      await page.addStyleTag({ path: process.env.CONTRIBUTIONS_TEST_THEME_CSS });
      await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
    }
    assert.equal(await rings.count(), 2);
    assert.equal(await neutralRings.count(), 0);
    assert.equal(await progress.getAttribute("value"), "37.5");
    assert.equal(await progress.getAttribute("aria-label"), "RRSP: progress toward your personal goal");
    assert.match(await progress.getAttribute("aria-valuetext"), /^37\.5% of goal\./);
    assert.match(await words(rrsp), /\$1,500\.00.+\$4,000\.00.+\$2,500\.00/);
    assert.match(await words(resp), /40\s*%/);
    assert.equal(await rrsp.locator("time").count(), 0, "History remains in the detail sheet");
    assert.doesNotMatch(await words(rrsp), /\$123\.45|\$400\.00/);
    assert.equal(await rrsp.locator("[data-ring-fill]").evaluate(el => el.getAnimations().length), 0, "No fake initial animation from zero");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const contrast = await rrsp.evaluate(el => {
      const text = getComputedStyle(el.querySelector(".contribution-ring-number"));
      const card = getComputedStyle(el);
      const fill = getComputedStyle(el.querySelector("[data-ring-fill]"));
      const track = getComputedStyle(el.querySelector(".contribution-ring-track"));
      const l = value => value.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => { const x = n / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }).reduce((n, x, i) => n + x * [.2126, .7152, .0722][i], 0);
      const ratio = (a,b) => (Math.max(l(a),l(b)) + .05) / (Math.min(l(a),l(b)) + .05);
      return { centre: ratio(text.color, card.backgroundColor), arc: ratio(fill.stroke, track.stroke) };
    });
    assert.ok(contrast.centre >= 4.5);
    assert.ok(contrast.arc >= 3);
    const geometry = await page.locator(".contribution-cards").evaluate(el => ({
      height: Math.round(el.getBoundingClientRect().height),
      detailActionBottoms: [...el.querySelectorAll(".contribution-open")].map(button => Math.round(button.getBoundingClientRect().bottom))
    }));
    if (motion === "no-preference") await page.screenshot({ path: resolve(output, "goals-" + width + ".png") });
    await show.focus(); await page.keyboard.press("Enter");
    await dialog.waitFor();
    assert.equal(await dialog.getByRole("heading", { name: "Completed weekly contributions", exact: true }).count(), 1);
    assert.equal(await dialog.getByRole("heading", { name: "One-time contributions", exact: true }).count(), 1);
    assert.equal(await dialog.getByRole("heading", { name: /Inferred allocation/ }).count(), 1);
    assert.ok(await dialog.getByText("The destination reference matches earlier transfers with confirmed allocation. Bank receipt has not been verified.", { exact: true }).isVisible());
    assert.ok(await dialog.getByText(/The bank has not confirmed receipt/).isVisible());
    assert.equal(await dialog.getByRole("heading", { name: "Excluded, unallocated transfers", exact: true }).count(), 1);
    assert.match(await words(dialog), /\$400\.00.+do not count toward progress or the goal/i);
    assert.match(await words(dialog), /\$2,100\.00/);
    for (const key of ["Tab", "Shift+Tab", "Tab", "Tab"]) {
      await page.keyboard.press(key); assert.ok(await dialog.evaluate(el => el.contains(document.activeElement)));
    }
    await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
    assert.ok(await show.evaluate(el => el === document.activeElement));

    await page.evaluate(() => {
      window.observedRingMotion = [];
      document.addEventListener("animationstart", event => {
        if (event.target.matches("[data-ring-fill]")) window.observedRingMotion.push(event.animationName);
      });
    });
    mode = "increase";
    let resolveRequest;
    releaseRequest = new Promise(resolve => { resolveRequest = resolve; });
    await refresh.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-disabled") === "true");
    await page.keyboard.press("Enter");
    resolveRequest(); releaseRequest = null;
    await page.waitForFunction(() => document.querySelector(".contribution-card progress")?.value === 40);
    assert.ok(await refresh.evaluate(el => el === document.activeElement));
    assert.equal(requested.filter(x => x === "increase").length, 1, "Pending refresh blocks a second Enter without dropping focus");
    if (motion === "no-preference") await page.waitForFunction(() => window.observedRingMotion.length > 0);
    else {
      assert.equal(await rrsp.locator("[data-ring-fill]").evaluate(el => el.getAnimations().length), 0);
      assert.deepEqual(await page.evaluate(() => window.observedRingMotion), []);
    }
    const countAtChange = await page.evaluate(() => window.observedRingMotion.length);
    assert.equal(countAtChange, motion === "reduce" ? 0 : 1);
    await reload("increase");
    await page.waitForFunction(() => document.querySelector(".contribution-card progress")?.value === 40);
    assert.equal(await rrsp.locator("[data-ring-fill]").evaluate(el => el.getAnimations().length), 0, "Equal authoritative refresh is not animated");

    if (width === 390) {
      for (const [state, label] of [["verified-zero", /^0\s*%/], ["tiny-real", /^<\s*0\.01\s*%/], ["near-target", /^<\s*100\s*%/], ["at-target", /^100\s*%/], ["near-over", /^>\s*100\s*%/], ["exceeded", /^125\s*%/]]) {
        await reload(state);
        await page.waitForFunction(re => new RegExp(re).test(document.querySelector(".contribution-card progress")?.getAttribute("aria-valuetext") || ""), label.source);
        assert.match(await progress.getAttribute("aria-valuetext"), label);
        if (state === "near-target") assert.doesNotMatch(await words(rrsp), /Goal reached|Goal exceeded/);
        if (state === "at-target") assert.match(await words(rrsp), /Goal reached/);
        if (state === "exceeded") {
          assert.equal(await progress.getAttribute("value"), "100", "The ring saturates, while the text still reports 125%");
          assert.match(await words(rrsp), /Goal exceeded/);
        }
        if (state === "verified-zero") {
          assert.match(await words(rrsp), /\$0\.00/);
          assert.equal(await progress.getAttribute("value"), "0");
          assert.equal(await neutralRings.count(), 0, "Verified zero has the regular solid ring and numeric semantics");
          assert.equal(await rrsp.locator(".contribution-ring-track").evaluate(el => getComputedStyle(el).strokeDasharray), "none");
        }
      }
    }
    for (const [state, count, title, neutralCount] of [
      ["partial", 0, "Partial data", 2], ["legacy-authority", 0, "Partial data", 1],
      ["unconfirmed", 0, "Allocation needs confirmation", 2], ["missing-evidence", 0, "Partial data", 2], ["future-evidence", 0, "Partial data", 2],
      ["source-unavailable", 1, "Financial source unavailable", 0], ["no-goal", 0, "Private goal not configured", 0],
      ["malformed", 0, "Data unavailable", 0], ["offline", 0, "Data unavailable", 0],
    ]) {
      await reload(state);
      await rrsp.getByText(title, { exact: state !== "unconfirmed" && title !== "Partial data" }).first().waitFor();
      assert.equal(await rings.count(), count, state);
      assert.equal(await neutralRings.count(), neutralCount, state + ": only a configured plan with usable but unconfirmed evidence gets a dashed state");
      assert.equal(await progress.count(), 0, state + " must not masquerade as zero");
      assert.equal(await rrsp.locator("[data-ring-fill]").count(), 0, state + ": no coloured progress implied");
      assert.doesNotMatch(await words(rrsp), /Goal reached|Goal exceeded|Amount remaining/, state);
      if (state === "legacy-authority" && width === 390 && motion === "no-preference") {
        await page.screenshot({ path: resolve(output, "current-worker-partial-390.png") });
        await show.click(); await dialog.waitFor();
        assert.match(await words(dialog), /The amount remaining cannot be confirmed/);
        assert.doesNotMatch(await words(dialog), /\$2,100\.00 after forecast weekly contributions/);
        await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
      }
    }
    await reload("ready");
    await show.waitFor(); assert.equal(await rings.count(), 2);
    assert.equal(await rrsp.locator("[data-ring-fill]").evaluate(el => el.getAnimations().length), 0, "A lost/unknown source invalidates the animation baseline");
    const more = page.getByRole("button", { name: "More", exact: true }); await more.last().click();
    await page.getByRole("button", { name: "Finances", exact: true }).last().click();
    await page.getByRole("button", { name: "Contributions", exact: true }).click(); await show.waitFor();
    await page.goBack(); await page.getByRole("heading", { name: "More", exact: true }).waitFor();
    await page.goForward(); await page.getByRole("button", { name: "Contributions", exact: true }).click(); await show.waitFor();
    assert.deepEqual(errors, []); assert.deepEqual(allWrites, []); assert.deepEqual(unexpected, []);
    measurements.push({ width, motion, locale: width === 390 && motion === "reduce" ? "en-CA" : "fr-CA", contrast, geometry, countAtChange, workerRequests: requested.length, writes: allWrites.length });
    await context.close();
    console.log("PASS", width, motion, "goal ring states, actuals/history, contrast, focus and refresh animation");
  }
  await writeFile(resolve(output, "report.json"), JSON.stringify({ browser: browser.version(), measurements }, null, 2));
} finally { await browser?.close(); server.close(); }
