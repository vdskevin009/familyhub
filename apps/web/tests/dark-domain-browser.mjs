/** Built PWA with synthetic contributions and property data. No account data or external requests. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";
import { contrastRatio as ratio } from "./theme-test-colour.mjs";

const dist = resolve(process.env.FAMILYHUB_BROWSER_DIST || "apps/web/dist");
const output = resolve("output/playwright/dark-domain");
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  const relative = path.replace(/^\/familyhub\//, "");
  const file = resolve(dist, relative || "index.html");
  if (!path.startsWith("/familyhub/") || !file.startsWith(dist + sep)) return res.writeHead(404).end();
  try {
    const content = await readFile(file);
    res.setHeader("content-type", (({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" })[extname(file)] || "application/octet-stream"));
    res.end(content);
  } catch { res.writeHead(404).end(); }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");

const origin = "http://127.0.0.1:" + server.address().port;
const worker = "https://synthetic-dark.invalid";
const entry = origin + "/familyhub/";
const date = "2030-01-04T12:00:00Z";
const plan = {
  id: "test-rrsp", kind: "rrsp", currency: "CAD", deadline: "2030-12-31",
  personalGoalCents: 520000, identifiedCents: 260000, attribution: "confirmed", status: "complete",
  beneficiaryConfirmed: false, sourceFreshness: "dated", sourceAsOf: date, retrievedAt: date,
  payments: [{ id: "rrsp-demo-1", date: "2030-01-04", amountCents: 260000, kind: "one-off" }],
  weeklyProjection: null, unassigned: [], warnings: [],
};
const fund = {
  schema: 1, evaluatedOn: "2030-01-04", daysPerMonth: 30,
  plans: [plan, { ...plan, id: "test-resp", kind: "resp", personalGoalCents: 150000, identifiedCents: 0, payments: [], status: "partial", sourceFreshness: "unknown", sourceAsOf: null, warnings: ["source-unavailable"] }],
};
const fact = value => ({ value, sourceUrl: value === null ? null : "https://example.com/fictional", checkedAt: value === null ? null : date, note: "Synthetic source" });
const property = {
  id: "synthetic-place", listingId: "synthetic-place", observedAt: date,
  address: "Synthetic home", url: "https://example.com/fictional", status: "active",
  statusEvidence: fact("active"), priceCad: fact(1450000), bedrooms: fact(4),
  lowerLonsdale: fact(true), separateEntrances: fact(null), airbnb: { status: "unknown", evidence: [] },
  followed: false, changes: [],
};
const results = [], errors = [], writes = [], outbound = [];
const readRingColors = card => card.evaluate(el => ({
  ink: getComputedStyle(el.querySelector(".contribution-ring-number")).color,
  card: getComputedStyle(el).backgroundColor,
  track: getComputedStyle(el.querySelector(".contribution-ring-track")).stroke,
  fill: getComputedStyle(el.querySelector("[data-ring-fill]")).stroke,
  canvas: getComputedStyle(document.body).backgroundColor,
}));
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.FAMILYHUB_TEST_BROWSER_CHANNEL || undefined });
  for (const width of [320, 390, 1440]) {
    for (const scheme of ["light", "dark"]) {
      const context = await browser.newContext({ viewport: { width, height: 850 }, colorScheme: "light", serviceWorkers: "block", reducedMotion: "reduce" });
      let availability = "ready";
      await context.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === origin) return route.continue();
        if (url.origin !== worker) { outbound.push(url.hostname); return route.abort(); }
        const headers = { "access-control-allow-origin": origin, "access-control-allow-headers": "x-familyhub-key", "access-control-allow-methods": "GET, OPTIONS" };
        if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
        if (request.method() !== "GET") { writes.push(request.method() + ":" + url.pathname); return route.abort(); }
        if (url.pathname === "/contributions/progress") return route.fulfill({ status: availability === "offline" ? 503 : 200, headers, json: fund });
        if (url.pathname === "/property-project") return route.fulfill({ status: availability === "offline" ? 503 : 200, headers, json: { cards: [property], followingRevision: 0 } });
        if (url.pathname === "/finances") return route.fulfill({ headers, json: { schema: 1, revision: "synthetic", data: null, imports: [], decisions: {}, decisionHistory: [] } });
        return route.fulfill({ headers, json: { items: [], records: [], jobs: [], state: "idle", status: "ok", capabilities: [] } });
      });
      await context.addInitScript(({ worker, scheme }) => {
        if (localStorage.getItem("familyhub.appearance.v1") === null) localStorage.setItem("familyhub.appearance.v1", scheme);
        localStorage.setItem("familyhub.worker.v1", JSON.stringify({ Endpoint: worker, ApiKey: "fixture-only" }));
      }, { worker, scheme });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on("pageerror", error => errors.push(error.message));
      const expectedCanvas = scheme === "dark" ? "rgb(16, 20, 28)" : "rgb(245, 246, 248)";
      if (scheme === "dark" && width === 390) {
        let release;
        const held = new Promise(resolve => { release = resolve; });
        await page.route("**/assets/*.js", async route => { await held; await route.continue(); });
        try {
          await page.goto(entry + "?view=contributions", { waitUntil: "commit" });
          await page.waitForFunction(() => document.documentElement.dataset.theme === "dark" && getComputedStyle(document.documentElement).backgroundColor === "rgb(16, 20, 28)");
          assert.equal(await page.locator("#root").innerText(), "", "Dark canvas paints before React, even when OS is light");
          assert.equal(await page.locator('meta[name="theme-color"]').getAttribute("content"), "#10141c");
        } finally { release(); }
      } else await page.goto(entry + "?view=contributions");
      const chart = page.getByRole("progressbar"), rrsp = page.locator(".contribution-card").first();
      const show = page.getByRole("button", { name: "View RRSP contributions", exact: true });
      await show.waitFor();
      assert.equal(await chart.count(), 1);
      assert.equal(await chart.getAttribute("value"), "50");
      await page.getByText("Financial source unavailable", { exact: true }).waitFor();
      const colors = await readRingColors(rrsp);
      assert.equal(colors.canvas, expectedCanvas);
      assert.ok(ratio(colors.ink, colors.card) >= 4.5, scheme + "/" + width + ": contributions text");
      assert.ok(ratio(colors.fill, colors.track) >= 3, scheme + "/" + width + ": graph fill against track");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (width === 390) await page.screenshot({ path: resolve(output, "contributions-" + scheme + "-390.png") });
      await show.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      const overlay = await dialog.evaluate(el => ({ ink: getComputedStyle(el).color, surface: getComputedStyle(el).backgroundColor, backdrop: getComputedStyle(el, "::backdrop").backgroundColor }));
      assert.ok(ratio(overlay.ink, overlay.surface) >= 4.5);
      assert.notEqual(overlay.backdrop, "rgba(0, 0, 0, 0)");
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      assert.ok(await show.evaluate(el => el === document.activeElement));

      if (width === 390 && scheme === "light") {
        const nav = page.locator(".bottom-nav:visible, .app-rail nav:visible");
        const theme = page.getByRole("combobox", { name: "Theme", exact: true });
        const openAppearance = async () => {
          await nav.getByRole("button", { name: "More", exact: true }).click();
          await page.getByRole("button", { name: /^Settings and tools/ }).click();
          await theme.waitFor();
        };
        await openAppearance();
        await theme.selectOption("dark");
        await page.goto(entry + "?view=contributions");
        await show.waitFor();
        assert.equal(await chart.getAttribute("value"), "50", "Persisting Dark preserves the verified ratio on reopening Contributions");
        await page.getByText("Financial source unavailable", { exact: true }).waitFor();
        const dark = await readRingColors(rrsp);
        assert.equal(dark.canvas, "rgb(16, 20, 28)");
        assert.notEqual(dark.fill, colors.fill, "The rendered SVG, not only its page background, follows the Appearance selection");
        assert.ok(ratio(dark.fill, dark.track) >= 3);

        await openAppearance();
        assert.equal(await theme.inputValue(), "dark");
        await theme.selectOption("system");
        await page.goto(entry + "?view=contributions");
        await show.waitFor();
        assert.deepEqual(await readRingColors(rrsp), colors, "System on a light OS preserves the Light palette");
        await page.emulateMedia({ colorScheme: "dark" });
        await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
        assert.deepEqual(await readRingColors(rrsp), dark);
        await page.emulateMedia({ colorScheme: "light" });
        await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
        assert.deepEqual(await readRingColors(rrsp), colors);
      }

      await page.goto(entry + "?view=property");
      const card = page.locator(".property-card").first();
      await card.waitFor();
      const propertyColors = await card.evaluate(el => ({ ink: getComputedStyle(el).color, canvas: getComputedStyle(el).backgroundColor }));
      assert.ok(ratio(propertyColors.ink, propertyColors.canvas) >= 4.5);
      await page.getByRole("button", { name: "Synthetic home", exact: true }).click();
      await dialog.waitFor();
      if (width === 390) await page.screenshot({ path: resolve(output, "property-dialog-" + scheme + "-390.png") });
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      availability = "offline";
      await page.getByRole("button", { name: "Refresh properties", exact: true }).click();
      const error = page.getByRole("alert");
      await error.waitFor();
      const errorColors = await error.evaluate(el => ({ ink: getComputedStyle(el).color, surface: getComputedStyle(el).backgroundColor }));
      assert.ok(ratio(errorColors.ink, errorColors.surface) >= 4.5);
      assert.equal(await card.count(), 1, "Offline refresh leaves the synthetic property card in place");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      results.push({ width, scheme, textContrast: ratio(colors.ink, colors.card), chartContrast: ratio(colors.fill, colors.track), contrastOfPropertyError: ratio(errorColors.ink, errorColors.surface) });
      await context.close();
      console.log("PASS", scheme, width, "contributions chart/unavailable, dialog/focus and property/offline");
    }
  }
  assert.deepEqual(errors, []); assert.deepEqual(outbound, []); assert.deepEqual(writes, []);
  await writeFile(resolve(output, "report.json"), JSON.stringify({ browser: browser.version(), results, errors, outbound, writes }, null, 2));
} finally {
  await browser?.close();
  server.close();
}
