import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { applyOpportunityDecisions, buildOpportunityFeed } from "../apps/web/src/opportunities.ts";
import { emptyOpportunityInputs } from "../apps/web/src/useOpportunities.ts";
import { newContract } from "../apps/worker/src/savings-model.ts";
import type { InvoiceSnapshot } from "../apps/web/src/worker.ts";

const now = "2027-03-01T12:00:00Z";
function fixture() {
  const input = emptyOpportunityInputs("ready"), contract = newContract("home-insurance", "synthetic-policy");
  contract.insuranceReference = { schema: 1, updatedAt: now, sources: [{ id: "policy-source", kind: "document", reference: "synthetic", title: "Synthetic policy", date: "2027-02-01", scope: "original", verification: "locally-read" }], records: [
    { id: "policy", kind: "policy", title: "Synthetic policy", provider: "Synthetic", status: "documented", effectiveFrom: "2026-04-26", effectiveTo: "2027-04-26", requestedOn: null, receivedOn: null, validUntil: null, quotedAnnualPremium: null, comparison: "partial", assumptions: [], differences: [], limitations: [], sourceIds: ["policy-source"], facts: [], supersedes: null },
    { id: "request", kind: "quote-request", title: "Synthetic request", provider: "Synthetic", status: "awaiting_quote", effectiveFrom: null, effectiveTo: null, requestedOn: "2027-02-28", receivedOn: null, validUntil: null, quotedAnnualPremium: null, comparison: "unassessed", assumptions: [], differences: [], limitations: [], sourceIds: ["policy-source"], facts: [], supersedes: null }
  ] };
  input.contracts.data = { records: [{ contract, revision: "synthetic" }] };
  input.claims.sourceDate = now;
  input.claims.data = { items: [{ Id: "synthetic-expense", Category: 0, DocumentRole: "expense", Member: "Kevin", Provider: "Synthetic clinic", Currency: "CAD", ServiceDate: "2027-02-20", Healthcare: { ServiceType: "Physiotherapy - 30 Min Follow Up Visit (30 minutes)" }, Attachments: [{ Id: "synthetic-pdf", FileName: "synthetic.pdf", MimeType: "application/pdf" }] }], reconciliations: [{ Id: "synthetic-claim", Member: "Kevin", Provider: "Synthetic clinic", ServiceDate: "2027-02-20", OriginalAmount: 150, ReimbursedAmount: 90, PrimaryInsurer: "Desjardins", SecondaryInsurer: "Blue Cross", DesjardinsReimbursedAmount: 90, PotentialRemaining: 60, Currency: "CAD", NextInsurer: "Blue Cross", Action: "submit-secondary", Summary: "Synthetic", Confidence: .95, DocumentIds: ["synthetic-expense"], WorkflowStatus: "open" }], unmatchedReimbursements: [], ignoredUnmatchedReimbursements: [], busy: false, setupRequired: false, lastSuccess: now } as unknown as InvoiceSnapshot;
  return { input, contract };
}

test("a preparable reimbursement leads passive quote waiting without inventing a gain", async () => {
  const { input } = fixture(), feed = await buildOpportunityFeed(input, now);
  assert.equal(feed.opportunities[0].domain, "claims");
  const waiting = feed.opportunities.find(o => o.domain === "insurance")!;
  assert.equal(waiting.status, "waiting"); assert.equal(waiting.actionLabel, "Voir le suivi");
  assert.equal(waiting.benefit.amount, null); assert.equal(waiting.target.recordId, "synthetic-policy");
  assert.equal(feed.recoverable.amount, 60);
});

test("unchanged waiting evidence retains the deployed fingerprint and existing decisions", async () => {
  const { input, contract } = fixture(), feed = await buildOpportunityFeed(input, now);
  const card = feed.opportunities.find(o => o.domain === "insurance")!, policy = contract.insuranceReference!.records[0];
  const legacy = ["2027-04-26", [[policy.id, policy.effectiveTo, policy.facts]], policy.id, policy.comparison, ["request"], [], false];
  assert.equal(card.evidenceVersion, "v1:" + createHash("sha256").update(JSON.stringify(legacy)).digest("hex"));
  const next = (await buildOpportunityFeed(input, "2027-03-02T12:00:00Z")).opportunities.find(o => o.domain === "insurance")!;
  assert.equal(card.id, next.id); assert.equal(card.evidenceVersion, next.evidenceVersion);
  const decisions = { [card.id]: { opportunityId: card.id, evidenceVersion: card.evidenceVersion, state: "dismissed" as const, at: now } };
  assert.ok(!applyOpportunityDecisions([next], decisions, now).opportunities.length);
});

test("a verified deadline within seven days returns quote waiting to attention", async () => {
  const { input } = fixture(); input.claims.sourceDate = "2027-04-19";
  const prior = (await buildOpportunityFeed(input, "2027-04-18T12:00:00Z")).opportunities.find(o => o.domain === "insurance")!;
  const feed = await buildOpportunityFeed(input, "2027-04-19T12:00:00Z"), imminent = feed.opportunities[0];
  assert.equal(prior.status, "waiting"); assert.equal(imminent.domain, "insurance");
  assert.equal(imminent.status, "needs-information"); assert.equal(imminent.freshness, "fresh");
  assert.equal(imminent.id, prior.id); assert.notEqual(imminent.evidenceVersion, prior.evidenceVersion);
  assert.equal(imminent.benefit.amount, null);
  assert.equal(applyOpportunityDecisions([imminent], { [prior.id]: { opportunityId: prior.id, evidenceVersion: prior.evidenceVersion, state: "resolved", at: now } }, "2027-04-19T12:00:00Z").opportunities.length, 1);
});

test("unverified policy dates cannot manufacture urgent priority", async () => {
  const { input, contract } = fixture();
  contract.insuranceReference!.records[0].effectiveTo = "2027-03-03";
  contract.insuranceReference!.sources[0].verification = "unverified";
  const feed = await buildOpportunityFeed(input, now), card = feed.opportunities.find(o => o.domain === "insurance")!;
  assert.equal(card.dueDate, null); assert.equal(card.freshness, "unknown");
  assert.equal(feed.opportunities[0].domain, "claims");
});

test("received quote becomes a comparison action and material evidence reopens the same dossier", async () => {
  const { input, contract } = fixture(), first = (await buildOpportunityFeed(input, now)).opportunities.find(o => o.domain === "insurance")!;
  contract.insuranceReference!.records.push({ ...contract.insuranceReference!.records[1], id: "received", kind: "quote", status: "received", receivedOn: "2027-03-01", validUntil: "2027-03-31", quotedAnnualPremium: 700 });
  const next = (await buildOpportunityFeed(input, now)).opportunities.find(o => o.domain === "insurance")!;
  assert.equal(next.status, "needs-information"); assert.equal(next.actionLabel, "Comparer les garanties");
  assert.equal(next.benefit.amount, null); assert.equal(next.id, first.id); assert.notEqual(next.evidenceVersion, first.evidenceVersion);
});

test("an ambiguous large residual cannot eclipse a smaller actionable reimbursement", async () => {
  const { input } = fixture(); input.claims.data!.reconciliations.push({ ...input.claims.data!.reconciliations[0], Id: "synthetic-uncertain", PotentialRemaining: 100000, HasUnresolvedReimbursementEvidence: true });
  const before = structuredClone(input), feed = await buildOpportunityFeed(input, now);
  assert.equal(feed.opportunities[0].target.recordId, "synthetic-claim");
  assert.equal(feed.opportunities.find(o => o.target.recordId === "synthetic-uncertain")!.benefit.amount, null);
  assert.deepEqual(input, before);
  assert.deepEqual(feed, await buildOpportunityFeed(input, now));
});

test("missing original PDF, primary response, supported service or insurer order is not preparable", async () => {
  for (const modify of [
    (f: ReturnType<typeof fixture>) => { f.input.claims.data!.items[0].Attachments = []; },
    (f: ReturnType<typeof fixture>) => { f.input.claims.data!.reconciliations[0].PrimaryInsurer = null; },
    (f: ReturnType<typeof fixture>) => { f.input.claims.data!.reconciliations[0].DesjardinsReimbursedAmount = null; },
    (f: ReturnType<typeof fixture>) => { f.input.claims.data!.items[0].Healthcare!.ServiceType = "Synthetic unobserved therapy"; }
  ]) {
    const f = fixture(); modify(f);
    const card = (await buildOpportunityFeed(f.input, now)).opportunities.find(o => o.domain === "claims")!;
    assert.equal(card.status, "needs-information"); assert.equal(card.title, "Clarifier ce remboursement");
  }
});

test("adding or changing dossier evidence reopens the same card without financial writes", async () => {
  const f = fixture(); f.input.claims.data!.items[0].Attachments = [];
  const first = (await buildOpportunityFeed(f.input, now)).opportunities.find(o => o.domain === "claims")!;
  f.input.claims.data!.items[0].Attachments.push({ Id: "synthetic-pdf", FileName: "synthetic.pdf", MimeType: "application/pdf" } as any);
  const next = (await buildOpportunityFeed(f.input, now)).opportunities.find(o => o.domain === "claims")!;
  assert.equal(next.status, "ready"); assert.equal(next.id, first.id); assert.notEqual(next.evidenceVersion, first.evidenceVersion);
  assert.equal(applyOpportunityDecisions([next], { [first.id]: { opportunityId: first.id, evidenceVersion: first.evidenceVersion, state: "dismissed", at: now } }, now).opportunities.length, 1);
});
