import test from "node:test";
import assert from "node:assert/strict";
import { trendsFixture } from "./finance-trends-fixture.mjs";
import { parseFinancePreparation } from "../apps/worker/src/finance-import";
import { type FinanceState } from "../apps/worker/src/finance-model";
import { spendingTrend, shiftMonth, monthEnd } from "../apps/web/src/finance-trends";

const state = (): FinanceState => {
    const { bundle, decisions } = trendsFixture();
    return { schema: 1, revision: "test", importedAt: "2026-10-10", data: parseFinancePreparation(bundle), decisions, decisionHistory: [], imports: [] };
};
const trend = (s: FinanceState, month = "2026-10", account = "", currency = "CAD", today = "2026-10-10") => spendingTrend(s, month, account, currency, today);

test("personal baseline uses six prior complete months, net refunds and identical elapsed days", () => {
    const s = state(), before = JSON.stringify(s), t = trend(s);
    assert.equal(t.to, "2026-10-09"); assert.equal(t.partial, true);
    assert.equal(t.actualCents, 78000); assert.equal(t.baselineCents, 71500);
    assert.deepEqual(t.qualifiedMonths, ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    assert.equal(t.daily.length, 9); assert.equal(t.daily.at(-1)?.baselineCents, 71500);
    assert.equal(t.daily.at(-1)?.actualCents, 78000);
    assert.equal(t.categories.find(c => c.key === "groceries")?.baselineCents, 11500);
    assert.equal(t.categories.some(c => c.key === "restaurants"), false, "Later historical meals do not enter a partial-month baseline");
    const complete = trend(s, "2026-09");
    assert.equal(complete.partial, false); assert.equal(complete.actualCents, 79000); assert.equal(complete.baselineCents, 76000);
    assert.equal(complete.daily[29].actualCents, 79000); assert.equal(complete.daily[30].actualCents, null);
    assert.equal(complete.daily.at(-1)?.baselineCents, complete.baselineCents);
    assert.equal(JSON.stringify(s), before);
});

test("each settlement leg, pending, confirmed duplicates and investment flow is independently excluded", () => {
    const s = state(), row = s.data!.transactions[0];
    s.data!.transactions.push({ ...row, id: "pending", date: "2026-10-08", status: "pending", outflowCents: 900000 });
    s.data!.transactions.push(...["duplicate", "investment", "review"].map(nature => ({ ...row, id: nature, date: "2026-10-03", outflowCents: 900000 })));
    for (const nature of ["duplicate", "investment", "review"] as const) s.decisions[nature] = { nature, category: nature === "investment" ? "savings-investments" : "groceries", note: "Synthetic decision", updatedAt: "" };
    assert.equal(trend(s).actualCents, 78000);
    assert.equal(trend(s, "2026-10", "card").actualCents, 18000);
    assert.equal(trend(s, "2026-10", "bank").actualCents, 60000);
    assert.equal(trend(s).pendingRows.length, 1); assert.equal(trend(s).pendingCount, 2);
});

test("missing account coverage blocks a household baseline without inventing zeros", () => {
    const s = state();
    s.data!.accounts.push({ ...s.data!.accounts[0], id: "missing", name: "Missing card", type: "credit-card" });
    assert.equal(trend(s).baselineCents, null); assert.equal(trend(s).actualCents, 78000);
    assert.match(trend(s).reasons.join(" "), /Missing card/);
    assert.equal(trend(s, "2026-10", "missing").actualCents, null);
    assert.equal(trend(s, "2026-10", "card").baselineCents, 11500);
    assert.equal(trend(s, "2026-10", "", "USD").baselineCents, null);
    assert.equal(trend(s, "2026-10", "card", "USD").actualCents, null);
    s.data!.coverage.find(c => c.accountId === "card")!.latest = "2026-08-24";
    assert.equal(trend(s, "2026-10", "card").baselineCents, null);
});

test("at least three bounded months are required and disconnected intervals do not bridge gaps", () => {
    const s = state();
    s.data!.coverage.find(c => c.accountId === "card")!.earliest = "2026-07-01";
    assert.equal(trend(s).qualifiedMonths.length, 3); assert.equal(trend(s).baselineReady, true);
    s.data!.coverage.find(c => c.accountId === "card")!.earliest = "2026-07-02";
    assert.equal(trend(s).qualifiedMonths.length, 2); assert.equal(trend(s).baselineCents, null);
    s.data!.coverage = s.data!.coverage.filter(c => c.accountId !== "card");
    s.data!.coverage.push({ accountId: "card", earliest: "2026-03-01", latest: "2026-06-15", warning: null }, { accountId: "card", earliest: "2026-06-17", latest: "2026-10-09", warning: null });
    assert.equal(trend(s).qualifiedMonths.includes("2026-06"), false);
});

test("a separately covered currency uses its own accounts and amounts without conversion", () => {
    const s = state(), original = trend(s);
    s.data!.accounts.push({ ...s.data!.accounts[0], id: "usd", name: "Synthetic USD", currency: "USD" });
    s.data!.coverage.push({ accountId: "usd", earliest: "2026-03-01", latest: "2026-10-09", warning: null });
    const source = s.data!.transactions[0];
    for (const month of ["04", "05", "06", "07", "08", "09", "10"]) {
        const id = "usd-" + month;
        s.data!.transactions.push({ ...source, id, accountId: "usd", currency: "USD", date: `2026-${month}-05`, outflowCents: 1234 });
        s.decisions[id] = { nature: "expense", category: "groceries", note: "Synthetic USD", updatedAt: "" };
    }
    assert.equal(trend(s).actualCents, original.actualCents); assert.equal(trend(s).baselineCents, original.baselineCents);
    assert.equal(trend(s, "2026-10", "", "USD").actualCents, 1234); assert.equal(trend(s, "2026-10", "", "USD").baselineCents, 1234);
});

test("no target or future data leaks into typical spending; collection and today bound partial days", () => {
    const s = state(), original = trend(s).baselineCents;
    s.data!.transactions.push({ ...s.data!.transactions[0], id: "future", date: "2026-10-20", outflowCents: 999999 });
    assert.equal(trend(s).actualCents, 78000); assert.equal(trend(s).baselineCents, original);
    const future = trend(s, "2026-11");
    assert.equal(future.actualCents, null); assert.equal(future.baselineCents, null); assert.equal(future.daily.length, 0);
    const early = trend(s, "2026-10", "", "CAD", "2026-10-06");
    assert.equal(early.to, "2026-10-06"); assert.equal(early.actualCents, 80000); assert.equal(early.baselineCents, 72500);
    s.data!.collectedOn = "2026-10-04";
    assert.equal(trend(s).to, "2026-10-04"); assert.equal(trend(s).actualCents, 60000);
});

test("eligible zero and net-negative months remain valid amounts, not missing history or ratios", () => {
    const s = state();
    s.data!.transactions = [];
    assert.equal(trend(s).actualCents, 0); assert.equal(trend(s).baselineCents, 0);
    const original = state(); s.data!.transactions = [original.data!.transactions.find(r => r.id === "oct-refund")!];
    assert.equal(trend(s).actualCents, -2000); assert.equal(trend(s).baselineCents, 0);
    assert.equal(trend(s).daily.at(-1)?.actualCents, -2000);
    s.data!.coverage = [];
    assert.equal(trend(s).actualCents, -2000); assert.equal(trend(s).baselineCents, null);
});

test("explicit source decisions change category comparisons without changing ledger facts", () => {
    const s = state(), before = JSON.stringify(s.data), old = trend(s);
    s.decisions["oct-food"].category = "restaurants";
    s.decisions["2026-04-food"].category = "restaurants";
    const t = trend(s);
    assert.equal(t.actualCents, old.actualCents); assert.equal(t.baselineCents, old.baselineCents);
    assert.equal(t.categories.find(c => c.key === "restaurants")?.actualCents, 20000);
    assert.equal(t.categories.find(c => c.key === "restaurants")?.baselineCents, 10000 / 6);
    assert.equal(JSON.stringify(s.data), before);
});

test("month boundaries respect leap years, year changes and a shorter baseline month", () => {
    assert.equal(shiftMonth("2026-01", -1), "2025-12"); assert.equal(monthEnd("2024-02"), "2024-02-29"); assert.equal(monthEnd("2025-02"), "2025-02-28");
    const s = state(); s.data!.scope = { from: "2025-09-01", to: "2026-03-30" }; s.data!.collectedOn = "2026-03-30";
    s.data!.coverage = s.data!.accounts.map(a => ({ accountId: a.id, earliest: "2025-09-01", latest: "2026-03-30", warning: null }));
    const t = trend(s, "2026-03");
    assert.equal(t.partial, true); assert.equal(t.qualifiedMonths.length, 5);
    assert.equal(t.qualifiedMonths.includes("2026-02"), false); assert.match(t.candidates.at(-1)!.reasons.join(" "), /court/);
    assert.throws(() => trend(s, "invalid"), /Mois invalide/);
});
