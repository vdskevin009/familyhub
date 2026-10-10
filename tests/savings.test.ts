import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newContract, compareOffer, publicBaseline, shortlistTotal, missingInformation, type SavingsOffer } from "../apps/worker/src/savings-model";
import { SavingsResearch, validateBaseline, validateReport, savingsPrompt } from "../apps/worker/src/savings-research";
import { effectiveContracts } from "../apps/web/src/savings";
import { BillingCycle, type SavingsState } from "../apps/web/src/types";
import { calendarPeriod, periodMode, shiftPeriod, defaultPeriod } from "../apps/web/src/finance-periods";
import { reconcilePayments, providerMatches } from "../apps/web/src/savings-payments";
import { parseFinancePreparation } from "../apps/worker/src/finance-import";
import type { FinanceState, FinanceTransaction, Nature } from "../apps/worker/src/finance-model";
import { financeFixture } from "./finance-fixture.mjs";
const paymentState = (): FinanceState => ({ schema: 1, revision: "synthetic", importedAt: null, data: { ...parseFinancePreparation(financeFixture()), transactions: [] }, decisions: {}, decisionHistory: [], imports: [] });
const payment = (id: string, description: string, date: string, outflowCents: number, extra: Partial<FinanceTransaction> = {}): FinanceTransaction => ({ id, description, date, outflowCents, accountId: "card", status: "posted", currency: "CAD", occurrence: 1, fingerprint: id, hints: [], sources: [{ name: "synthetic.csv", sha256: "a".repeat(64), record: 2 }], ...extra });
test("calendar filters navigate leap months, year boundaries and incomplete source windows", () => {
  assert.deepEqual(calendarPeriod(2024, 2), { from: "2024-02-01", to: "2024-02-29" });
  assert.deepEqual(shiftPeriod(calendarPeriod(2026, 12), 1), calendarPeriod(2027, 1));
  assert.deepEqual(shiftPeriod(calendarPeriod(2026, 1), -1), calendarPeriod(2025, 12));
  assert.deepEqual(shiftPeriod(calendarPeriod(2026), -1), calendarPeriod(2025));
  assert.equal(periodMode(calendarPeriod(2026)), "year");
  assert.equal(periodMode({ from: "2026-04-15", to: "2026-08-31" }), "custom");
  assert.deepEqual(defaultPeriod({ from: "2026-04-09", to: "2026-10-09" }), calendarPeriod(2026, 9));
  assert.deepEqual(defaultPeriod({ from: "2026-04-09", to: "2026-09-30" }), calendarPeriod(2026, 9));
  assert.deepEqual(defaultPeriod({ from: "2026-10-02", to: "2026-10-09" }), calendarPeriod(2026, 10));
});
test("paid bank amounts retain original dates, currency and evidence without uniform tax or monthly inference", () => {
  const hydro = { ...newContract("other", "hydro"), provider: "BC Hydro", price: 150, taxesIncluded: false, billing: { amount: 150, currency: "CAD", count: 59, unit: "days" as const, asOf: "2026-09-28", source: "Synthetic 59-day invoice", taxesIncluded: true } };
  const home = { ...newContract("home-insurance", "home"), provider: "TD Insurance", price: 1300, cycle: "annual" as const, taxesIncluded: false };
  const mortgage = { ...newContract("mortgage", "mortgage"), provider: "TD" };
  const s = paymentState(); s.data!.transactions = [payment("bill", "B.C. HYDRO-PAP BPY", "2026-10-05", 15000), payment("h1", "TD Ins/TD Assur INS", "2026-09-18", 12000), payment("h2", "TD Ins/TD Assur INS", "2026-08-18", 12000), payment("m", "SYNTHETIC MTG", "2026-09-20", 250000)];
  const before = JSON.stringify([hydro, home, mortgage, s]), result = reconcilePayments([hydro, home, mortgage], s, "2026-09-01", "2026-09-30");
  assert.equal(result.summaries[0].cents, null, "October debit must not be moved to September bill date");
  assert.equal(result.summaries[0].invoiceMatch?.id, "bill");
  assert.equal(result.summaries[0].referenceMonthly, 150 * 365.25 / 59 / 12);
  assert.equal(result.summaries[1].cents, 12000); assert.equal(result.summaries[1].referenceMonthly, null);
  assert.equal(result.summaries[1].repeated, true); assert.equal(result.summaries[2].cents, 250000, "No principal/interest split");
  assert.equal(result.totals.CAD.cents, 262000);
  assert.equal(result.summaries[1].rows[0].sources[0].sha256, "a".repeat(64));
  assert.equal(JSON.stringify([hydro, home, mortgage, s]), before, "Sources and manual ledger remain immutable");
  assert.equal(providerMatches(home, "TD VISA PAYMENT"), false);
  assert.equal(providerMatches({ ...home, provider: "Apple" }, "APPLE.COM/BILL"), false);
});
test("included service charges, unknown credits, duplicates and ambiguous providers stay reviewable; manual decisions win", () => {
  const c = { ...newContract("telecom", "package"), provider: "Shaw", services: [{ id: "internet", name: "Internet", pricing: "documented" as const, monthlyAmount: 70, taxesIncluded: false, source: "Synthetic terms" }, ...["Disney+", "Apple TV", "Netflix"].map(name => ({ id: name, name, pricing: "included" as const, monthlyAmount: null, taxesIncluded: null, source: "Synthetic terms" }))] };
  const s = paymentState(); s.data!.transactions = [payment("a", "SHAW SYNTHETIC", "2026-09-01", 11000), payment("refund", "SHAW REFUND", "2026-09-02", -1000), payment("duplicate", "SHAW SYNTHETIC", "2026-09-01", 11000, { duplicateCandidate: true }), payment("pending", "SHAW SYNTHETIC", "2026-09-03", 9900, { status: "pending" }), payment("included", "DISNEY PLUS", "2026-09-10", 500), payment("apple", "APPLE.COM/BILL", "2026-09-11", 800), payment("credit", "SHAW CREDIT", "2026-09-02", -900, { accountId: "bank" }), ...["transfer", "repayment", "investment", "income", "duplicate"].map((nature, i) => { const id = "manual" + i; s.decisions[id] = { nature: nature as Nature, category: "other", note: "Synthetic manual choice", updatedAt: "" }; return payment(id, "SHAW SYNTHETIC", "2026-09-05", 4500); })];
  const result = reconcilePayments([c], s, "2026-01-01", "2026-12-31");
  assert.equal(result.totals.CAD.cents, 10000, "Package debits counted once, refunds netted, services never added");
  assert.equal(result.reviews.length, 4); assert.equal(result.months.length, 12); assert.equal(result.months[9].full, false);
  assert.equal(result.summaries[0].repeated, false);
  s.decisions.duplicate = { nature: "expense", category: "communications", note: "Distinct confirmed occurrence", updatedAt: "" };
  assert.equal(reconcilePayments([c], s, "2026-09-01", "2026-09-30").totals.CAD.cents, 21000);
  const ambiguous = reconcilePayments([c, { ...c, id: "second-policy" }], s, "2026-09-01", "2026-09-30");
  assert.equal(ambiguous.totals.CAD.matched, 0); assert.ok(ambiguous.reviews.some(r => r.reason.includes("Plusieurs contrats")));
});
test("payment reconciliation separates currencies and never turns missing or unknown-tax costs into zero TTC", () => {
  const cad = { ...newContract("subscription", "cad"), provider: "Spotify", price: 15 };
  const usd = { ...newContract("subscription", "usd"), provider: "Example", billing: { amount: 200, currency: "USD", count: 1, unit: "years" as const, asOf: "2026-01-01", source: "Synthetic annual", taxesIncluded: true } };
  const s = paymentState(); s.data!.transactions = [payment("cad", "SPOTIFY TEST", "2026-09-01", 1800), payment("usd", "EXAMPLE SUB", "2026-09-01", 20000, { currency: "USD" }), payment("mismatch", "SPOTIFY USD", "2026-09-05", 1300, { currency: "USD" })];
  const r = reconcilePayments([cad, usd], s, "2026-09-01", "2026-09-30");
  assert.equal(r.totals.CAD.cents, 1800); assert.equal(r.totals.USD.cents, 20000); assert.equal(r.reviews.length, 1);
  assert.equal(r.summaries[0].referenceMonthly, null); assert.equal(Math.round(r.summaries[1].referenceMonthly! * 100), 1667);
  const empty = reconcilePayments([cad], null, "2026-09-01", "2026-09-30");
  assert.equal(empty.summaries[0].cents, null); assert.equal(empty.totals.CAD.matched, 0); assert.equal(empty.summaries[0].referenceMonthly, null);
});
const contract = () => ({ ...newContract("telecom", "synthetic-contract"), name: "Internet", provider: "TELUS", price: 100, taxesIncluded: true, cancellationFee: 40, annualLostDiscounts: 20, needs: "Same service", renewal: "2027-01-01" });
const offer = (overrides: Partial<SavingsOffer> = {}): SavingsOffer => ({
  provider: "Rogers", title: "Fictitious test offer", kind: "public-estimate", currentProvider: false,
  monthlyPrice: 60, promoMonths: 6, monthlyPriceAfterPromo: 80, upfrontFees: 10, annualLostDiscounts: 20,
  taxesIncluded: true, comparable: true, differences: [], conditions: [], checkedAt: new Date().toISOString(), validUntil: null,
  sources: [{ title: "Synthetic public source", url: "https://example.test/offer" }], liabilityLimit: null, collisionDeductible: null,
  comprehensiveDeductible: null, mortgageRate: null, termMonths: null, amortizationYears: null, rateType: "fixed", affectedContractIds: [], ...overrides
});
test("net savings include promotional expiry, fees and one total for lost discounts", () => {
  const result = compareOffer(contract(), offer(), new Date(), true);
  assert.equal(result.firstYear, 290); assert.equal(result.ongoingAnnual, 220); assert.deepEqual(result.reasons, []);
  assert.equal(compareOffer(contract(), offer({ currentProvider: true }), new Date(), true).firstYear, 290, "same provider does not silently waive commitment penalties");
});
test("unknown fees, taxes, renewal prices and invalid sources do not create numerical savings", () => {
  for (const candidate of [offer({ upfrontFees: null }), offer({ annualLostDiscounts: null }), offer({ taxesIncluded: false }), offer({ monthlyPriceAfterPromo: null }), offer({ sources: [] })]) assert.equal(compareOffer(contract(), candidate, new Date(), true).firstYear, null);
  assert.equal(compareOffer({ ...contract(), cancellationFee: null }, offer(), new Date(), true).firstYear, null);
});
test("current promotional baseline and annual billing are normalized without double-counting", () => {
  const c = { ...contract(), price: 600, cycle: "annual" as const, currentPromoMonths: 3, priceAfterPromo: 1200 };
  assert.equal(compareOffer(c, offer({ promoMonths: 0, monthlyPrice: 40 }), new Date(), true).firstYear, 500);
  const longer = { ...contract(), currentPromoMonths: 24, price: 60, priceAfterPromo: 100 };
  assert.equal(compareOffer(longer, offer({ monthlyPrice: 50, promoMonths: 24, monthlyPriceAfterPromo: 80 }), new Date(), true).firstYear, 50);
});
test("shortlist requires reviewed benefits and takes only the best mutually exclusive alternative", () => {
  const c = contract(), a = offer(), b = offer({ monthlyPrice: 50 });
  assert.equal(shortlistTotal([{ contract: c, offer: a, reviewed: false }]).count, 0);
  const total = shortlistTotal([{ contract: c, offer: a, reviewed: true }, { contract: c, offer: b, reviewed: true }]);
  assert.equal(total.count, 1); assert.equal(total.firstYear, 350); assert.equal(total.excluded, 1);
});
test("auto limits and both deductibles must match; lower protection cannot manufacture savings", () => {
  const c = { ...contract(), category: "car-insurance" as const, liabilityLimit: 2000000, collisionDeductible: 500, comprehensiveDeductible: 300 };
  const matching = offer({ liabilityLimit: 2000000, collisionDeductible: 500, comprehensiveDeductible: 300 });
  assert.equal(compareOffer(c, matching, new Date(), true).firstYear, 290);
  assert.equal(compareOffer(c, { ...matching, liabilityLimit: 1000000 }, new Date(), true).firstYear, null);
  assert.equal(compareOffer(c, { ...matching, collisionDeductible: 1000 }, new Date(), true).firstYear, null);
  assert.equal(compareOffer(c, { ...matching, comprehensiveDeductible: 500 }, new Date(), true).firstYear, null);
});
test("expired and stale public offers are excluded; negative savings stay negative", () => {
  assert.equal(compareOffer(contract(), offer({ checkedAt: "2020-01-01" }), new Date(), true).firstYear, null);
  assert.equal(compareOffer(contract(), offer({ validUntil: "2020-01-01" }), new Date(), true).firstYear, null);
  assert.ok((compareOffer(contract(), offer({ monthlyPrice: 200, promoMonths: 0 }), new Date(), true).firstYear ?? 0) < 0);
});
test("mortgage compares fixed Canadian-compounded interest with identical term and amortization", () => {
  const c = { ...contract(), category: "mortgage" as const, mortgageBalance: 400000, mortgageRate: 5, amortizationYears: 25, termMonths: 60 };
  const a = offer({ mortgageRate: 4, termMonths: 60, amortizationYears: 25 });
  const result = compareOffer(c, a, new Date(), true);
  assert.equal(result.metric, "interest"); assert.ok((result.firstYear ?? 0) > 3000); assert.ok((result.ongoingAnnual ?? 0) > 3000);
  assert.equal(compareOffer(c, { ...a, termMonths: 36 }, new Date(), true).firstYear, null);
  assert.equal(compareOffer({ ...c, rateType: "variable" }, a, new Date(), true).firstYear, null);
  assert.equal(compareOffer({ ...c, termMonths: 6 }, { ...a, termMonths: 6 }, new Date(), true).firstYear, null);
});
test("public summaries and server validation omit names, notes, documents and free-text identifiers", () => {
  const c = { ...contract(), name: "PRIVATE-NAME", provider: "PRIVATE-PROVIDER test@example.test", notes: "PRIVATE-NOTES", needs: "PRIVATE-ADDRESS", discounts: "PRIVATE-ACCOUNT", documents: [{ id: "secret", name: "PRIVATE-PDF", type: "application/pdf", size: 1, addedAt: "" }] };
  const baseline = validateBaseline({ ...publicBaseline(c), notes: c.notes, documents: c.documents });
  const prompt = savingsPrompt(baseline);
  assert.doesNotMatch(prompt, /PRIVATE-|test@example/); assert.equal(baseline.provider, "Provider not disclosed");
  assert.match(prompt, /Do not contact providers/); assert.match(prompt, /Never include entered costs/);
  assert.throws(() => validateBaseline({ ...publicBaseline(c), price: -1 }));
});
test("public report validation rejects quote claims, unsafe URLs and unsourced offers", () => {
  for (const candidate of [offer({ mortgageRate: 31 }), offer({ termMonths: 0 }), offer({ amortizationYears: 0 }), offer({ kind: "personalized-quote" as never }), offer({ sources: [] }), offer({ sources: [{ title: "Bad", url: "javascript:alert(1)" }] }), offer({ sources: [{ title: "Private", url: "https://example.test/offer?email=test@example.test" }] })])
    assert.throws(() => validateReport({ summary: "Test", missing: [], offers: [candidate] }, "test"));
  const report = validateReport({ summary: "Test", missing: [], offers: [offer({ affectedContractIds: ["home-policy"] })] }, "test");
  assert.equal(report.offers[0].comparable, false); assert.ok(report.offers[0].affectedContractIds.includes("unmodeled-bundle"));
});
test("legacy subscription and mortgage reuse is additive and leaves original state unchanged", () => {
  const state: SavingsState = { SchemaVersion: 1, Subscriptions: [{ Id: "sub", Name: "Spotify", Price: 20, Cycle: BillingCycle.Monthly, Renewal: "2027-01-01", Review: false, Cancelled: false }], Offers: [], Mortgage: { Balance: 400000, BaseRate: 5, OfferRate: 4, Years: 25, TermMonths: 60, Fees: 0, Renewal: "2027-01-01" } };
  const before = JSON.stringify(state), derived = effectiveContracts(state);
  assert.equal(derived.length, 2); assert.equal(JSON.stringify(state), before); assert.equal(derived[0].price, 20);
  const adopted = { ...state, Contracts: [{ ...derived[0], needs: "Confirmed tier" }] };
  assert.equal(effectiveContracts(adopted).length, 2); assert.ok(missingInformation(derived[0]).length > 0);
});
test("research jobs persist, deduplicate pending starts and mark interrupted work honestly after restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "familyhub-savings-test-"));
  let release!: (value: string) => void, calls = 0;
  const service = new SavingsResearch(dir, async () => { calls++; return new Promise(resolve => { release = resolve; }); });
  try {
    await service.initialize();
    const request = { contractId: "synthetic", baselineKey: "a".repeat(64), baseline: publicBaseline(contract()) };
    const [first, second] = await Promise.all([service.start(request), service.start(request)]);
    assert.equal(first.id, second.id);
    for (let i = 0; i < 40 && !release; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(calls, 1);
    release(JSON.stringify({ summary: "Verified synthetic output", missing: [], offers: [offer()] }));
    for (let i = 0; i < 40 && service.get(first.id)?.status !== "complete"; i++) await new Promise(resolve => setTimeout(resolve, 5));
    let saved = JSON.parse(await readFile(join(dir, first.id + ".json"), "utf8"));
    // In-memory completion precedes the atomic persistence. Wait for the contract under test.
    for (let i = 0; i < 100 && saved.status !== "complete"; i++) { await new Promise(resolve => setTimeout(resolve, 10)); saved = JSON.parse(await readFile(join(dir, first.id + ".json"), "utf8")); }
    assert.equal(saved.status, "complete");
    saved.status = "running"; await writeFile(join(dir, saved.id + ".json"), JSON.stringify(saved));
    await writeFile(join(dir, "aaaa.json"), "{malformed");
    const restarted = new SavingsResearch(dir, async () => { throw new Error("Must not replay a interrupted job"); });
    await restarted.initialize(); assert.equal(restarted.get(first.id)?.status, "failed");
    assert.equal(await readFile(join(dir, "aaaa.json"), "utf8"), "{malformed");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
