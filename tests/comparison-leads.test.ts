import test from "node:test";
import assert from "node:assert/strict";
import { comparisonLead } from "../apps/web/src/comparison-leads";
import { baselineKey, newContract, publicBaseline, type SavingsContract, type SavingsOffer } from "../apps/web/src/savings";
const now = new Date("2026-10-11T12:00:00Z");
function fixture() {
    const contract: SavingsContract = { ...newContract("telecom", "synthetic-contract"), provider: "TELUS", name: "Invented test service", price: 120, taxesIncluded: true, needs: "Synthetic equivalent service", cancellationFee: 0, annualLostDiscounts: 0 };
    const offer: SavingsOffer = { provider: "Rogers", title: "Synthetic source candidate", kind: "public-estimate", currentProvider: false, monthlyPrice: 80, promoMonths: 0, monthlyPriceAfterPromo: null, upfrontFees: 0, annualLostDiscounts: 0, taxesIncluded: true, comparable: true, differences: [], conditions: [], checkedAt: "2026-10-10T12:00:00Z", validUntil: null, sources: [{ title: "Synthetic official source", url: "https://example.test/offer" }], liabilityLimit: null, collisionDeductible: null, comprehensiveDeductible: null, mortgageRate: null, termMonths: null, amortizationYears: null, rateType: "fixed", affectedContractIds: [contract.id] };
    const review = { localKey: baselineKey(contract), job: { id: "synthetic-job", contractId: contract.id, baselineKey: "synthetic-hash", baseline: publicBaseline(contract), status: "complete" as const, createdAt: "2026-10-10T12:00:00Z", report: { summary: "Synthetic only", missing: [] as string[], offers: [offer] } }, decisions: { "0": "shortlist" as "shortlist" | "review" | "dismissed" } };
    return { contract, offer, review };
}
test("an applicable cheaper offer links the exact saved job/offer without inventing personal eligibility", () => {
    const { contract, review } = fixture();
    assert.deepEqual(comparisonLead(contract, review, now), { jobId: "synthetic-job", offerIndex: 0, firstYear: null });
    assert.equal(comparisonLead(contract, undefined, now), null);
});
test("stale, expired, future, unsourced, dismissed, incomparable and other-contract results never create a badge", () => {
    for (const change of [
        f => { f.review.localKey = "old"; }, f => { f.review.job.contractId = "another"; },
        f => { f.offer.validUntil = "2026-10-10"; }, f => { f.offer.validUntil = "invalid"; },
        f => { f.offer.checkedAt = "2026-01-01"; }, f => { f.offer.checkedAt = "2026-10-12"; },
        f => { f.offer.sources = []; }, f => { f.offer.comparable = false; },
        f => { f.review.decisions["0"] = "dismissed"; }, f => { f.offer.affectedContractIds.push("other-package"); },
    ] as Array<(f: ReturnType<typeof fixture>) => void>) { const f = fixture(); change(f); assert.equal(comparisonLead(f.contract, f.review, now), null); }
});
test("unknown taxes, currencies, current costs and non-positive savings cannot be promoted", () => {
    for (const change of [
        f => { f.contract.taxesIncluded = false; }, f => { f.contract.price = null; },
        f => { f.offer.taxesIncluded = false; }, f => { f.offer.monthlyPrice = null; },
        f => { f.offer.monthlyPrice = 120; }, f => { f.offer.monthlyPrice = 140; },
        f => { f.offer.upfrontFees = 1000; },
        f => { f.contract.billing = { amount: 120, currency: "USD", unit: "months", count: 1, asOf: "2026-10-01", source: "Synthetic", taxesIncluded: true }; },
    ] as Array<(f: ReturnType<typeof fixture> & { contract: ReturnType<typeof newContract> }) => void>) {
        const f = fixture(); change(f); f.review.localKey = baselineKey(f.contract);
        assert.equal(comparisonLead(f.contract, f.review, now), null);
    }
});
test("unknown fees, promotion, conditional eligibility and missing facts remain qualitative", () => {
    const f = fixture(); f.offer.upfrontFees = null; f.offer.promoMonths = 6; f.offer.monthlyPriceAfterPromo = null;
    f.offer.conditions = ["Synthetic new-customer eligibility not established"];
    f.review.job.report.missing = ["Current commitment to confirm"];
    assert.equal(comparisonLead(f.contract, f.review, now)?.firstYear, null);
    f.review.job.report.offers.unshift({ ...f.offer, comparable: false });
    assert.equal(comparisonLead(f.contract, f.review, now)?.offerIndex, 1);
});
