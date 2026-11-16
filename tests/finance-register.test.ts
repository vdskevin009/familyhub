import test from "node:test";
import assert from "node:assert/strict";
import { reconcileFinanceRegister, filterFinanceRegister } from "../apps/web/src/finance-register.ts";
import type { FinanceState, FinanceTransaction } from "../apps/worker/src/finance-model.ts";
import type { SourceExpenseRow, SourceExpensesSnapshot } from "../apps/worker/src/finance-source-expenses-model.ts";

const transaction = (id: string, amount = 10000, change: Partial<FinanceTransaction> = {}): FinanceTransaction => ({
  id, accountId: "fixture-card", date: "2030-01-15", description: "FICTION GROCERY", currency: "CAD",
  outflowCents: amount, status: "posted", occurrence: 1, fingerprint: id, hints: [], sources: [{ name: "fiction.csv" }], ...change,
});
const state = (rows = [transaction("old")]): FinanceState => ({
  schema: 1, revision: "fixture", importedAt: "2030-02-01T00:00:00Z", decisions: {}, decisionHistory: [], imports: [],
  data: { scope: { from: "2030-01-01", to: "2030-02-28" }, collectedOn: "2030-02-01", transactions: rows,
    accounts: [{ id: "fixture-card", identity: "fixture-card", name: "Fiction card", type: "credit-card", currency: "CAD", balanceCents: null, asOf: "", source: { name: "fixture" } }],
    activities: [], pendingCount: 0, holdings: [], performance: [], gics: [], feeReports: [], coverage: [], limits: [],
  },
});
const source = (sourceKey = "source-row", change: Partial<SourceExpenseRow> = {}): SourceExpenseRow => ({
  sourceKey, accountSourceKey: "source-card", pendingSourceKey: null, date: "2030-01-15", description: "FICTION GROCERY",
  outflowCents: 10000, currency: "CAD", pending: false, category: { primary: "groceries", detailed: null, confidence: "HIGH" }, linkedTransfer: false, ...change,
});
const capture = (rows = [source()], collectedAt = "2030-02-01T12:00:00Z"): SourceExpensesSnapshot => ({
  schemaVersion: 1, source: "finances-plugin", collectedAt, evidenceSha256: collectedAt,
  accounts: [{ sourceKey: "source-card", name: "Fiction card" }], query: { from: "2030-01-01", through: "2030-02-01", accountSourceKeys: ["source-card"], includeTransfers: true },
  coverage: { complete: true, hasMore: false, sourceAsOf: null, warningCodes: [] }, rows,
});
const bindings = { accounts: { "source-card": "fixture-card" }, transactions: { "source-row": "old" } };
const filter = { from: "2030-01-01", to: "2030-01-31", currency: "CAD" };

test("same capture and repeated collection corroborate one ledger transaction without mutating inputs", () => {
  const original = state(), first = capture(), second = capture(undefined, "2030-02-02T12:00:00Z");
  const before = JSON.stringify({ original, first, second });
  const register = reconcileFinanceRegister(original, [second, first, first], bindings);
  const result = filterFinanceRegister(register, filter);
  assert.equal(result.netCents, 10000);
  assert.equal(result.included.length, 1);
  assert.equal(register.provenance.get("old")!.length, 2);
  assert.equal(result.unresolved.length, 0);
  assert.equal(JSON.stringify({ original, first, second }), before);
});

test("matching names, dates and amounts do not imply an account or transaction binding", () => {
  const original = state();
  const unknown = filterFinanceRegister(reconcileFinanceRegister(original, [capture()]), filter);
  assert.equal(unknown.netCents, 10000);
  assert.equal(unknown.unresolved[0].reason, "unmapped-account");
  const accountOnly = filterFinanceRegister(reconcileFinanceRegister(original, [capture()], { ...bindings, transactions: {} }), filter);
  assert.equal(accountOnly.unresolved[0].reason, "unmapped-transaction");
  assert.equal(accountOnly.hasUnreconciledSources, true);
  assert.equal(accountOnly.complete, false);
});

test("binding validates account, date, currency, amount and posted state", () => {
  for (const change of [{ accountId: "another" }, { date: "2030-01-16" }, { currency: "USD" }, { outflowCents: 9000 }, { status: "pending" }]) {
    const register = reconcileFinanceRegister(state([transaction("old", 10000, change)]), [capture()], bindings);
    assert.equal(register.unresolved[0].reason, "invalid-binding");
    assert.equal(register.provenance.size, 0);
  }
});

test("two source identities cannot silently bind to the same ledger row", () => {
  const register = reconcileFinanceRegister(state(), [capture([source(), source("other-source")])], {
    accounts: bindings.accounts, transactions: { ...bindings.transactions, "other-source": "old" },
  });
  assert.equal(register.provenance.size, 0);
  assert.deepEqual(register.unresolved.map(row => row.reason), ["competing-bindings", "competing-bindings"]);
  assert.equal(filterFinanceRegister(register, filter).netCents, 10000);
});

test("conflicting versions preserve both source observations without overwriting history", () => {
  const register = reconcileFinanceRegister(state(), [capture(), capture([source("source-row", { outflowCents: 9500 })], "2030-02-02T12:00:00Z")], bindings);
  assert.equal(register.unresolved[0].reason, "conflicting-source-facts");
  assert.equal(register.unresolved[0].observations.length, 2);
  assert.equal(register.state.data!.transactions[0].outflowCents, 10000);
  assert.equal(register.provenance.size, 0);
});

test("collection dates, nullable bank timestamps, transaction date and native categories stay distinct", () => {
  const first = capture(), second = capture([source("source-row", { category: { primary: "shopping", detailed: null, confidence: "LOW" } })], "2030-02-02T12:00:00Z");
  second.coverage.sourceAsOf = "2030-01-31";
  const register = reconcileFinanceRegister(state(), [first, second], bindings);
  const provenance = register.provenance.get("old")!;
  assert.equal(provenance[0].sourceAsOf, null);
  assert.equal(provenance[1].sourceAsOf, "2030-01-31");
  assert.equal(provenance[1].collectedAt, "2030-02-02T12:00:00Z");
  assert.equal(provenance[1].row.date, "2030-01-15");
  assert.equal(provenance[0].row.category.primary, "groceries");
  assert.equal(provenance[1].row.category.primary, "shopping");
  assert.equal(filterFinanceRegister(register, filter).categories.find(row => row.key === "groceries")!.count, 1);
});

test("only an explicit valid cross-capture posted link suppresses pending, retaining its provenance", () => {
  const pending = source("pending-row", { pending: true, outflowCents: 9900 });
  const posted = source("source-row", { pendingSourceKey: pending.sourceKey });
  const register = reconcileFinanceRegister(state(), [capture([pending]), capture([posted], "2030-02-02T12:00:00Z")], bindings);
  assert.equal(register.pending.length, 0);
  assert.equal(register.supersededPending.size, 1);
  assert.equal(register.provenance.get("old")!.length, 2);
  assert.equal(filterFinanceRegister(register, filter).netCents, 10000);
  for (const changed of [{ accountSourceKey: "another-account" }, { currency: "USD" }]) {
    const invalid = reconcileFinanceRegister(state(), [capture([pending]), capture([{ ...posted, ...changed }], "2030-02-02T12:00:00Z")], bindings);
    assert.equal(invalid.pending.length, 1);
    assert.equal(invalid.supersededPending.size, 0);
  }
});

test("shared business rules preserve refunds and exclude each transfer, repayment, investment and duplicate", () => {
  const original = state([transaction("old"), transaction("refund", -2000), transaction("transfer", 50000), transaction("repayment", -50000), transaction("investment", 30000), transaction("duplicate", 10000)]);
  for (const [id, nature, category] of [["refund", "refund", "groceries"], ["transfer", "transfer", "other"], ["repayment", "repayment", "other"], ["investment", "investment", "savings-investments"], ["duplicate", "duplicate", "other"]] as const) {
    original.decisions[id] = { nature, category, note: "Fiction reviewed decision", updatedAt: "2030-02-01T00:00:00Z" };
  }
  const result = filterFinanceRegister(reconcileFinanceRegister(original, [capture()], bindings), filter);
  assert.equal(result.netCents, 8000);
  assert.deepEqual(result.included.map(row => row.id), ["old", "refund"]);
  assert.equal(result.savings.outgoingCents, 30000);
});

test("explicit historical decisions win over native source classification", () => {
  const original = state();
  original.decisions.old = { nature: "transfer", category: "other", note: "Fiction", updatedAt: "2030-02-01T00:00:00Z" };
  const result = filterFinanceRegister(reconcileFinanceRegister(original, [capture()], bindings), filter);
  assert.equal(result.included.length, 0);
  assert.equal(result.rows[0].nature, "transfer");
  assert.equal(result.rows[0].reviewed, true);
});

test("month, currency, account, search, category and review filters share category/detail/total membership", () => {
  const original = state([transaction("old"), transaction("later", 5000, { date: "2030-02-01" }), transaction("usd", 2000, { currency: "USD" }), transaction("another", 3000, { accountId: "another" })]);
  const register = reconcileFinanceRegister(original, [capture()], bindings);
  for (let repeat = 0; repeat < 3; repeat++) {
    const scoped = filterFinanceRegister(register, { ...filter, accountId: "fixture-card", search: "fiction", category: "groceries" });
    assert.equal(scoped.netCents, 10000);
    assert.equal(scoped.categories.reduce((sum, category) => sum + category.count, 0), scoped.included.length);
    assert.deepEqual(scoped.included.map(row => row.id), ["old"]);
    assert.equal(filterFinanceRegister(register, { ...filter, from: "2030-02-01", to: "2030-02-28", accountId: "fixture-card" }).netCents, 5000);
    assert.equal(filterFinanceRegister(register, { ...filter, currency: "USD" }).netCents, 2000);
    assert.equal(filterFinanceRegister(register, { ...filter, search: "missing" }).netCents, null);
  }
});

test("missing data is null; an observed offsetting expense and refund is a genuine zero", () => {
  assert.equal(filterFinanceRegister(reconcileFinanceRegister({ ...state(), data: null }, []), filter).netCents, null);
  assert.equal(filterFinanceRegister(reconcileFinanceRegister(state([]), [capture()]), filter).netCents, null);
  const original = state([transaction("old"), transaction("refund", -10000)]);
  const result = filterFinanceRegister(reconcileFinanceRegister(original, []), filter);
  assert.equal(result.netCents, 0);
  assert.equal(result.included.length, 2);
});

test("review-only selection and category detail cannot include a filtered-out confirmed payment", () => {
  const original = state([transaction("old"), transaction("review", 2500)]);
  original.decisions.old = { nature: "expense", category: "groceries", note: "Fiction", updatedAt: "2030-02-01T00:00:00Z" };
  const register = reconcileFinanceRegister(original, [capture()], bindings);
  const result = filterFinanceRegister(register, { ...filter, reviewOnly: true, category: "groceries" });
  assert.equal(result.netCents, 2500);
  assert.deepEqual(result.included.map(row => row.id), ["review"]);
  assert.equal(result.categories.find(row => row.key === "groceries")!.count, 1);
});
