import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import ClaimCard from "../src/views/ClaimCard";
import ReconciliationQueue from "../src/views/ReconciliationQueue";
import NearbySources from "../src/views/NearbySources";
import { MutationQueue, requireSaved, type MutationProgress } from "../src/ui/mutation-queue";
import type { ReconciliationCase, ReimbursementItem } from "../src/types";

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function harness(refresh: () => Promise<void> = async () => {}) {
  const errors: string[] = [], saved: number[] = [], progress: MutationProgress[][] = [];
  const queue = new MutationQueue({ refresh, change: state => progress.push(state), saved: count => saved.push(count), error: message => errors.push(message) });
  return { queue, errors, saved, progress };
}

test("PWA mutations: different records queue without concurrent writes; one refresh per drained batch", async () => {
  const gate = deferred(); const events: string[] = [];
  const { queue, progress, saved } = harness(async () => { events.push("refresh"); });
  const a = queue.enqueue("a", "Closed", async () => { events.push("a:start"); await gate.promise; events.push("a:end"); });
  const b = queue.enqueue("b", "Ignore", async () => { events.push("b"); });
  assert.deepEqual(events, ["a:start"]);
  assert.equal(progress.at(-1)?.find(item => item.key === "b")?.phase, "queued");
  gate.resolve(); assert.deepEqual(await Promise.all([a, b]), [true, true]);
  assert.deepEqual(events, ["a:start", "a:end", "b", "refresh"]);
  assert.deepEqual(saved, [2]); assert.equal(queue.busy, false);
});

test("PWA mutations: synchronous duplicate clicks never send a second mutation", async () => {
  const gate = deferred(); let requests = 0;
  const { queue } = harness();
  const a = queue.enqueue("same", "Closed", async () => { requests++; await gate.promise; });
  assert.equal(await queue.enqueue("same", "Ignore", async () => { requests++; }), false);
  gate.resolve(); await a; assert.equal(requests, 1);
});

test("PWA mutations: a rejected save is not reported as success and a different queued record still runs", async () => {
  const { queue, saved, errors, progress } = harness();
  const a = queue.enqueue("a", "Closed", async () => { throw new Error("Synthetic rejection"); });
  const b = queue.enqueue("b", "Ignore", async () => {});
  assert.deepEqual(await Promise.all([a, b]), [false, true]);
  assert.deepEqual(saved, [1]); assert.deepEqual(errors, ["Synthetic rejection"]);
  assert.ok(progress.some(state => state.some(item => item.key === "a" && item.phase === "checking")));
});

test("PWA mutations: saved but refresh-failed is distinct from an unconfirmed mutation", async () => {
  const { queue, errors, saved } = harness(async () => { throw new Error("Offline"); });
  assert.equal(await queue.enqueue("a", "Closed", async () => {}), true);
  assert.deepEqual(saved, []); assert.match(errors[0], /Saved on the PC.*could not be loaded/);
});

test("PWA mutations: keep a failed record locked until authoritative read completes", async () => {
  const gate = deferred(); const { queue } = harness(() => gate.promise);
  const a = queue.enqueue("a", "Closed", async () => { throw new Error("Response lost"); });
  await tick();
  assert.equal(await queue.enqueue("a", "Closed", async () => { assert.fail("duplicate during result check"); }), false);
  gate.resolve(); assert.equal(await a, false);
});

test("PWA mutations: an action queued during refresh runs afterwards and gets a fresh read", async () => {
  const gate = deferred(); const events: string[] = []; let refreshes = 0;
  const { queue } = harness(async () => { events.push("read"); if (++refreshes === 1) await gate.promise; });
  const a = queue.enqueue("a", "Closed", async () => { events.push("a"); });
  await tick(); const b = queue.enqueue("b", "Open", async () => { events.push("b"); });
  assert.deepEqual(events, ["a", "read"]);
  gate.resolve(); await Promise.all([a, b]);
  assert.deepEqual(events, ["a", "read", "b", "read"]);
});

test("PWA mutations: false acknowledgements fail rather than pretending to save", () => {
  assert.throws(() => requireSaved({ saved: false }), /did not confirm/);
  assert.doesNotThrow(() => requireSaved({ saved: true }));
});

const fixture = JSON.parse(readFileSync(new URL("./fixtures/household.json", import.meta.url), "utf8"));
function card(item: ReconciliationCase, options: Record<string, unknown> = {}) {
  const invoiceById = new Map<string, ReimbursementItem>(fixture.state.Items.map((source: ReimbursementItem) => [source.Id, source]));
  return renderToString(createElement(ClaimCard, {
    item, invoiceById, unmatched: [], paired: true, manualActionsAvailable: true, busy: false,
    savingId: "", selecting: false, selected: false, toggleSelected() {}, changeWorkflow: async () => {},
    decideMatch: async () => {}, matchUnmatched: async () => true, changeUnmatchedIgnored: async () => true,
    openInvoicePdf: async () => {}, ...options
  }));
}

test("PWA claim card keeps named insurer amounts, confidence and direct workflow control", () => {
  const html = card(fixture.state.Reconciliations[0]);
  assert.match(html, /Desjardins/); assert.match(html, /Blue Cross/); assert.match(html, /88%/);
  assert.match(html, /Status for Maple Wellness/); assert.match(html, /Details/);
  assert.doesNotMatch(html, /type="checkbox"/);
});

test("PWA claim card preserves unknown amounts instead of rendering artificial zeroes", () => {
  const item = { ...fixture.state.Reconciliations[0], OriginalAmount: null, PotentialRemaining: null,
    PrimaryInsurer: undefined, SecondaryInsurer: undefined, PrimaryReimbursedAmount: null,
    SecondaryReimbursedAmount: null, DesjardinsReimbursedAmount: null, BlueCrossReimbursedAmount: null,
    MatchAssignments: [], DocumentIds: [], ExpenseDocumentIds: [] };
  const html = card(item);
  assert.match(html, /<small>Expense<\/small><strong>—<\/strong>/);
  assert.match(html, /<small>Remaining<\/small><strong>—<\/strong>/);
});

test("PWA insurer-only claims cannot fabricate manual Open or Closed workflow options", () => {
  const html = card({ ...fixture.state.Reconciliations[0], InferredFromInsurer: true });
  assert.match(html, /value="automatic"/); assert.match(html, /value="ignore"/);
  assert.doesNotMatch(html, /value="open"/); assert.doesNotMatch(html, /value="closed"/);
});

test("PWA selection checkboxes are opt-in and pending status is explicit", () => {
  const html = card(fixture.state.Reconciliations[0], { selecting: true, pending: { key: "a", label: "Closed", phase: "saving" } });
  assert.match(html, /type="checkbox"/); assert.match(html, /Saving…/); assert.match(html, /disabled=""/);
});

test("missing-source review shows linked claim details, unknown money and original document actions without mutation controls", () => {
  const claim = fixture.state.Reconciliations[0];
  const source = { ...fixture.state.Items[0], BilledAmount: null, Healthcare: { ...fixture.state.Items[0].Healthcare, OriginalBilledAmount: null } };
  const other = { ...claim, Id: "another-claim", WorkflowOrigin: "manual" as const, WorkflowStatus: "closed" as const };
  const html = renderToString(createElement(NearbySources, { claim, kind: "invoices", onKindChange() {}, items: [source], cases: [other],
    ignoredIds: new Set([source.Id]), paired: true, savingId: "", openPdf: async () => {} }));
  assert.match(html, /10 days before or after/);
  assert.match(html, /Linked to another claim/);
  assert.match(html, /Manual decision/);
  assert.match(html, /Not recorded/);
  assert.match(html, /Ignored source/);
  assert.match(html, /View PDF/);
  assert.doesNotMatch(html, />Match|>Close claim|>Ignore<|>Submit/);
});

test("PWA matching offers only worker expenses and disables nearby-date assignments", () => {
  const expense = fixture.state.Reconciliations[0];
  const source = fixture.state.Items.find(item => item.Id === expense.ExpenseDocumentId)!;
  const statement = { ...source, Id: "synthetic-unmatched", DocumentRole: "insurer-statement" as const, DocumentType: "claim" as const,
    ReimbursedAmount: 20, Insurer: "desjardins" as const };
  const render = (date: string | null | undefined) => renderToString(createElement(ReconciliationQueue, {
    items: [...fixture.state.Items, statement], cases: [
      { ...expense, ServiceDate: date },
      { ...expense, Id: "display-only", Provider: "Display-only insurer summary", InferredFromInsurer: true },
      { ...expense, Id: "retained", Provider: "Retained stale case", PreviouslyFound: true }
    ], unmatched: [{ item: statement, result: { DocumentId: statement.Id, Reason: "ambiguous-match" } }],
    ignoredUnmatched: [], personScope: "all", paired: true, manualActionsAvailable: true, busy: false, savingId: "",
    onPersonScopeChange() {}, onMatch: async () => true, onIgnore: async () => true
  }));
  const exact = render(expense.ServiceDate);
  assert.match(exact, /<button[^>]*class="mini-button primary"[^>]*>Match to this expense/);
  assert.doesNotMatch(exact, /Display-only insurer summary|Retained stale case/);
  const nearby = render("2026-09-02");
  assert.match(nearby, /Matching requires the same service date/);
  assert.match(nearby, /class="mini-button primary" disabled=""/);
});

test("missing invoice popup offers explicit linking only for a current unmatched payment and eligible invoice", () => {
  const expense = { ...fixture.state.Reconciliations[0], MatchAssignments: [], DocumentIds: [fixture.state.Reconciliations[0].ExpenseDocumentId] };
  const invoice = fixture.state.Items.find(item => item.Id === expense.ExpenseDocumentId)!;
  const payment = { ...invoice, Id: "payment-to-link", Insurer: "blue-cross", DocumentRole: "insurer-statement", DocumentType: "claim" };
  const claim = { ...expense, Id: "insurer-evidence:payment-to-link", DocumentIds: [payment.Id], InferredFromInsurer: true, OriginalInvoiceMissing: true };
  const render = (unmatchedIds: Set<string>, paired = true) => renderToString(createElement(NearbySources, {
    claim, kind: "invoices", onKindChange() {}, items: [invoice, payment], cases: [expense], ignoredIds: new Set(),
    paired, savingId: "", manualActionsAvailable: true, unmatchedIds, openPdf: async () => {}, onLink: async () => true
  }));
  assert.match(render(new Set([payment.Id])), />Link this invoice</);
  assert.match(render(new Set([payment.Id]), false), /class="mini-button primary" disabled=""/);
  assert.match(render(new Set()), /class="mini-button" disabled="">Link this invoice/);
  assert.match(render(new Set()), /no longer unmatched/);
});

test("nearby insurer tabs expose reimbursement linking on an invoice-backed claim", () => {
  const expense = { ...fixture.state.Reconciliations[0], MatchAssignments: [], DocumentIds: [fixture.state.Reconciliations[0].ExpenseDocumentId] };
  const invoice = fixture.state.Items.find(item => item.Id === expense.ExpenseDocumentId)!;
  for (const kind of ["blue-cross", "desjardins"] as const) {
    const payment = { ...invoice, Id: "payment", Insurer: kind, DocumentRole: "insurer-statement", DocumentType: "claim", ReimbursedAmount: 40 };
    const render = (unmatchedIds: Set<string>, paired = true) => renderToString(createElement(NearbySources, {
      claim: expense, kind, onKindChange() {}, items: [invoice, payment], cases: [expense], ignoredIds: new Set(),
      paired, savingId: "", manualActionsAvailable: true, unmatchedIds, openPdf: async () => {}, onLink: async () => true
    }));
    const html = render(new Set([payment.Id]));
    assert.match(html, /class="mini-button primary">Link this reimbursement/);
    assert.ok(html.indexOf("Link this reimbursement") < html.indexOf("No current expense link recorded"), "primary action appears above link history");
    assert.match(render(new Set([payment.Id]), false), /class="mini-button primary" disabled=""/);
    assert.match(render(new Set()), /disabled="">Link this reimbursement/);
    assert.match(render(new Set()), /no longer unmatched/);
  }
});

test("missing service date still shows nearby insurer records using a labeled document-date search", () => {
  const source = fixture.state.Items[0];
  const expense = { ...fixture.state.Reconciliations[0], ServiceDate: null, MatchAssignments: [], DocumentIds: [source.Id], ExpenseDocumentId: source.Id, ExpenseDocumentIds: [source.Id] };
  const invoice = { ...source, ServiceDate: null, Healthcare: { StatementDate: "2026-09-01" } };
  const payment = { ...source, Id: "payment", ServiceDate: "2026-09-01", Insurer: "blue-cross", DocumentRole: "insurer-statement", DocumentType: "claim" };
  const html = renderToString(createElement(NearbySources, { claim: expense, kind: "blue-cross", onKindChange() {}, items: [invoice, payment], cases: [expense],
    ignoredIds: new Set(), paired: true, savingId: "", manualActionsAvailable: true, unmatchedIds: new Set([payment.Id]), openPdf: async () => {}, onLink: async () => true }));
  assert.match(html, /Search date \(review only\)/);
  assert.match(html, /Starting from the document date/);
  assert.match(html, /not a confirmed service date/);
  assert.match(html, /class="mini-button primary">Link this reimbursement/);
  assert.doesNotMatch(html, /Choose a search date to compare/);
});

test("eligible claim card names the known next insurer and preserves the preparation gate", () => {
 const item = { ...fixture.state.Reconciliations[0], WorkflowStatus: "open", NextInsurer: "Desjardins", InferredFromInsurer: false };
 const html = card(item, { prepareClaim() {} });
 assert.match(html, /Prepare Desjardins claim/);
 assert.doesNotMatch(html, /Prepare Blue Cross claim/);
 assert.match(card(item, { prepareClaim() {}, paired: false }), /disabled=""[^>]*>Prepare Desjardins claim/);
 assert.doesNotMatch(card({ ...item, InferredFromInsurer: true }, { prepareClaim() {} }), /Prepare Desjardins claim/);
});
