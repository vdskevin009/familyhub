import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { applyOpportunityDecisions, buildOpportunityFeed, freshness, opportunityHref, type OpportunityInputs } from "../apps/web/src/opportunities.ts";
import { collectOpportunitySources, emptyOpportunityInputs, saveOpportunityAction, type OpportunityLoaders } from "../apps/web/src/useOpportunities.ts";
import { newContract, baselineKey, publicBaseline, type SavingsOffer, type SavingsJob } from "../apps/worker/src/savings-model.ts";
import { emptyPlan, type GroceryPlan } from "../apps/worker/src/grocery-planning.ts";
import { emptyReceipt } from "../apps/worker/src/grocery-model.ts";
import { emptyMortgage } from "../apps/worker/src/mortgage-model.ts";
import type { InvoiceSnapshot } from "../apps/web/src/worker.ts";
import type { ReconciliationCase } from "../apps/web/src/types.ts";

const now = "2027-03-01T12:00:00.000Z";
const blank = () => emptyOpportunityInputs("ready");
function claim(overrides: Partial<ReconciliationCase> = {}): ReconciliationCase {
  return { Id: "synthetic-case", Member: "unknown", Provider: "Synthetic clinic", ServiceDate: "2027-02-20", OriginalAmount: 200, ReimbursedAmount: 80, PotentialRemaining: 120, Currency: "CAD", NextInsurer: "Desjardins", Action: "submit-secondary", Summary: "Synthetic", Confidence: .95, DocumentIds: [], WorkflowStatus: "open", ...overrides };
}
function invoices(cases: ReconciliationCase[]): InvoiceSnapshot {
  return { items: [], reconciliations: cases, busy: false, setupRequired: false, cleanupSuggestions: [], importantMail: [], unmatchedReimbursements: [], ignoredUnmatchedReimbursements: [], learning: { decisions: 0, undoable: [] }, accounts: [], progress: {}, lastSuccess: now };
}
function withClaims(cases: ReconciliationCase[]) {
  const input = blank(); input.claims.data = invoices(cases); input.claims.sourceDate = now; return input;
}
function planFixture(): GroceryPlan {
  const p = emptyPlan(); p.area = "Synthetic locality"; p.areaConfirmed = true;
  const evidence = { title: "Synthetic observed catalogue", url: "https://example.test/catalogue", date: "2027-03-01", until: "2027-03-03" };
  p.items = ["oats", "rice"].map(id => ({ id, name: id, quantity: 1, size: 1, unit: "kg", preference: "", substitutions: false, active: true, origin: "fixture" }));
  p.retailers = [{ id: "synthetic-store", name: "Synthetic store", delivery: 0, service: 0, servicePercent: 0, feesTaxPercent: 0, minimum: 0, freeDeliveryAbove: null, areaConfirmed: true, otherFeesReviewed: true, evidence }];
  p.prices = p.items.map(item => ({ id: "price-" + item.id, itemId: item.id, retailerId: "synthetic-store", product: item.name, price: 4, size: 1, unit: "kg", weighed: false, taxPercent: 0, currency: "CAD", available: "yes", substitution: false, approved: true, kind: "public", evidence }));
  return p;
}
test("recovery cards use the authoritative open/known summary; ambiguous, closed, ignored and competing duplicates excluded", async () => {
  const input = withClaims([claim(), claim(), claim({ Id: "ambiguous", HasUnresolvedReimbursementEvidence: true, PotentialRemaining: 999 }), claim({ Id: "closed", WorkflowStatus: "closed", PotentialRemaining: 500 }), claim({ Id: "ignored", WorkflowStatus: "ignore" }), claim({ Id: "foreign", Currency: "EUR" })]);
  const feed = await buildOpportunityFeed(input, now);
  assert.deepEqual(feed.recoverable, { amount: 120, currency: "CAD", known: 1, unknown: 2 });
  const claims = feed.opportunities.filter(o => o.domain === "claims");
  assert.equal(claims.length, 3); assert.equal(claims.filter(o => o.benefit.amount !== null).length, 1);
  assert.equal(claims.find(o => o.target.recordId === "synthetic-case")?.benefit.period, "once");
  assert.ok(claims.find(o => o.target.recordId === "synthetic-case")?.description.includes("Desjardins"));
  assert.ok(claims.every(o => o.target.view === "reimbursements"));
  assert.ok(claims.every(o => o.context === undefined));
});
test("fetching stale or undated claims today does not refresh their financial evidence", async () => {
  for (const sourceDate of ["2027-01-01", null, "2028-01-01"]) {
    const input = withClaims([claim()]); input.claims.sourceDate = sourceDate; input.claims.checkedAt = now;
    const feed = await buildOpportunityFeed(input, now);
    assert.equal(feed.recoverable.amount, null); assert.equal(feed.opportunities[0].benefit.amount, null); assert.equal(feed.opportunities[0].status, "needs-information");
  }
});
test("source failure cannot be mistaken for a clean household or zero recoverable", async () => {
  const input = emptyOpportunityInputs("error"), feed = await buildOpportunityFeed(input, now);
  assert.equal(feed.recoverable.amount, null); assert.equal(feed.opportunities.length, 1);
  assert.equal(feed.opportunities[0].status, "unavailable"); assert.equal(feed.opportunities[0].confidence, "unknown");
});
test("structured policy expiry overrides the empty legacy renewal; awaiting quote has no invented gain", async () => {
  const input = blank(), c = newContract("home-insurance", "synthetic-contract"); c.provider = "Synthetic insurer";
  c.insuranceReference = { schema: 1, updatedAt: now, sources: [{ id: "source", kind: "document", reference: "synthetic", title: "Synthetic policy", date: "2027-02-01", scope: "original", verification: "locally-read" }], records: [
    { id: "policy", kind: "policy", title: "Synthetic policy", provider: "Synthetic", status: "documented", effectiveFrom: "2026-04-26", effectiveTo: "2027-04-26", requestedOn: null, receivedOn: null, validUntil: null, quotedAnnualPremium: null, comparison: "partial", assumptions: [], differences: [], limitations: ["Coverage incomplete"], sourceIds: ["source"], facts: [], supersedes: null },
    { id: "request", kind: "quote-request", title: "Synthetic request", provider: "Synthetic", status: "awaiting_quote", effectiveFrom: null, effectiveTo: null, requestedOn: "2027-02-28", receivedOn: null, validUntil: null, quotedAnnualPremium: null, comparison: "unassessed", assumptions: [], differences: [], limitations: [], sourceIds: ["source"], facts: [], supersedes: null }
  ] };
  input.contracts.data = { records: [{ contract: c, revision: "synthetic-revision" }] };
  const feed = await buildOpportunityFeed(input, now), card = feed.opportunities[0];
  assert.equal(card.dueDate, "2027-04-26"); assert.equal(card.target.recordId, c.id); assert.equal(card.priority, 86);
  assert.equal(card.benefit.amount, null); assert.match(card.description, /1 devis en attente/);
  assert.deepEqual(card.context, { kind: "insurance-renewal", recordId: c.id, dueDate: "2027-04-26" });
  const policy = c.insuranceReference.records[0];
  policy.facts = [{ code: "coverage.subLimit", label: "Synthetic coverage conflict", value: null, unit: "CAD", certainty: "conflict", sourceIds: ["source"], notes: "Synthetic disagreement" }];
  const coverage = (await buildOpportunityFeed(input, now)).opportunities[0];
  assert.equal(coverage.dueDate, "2027-04-26"); assert.equal(coverage.freshness, "fresh"); assert.equal(coverage.priority, 86); assert.equal(coverage.benefit.amount, null);
  assert.ok(coverage.evidence.some(e => e.includes("Garanties contradictoires")));
  policy.facts[0].code = "policy.effectiveTo";
  const dateConflict = (await buildOpportunityFeed(input, now)).opportunities[0];
  assert.equal(dateConflict.dueDate, null); assert.equal(dateConflict.freshness, "unknown");
  assert.equal(dateConflict.context, undefined);
  policy.facts = []; c.insuranceReference.sources[0].verification = "unverified";
  assert.equal((await buildOpportunityFeed(input, now)).opportunities[0].dueDate, null);
  c.insuranceReference.sources[0].verification = "locally-read";
  c.insuranceReference.records.push({ ...structuredClone(policy), id: "competing-policy", effectiveTo: "2027-04-27" });
  assert.equal((await buildOpportunityFeed(input, now)).opportunities[0].dueDate, null);
});
test("a completed daily public research run is not a realized saving", async () => {
  const input = blank(); input.research.data = { jobs: [], daily: { outcome: "complete", completedAt: now }, schedule: null };
  const feed = await buildOpportunityFeed(input, now); assert.equal(feed.opportunities.length, 0);
});
function offerFixture() {
  const input = blank(), c = { ...newContract("telecom", "synthetic-telecom"), provider: "Synthetic current", price: 100, taxesIncluded: true, needs: "Synthetic same service", renewal: "2027-08-01", cancellationFee: 10, annualLostDiscounts: 0, billing: { amount: 100, currency: "CAD", unit: "months" as const, count: 1, asOf: "2027-02-20", source: "Synthetic current invoice", taxesIncluded: true } };
  const offer: SavingsOffer = { provider: "Synthetic alternative", title: "Synthetic monthly plan", kind: "public-estimate", currentProvider: false, monthlyPrice: 80, promoMonths: 0, monthlyPriceAfterPromo: null, upfrontFees: 5, annualLostDiscounts: 0, taxesIncluded: true, comparable: true, differences: [], conditions: [], checkedAt: now, validUntil: "2027-03-15", sources: [{ title: "Synthetic published price", url: "https://example.test/offer" }], liabilityLimit: null, collisionDeductible: null, comprehensiveDeductible: null, mortgageRate: null, termMonths: null, amortizationYears: null, rateType: "fixed", affectedContractIds: [c.id] };
  const key = baselineKey(c), job: SavingsJob = { id: "synthetic-job", contractId: c.id, baselineKey: createHash("sha256").update(key).digest("hex"), baseline: publicBaseline(c), status: "complete", createdAt: now, completedAt: now, report: { summary: "Synthetic comparison", missing: [], offers: [offer] } };
  input.contracts.data = { records: [{ contract: c, revision: "synthetic" }] }; input.research.data = { jobs: [job], daily: null, schedule: null };
  const review = { job: structuredClone(job), localKey: key, decisions: { "0": "shortlist" as const } };
  return { input, c, job, offer, review };
}
test("public candidate stays unknown; reviewed identical current offer gives first-year net after costs", async () => {
  const { input, review } = offerFixture();
  const candidate = (await buildOpportunityFeed(input, now)).opportunities[0]; assert.equal(candidate.benefit.amount, null);
  const chosen = (await buildOpportunityFeed(input, now, [review])).opportunities[0];
  assert.equal(chosen.benefit.amount, 225); assert.equal(chosen.benefit.period, "first-year"); assert.equal(chosen.benefit.kind, "potential"); assert.equal(chosen.confidence, "conditional");
  assert.equal(chosen.target.jobId, "synthetic-job"); assert.equal(chosen.target.offerIndex, 0); assert.equal(chosen.id, candidate.id); assert.notEqual(chosen.evidenceVersion, candidate.evidenceVersion);
  assert.equal(chosen.context, undefined); assert.equal(candidate.context, undefined);
});
test("insurance reminder scope binds the exact card and date; a new date reopens the opportunity", async () => {
  const input = blank(), contract = { ...newContract("home-insurance", "synthetic-renewal"), renewal: "2027-03-20" };
  input.contracts.data = { records: [{ contract, revision: "synthetic" }] };
  const first = (await buildOpportunityFeed(input, now)).opportunities[0];
  assert.deepEqual(first.context, { kind: "insurance-renewal", recordId: contract.id, dueDate: contract.renewal });
  assert.equal(first.id, "insurance:" + createHash("sha256").update(JSON.stringify("insurance:" + contract.id)).digest("hex"));
  const decisions = { [first.id]: { opportunityId: first.id, evidenceVersion: first.evidenceVersion, state: "resolved" as const, at: now, context: first.context } };
  assert.equal(applyOpportunityDecisions([first], decisions, now).opportunities.length, 0);
  contract.renewal = "2027-03-21";
  const changed = (await buildOpportunityFeed(input, now)).opportunities[0];
  assert.equal(changed.id, first.id); assert.notEqual(changed.evidenceVersion, first.evidenceVersion);
  assert.equal(changed.context?.dueDate, contract.renewal); assert.equal(applyOpportunityDecisions([changed], decisions, now).opportunities.length, 1);
  contract.renewal = "2027-02-30";
  assert.equal((await buildOpportunityFeed(input, now)).opportunities[0].context, undefined);
});
test("snooze and restore send one authoritative action request with the same exact reminder context", async t => {
  const input = blank(), contract = { ...newContract("home-insurance", "synthetic-renewal"), renewal: "2027-03-20" };
  input.contracts.data = { records: [{ contract, revision: "synthetic" }] };
  const card = (await buildOpportunityFeed(input, now)).opportunities[0], calls: { url: string; body: any }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string); calls.push({ url, body });
    const decisions = body.action === "restore" ? {} : { [body.opportunityId]: { opportunityId: body.opportunityId, evidenceVersion: body.evidenceVersion, context: body.context, at: now, state: "snoozed", snoozedUntil: body.snoozedUntil } };
    return new Response(JSON.stringify({ schema: 1, revision: "server-" + calls.length, decisions, history: [], totals: { seen: 0, snoozed: 1, dismissed: 0, resolved: 0, restored: body.action === "restore" ? 1 : 0 } }), { status: 200 });
  });
  const config = { Endpoint: "https://example.test/private-worker", ApiKey: "synthetic-key" };
  const saved = await saveOpportunityAction(config, "empty", card, "snooze", { snoozedUntil: "2027-03-08T12:00:00Z" });
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].body.context, card.context);
  assert.equal(applyOpportunityDecisions([card], saved.decisions, now).opportunities.length, 0);
  const restored = await saveOpportunityAction(config, saved.revision, card, "restore");
  assert.equal(calls.length, 2); assert.ok(calls.every(c => c.url === config.Endpoint + "/opportunity-actions"));
  assert.equal(calls[1].body.expectedRevision, "server-1"); assert.equal(calls[1].body.action, "restore"); assert.deepEqual(calls[1].body.context, card.context);
  assert.equal(applyOpportunityDecisions([card], restored.decisions, now).opportunities.length, 1);
});
test("expired, changed, unreviewed, unknown-fee or unmodeled bundle offers never give a numeric benefit", async () => {
  for (const modify of [
    (f: ReturnType<typeof offerFixture>) => { f.offer.validUntil = "2027-02-28"; },
    (f: ReturnType<typeof offerFixture>) => { f.c.billing.amount = 90; },
    (f: ReturnType<typeof offerFixture>) => { f.review.decisions = {}; },
    (f: ReturnType<typeof offerFixture>) => { f.offer.upfrontFees = null; },
    (f: ReturnType<typeof offerFixture>) => { f.offer.affectedContractIds.push("unmodeled-bundle"); f.review.job.report!.offers[0].affectedContractIds.push("unmodeled-bundle"); },
    (f: ReturnType<typeof offerFixture>) => { f.offer.monthlyPrice = 79; },
    (f: ReturnType<typeof offerFixture>) => { f.c.billing.asOf = "2026-01-01"; },
    (f: ReturnType<typeof offerFixture>) => { f.offer.checkedAt = "2027-03-02T11:00:00Z"; f.review.job.report!.offers[0].checkedAt = f.offer.checkedAt; }
  ]) {
    const fixture = offerFixture(); modify(fixture);
    const feed = await buildOpportunityFeed(fixture.input, now, [fixture.review]);
    assert.equal(feed.opportunities.filter(o => o.benefit.kind === "potential" && o.benefit.amount !== null).length, 0);
  }
});
test("two shortlisted alternatives for one contract produce one benefit only", async () => {
  const f = offerFixture(); f.job.report!.offers.push({ ...structuredClone(f.offer), monthlyPrice: 70 }); f.review.job = structuredClone(f.job); f.review.decisions["1"] = "shortlist";
  const feed = await buildOpportunityFeed(f.input, now, [f.review]); assert.equal(feed.opportunities.length, 1); assert.equal(feed.opportunities[0].benefit.amount, 345);
});
test("full eligible basket is an action, not a saving; partial and expired baskets cannot be ready", async () => {
  const input = blank(); input.groceries.data = planFixture(); input.groceries.sourceDate = "2027-03-01";
  let card = (await buildOpportunityFeed(input, now)).opportunities[0]; assert.equal(card.status, "ready"); assert.equal(card.benefit.amount, null); assert.equal(card.target.tab, "compare");
  input.groceries.data.prices.pop(); card = (await buildOpportunityFeed(input, now)).opportunities[0]; assert.equal(card.status, "needs-information"); assert.match(card.description, /1\/2/);
  input.groceries.data = planFixture(); input.groceries.data.prices.forEach(p => p.evidence.until = "2027-02-28");
  card = (await buildOpportunityFeed(input, now)).opportunities[0]; assert.equal(card.status, "needs-information"); assert.equal(card.benefit.amount, null);
});
test("delivered confirmation becomes a final receipt action, never paid amount or earned saving", async () => {
  const input = blank(); input.purchases.data = { records: [{ id: "synthetic-receipt", revision: "one", status: "saved", createdAt: now, sources: [], extraction: "complete", reviewedAt: now, duplicateOf: null, receipt: { ...emptyReceipt(), sourceType: "confirmation", fulfillment: { date: "2027-02-28", evidence: "Synthetic delivery" }, store: "Synthetic", date: "2027-02-27", currency: "CAD", total: 99.99 } }] };
  let feed = await buildOpportunityFeed(input, now); assert.equal(feed.opportunities[0].benefit.amount, null); assert.equal(feed.opportunities[0].target.recordId, "synthetic-receipt");
  input.purchases.data.records[0].receipt.sourceType = "final-receipt";
  feed = await buildOpportunityFeed(input, now); assert.equal(feed.opportunities.length, 0);
});
test("hypothetical mortgage balance or advertised rates do not become personalized gains", async () => {
  const input = blank(); input.mortgage.data = emptyMortgage();
  input.mortgage.data.assumptions.push({ id: "synthetic", recordedAt: now, principal: 450000, currentRate: 5, remainingMonths: 240, source: "Synthetic assumptions", principalBasis: "assumption", amortizationBasis: "assumption", currentRateBasis: "user-reported", currentMaturity: null });
  const card = (await buildOpportunityFeed(input, now)).opportunities[0]; assert.equal(card.benefit.amount, null); assert.equal(card.status, "needs-information"); assert.equal(card.target.view, "mortgage");
});
test("fresh retrieval and source clock movement do not reopen a dismissed unchanged claim", async () => {
  const input = withClaims([claim()]), first = (await buildOpportunityFeed(input, now)).opportunities[0];
  input.claims.checkedAt = "2027-03-02T13:00:00Z"; input.claims.sourceDate = "2027-03-02";
  const second = (await buildOpportunityFeed(input, "2027-03-02T13:00:00Z")).opportunities[0];
  assert.equal(first.id, second.id); assert.equal(first.evidenceVersion, second.evidenceVersion);
  const decisions = { [first.id]: { opportunityId: first.id, evidenceVersion: first.evidenceVersion, state: "dismissed" as const, at: now } };
  assert.equal(applyOpportunityDecisions([second], decisions, now).opportunities.length, 0);
  input.claims.data!.reconciliations[0].PotentialRemaining = 70;
  const changed = (await buildOpportunityFeed(input, "2027-03-02T13:00:00Z")).opportunities[0];
  assert.equal(first.id, changed.id); assert.notEqual(first.evidenceVersion, changed.evidenceVersion);
  assert.equal(applyOpportunityDecisions([changed], decisions, now).opportunities.length, 1);
});
test("snooze expiration restores visibility and resolved state does not create confirmed savings", async () => {
  const feed = await buildOpportunityFeed(withClaims([claim()]), now), card = feed.opportunities[0];
  const d = { opportunityId: card.id, evidenceVersion: card.evidenceVersion, state: "snoozed" as const, at: now, snoozedUntil: "2027-03-03T12:00:00Z" };
  assert.equal(applyOpportunityDecisions([card], { [card.id]: d }, now).opportunities.length, 0);
  assert.equal(applyOpportunityDecisions([card], { [card.id]: d }, "2027-03-03T12:00:00Z").opportunities.length, 1);
  const resolved = applyOpportunityDecisions([card], { [card.id]: { ...d, state: "resolved" } }, now);
  assert.equal(resolved.opportunities.length, 0); assert.equal(resolved.allOpportunities[0].benefit.kind, "recoverable");
});
test("one unreadable source does not block other reads and error strings stay private", async () => {
  const data = { claims: invoices([]), contracts: { records: [] }, research: { jobs: [], daily: null, schedule: null }, finances: { data: null }, groceries: emptyPlan(), purchases: { records: [] }, mortgage: emptyMortgage() };
  const loaders = Object.fromEntries(Object.entries(data).map(([id, value]) => [id, () => id === "finances" ? Promise.reject(new Error("SECRET_URL_AND_PRIVATE_DETAIL")) : Promise.resolve(value)])) as OpportunityLoaders;
  const seen: any[] = []; await collectOpportunitySources(loaders, source => seen.push(source), () => now);
  assert.equal(seen.length, 7); assert.equal(seen.filter(s => s.status === "ready").length, 6); assert.equal(seen.find(s => s.id === "finances").data, null);
  assert.ok(!JSON.stringify(seen).includes("SECRET_URL")); assert.equal(seen.find(s => s.id === "contracts").sourceDate, null);
  assert.equal(seen.find(s => s.id === "claims").sourceDate, "2027-03-01");
});
test("precise destinations escape record identifiers and preserve tab", () => {
  const url = new URL(opportunityHref({ view: "groceries", tab: "tickets", recordId: "record&view=more" }), "https://example.test/familyhub/");
  assert.equal(url.searchParams.get("view"), "groceries"); assert.equal(url.searchParams.get("record"), "record&view=more"); assert.equal(url.searchParams.get("tab"), "tickets");
  assert.equal(freshness("2027-02-30", now, 7), "unknown");
});
test("ranking is deterministic; a partial source failure does not eclipse verified actionable dossiers", async () => {
  const input = withClaims([claim({ Id: "b" }), claim({ Id: "a", PotentialRemaining: 100000, HasUnresolvedReimbursementEvidence: true })]); input.finances.status = "error";
  const first = await buildOpportunityFeed(input, now), second = await buildOpportunityFeed(input, now);
  assert.deepEqual(first, second); assert.equal(first.opportunities[0].target.recordId, "b"); assert.equal(first.opportunities.at(-1)?.domain, "system");
});
