import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newContract, compareOffer, publicBaseline, shortlistTotal, missingInformation, type SavingsOffer } from "../apps/worker/src/savings-model";
import { SavingsResearch, validateBaseline, validateReport, savingsPrompt } from "../apps/worker/src/savings-research";
import { effectiveContracts } from "../apps/web/src/savings";
import { BillingCycle, type SavingsState } from "../apps/web/src/types";
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
  for (const candidate of [offer({ kind: "personalized-quote" as never }), offer({ sources: [] }), offer({ sources: [{ title: "Bad", url: "javascript:alert(1)" }] }), offer({ sources: [{ title: "Private", url: "https://example.test/offer?email=test@example.test" }] })])
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
    const saved = JSON.parse(await readFile(join(dir, first.id + ".json"), "utf8"));
    assert.equal(saved.status, "complete");
    saved.status = "running"; await writeFile(join(dir, saved.id + ".json"), JSON.stringify(saved));
    await writeFile(join(dir, "aaaa.json"), "{malformed");
    const restarted = new SavingsResearch(dir, async () => { throw new Error("Must not replay a interrupted job"); });
    await restarted.initialize(); assert.equal(restarted.get(first.id)?.status, "failed");
    assert.equal(await readFile(join(dir, "aaaa.json"), "utf8"), "{malformed");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
