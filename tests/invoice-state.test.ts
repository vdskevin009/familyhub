import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInvoiceHistoryCases,
  filterInvoiceHistoryCases,
  mergeInvoiceItems,
  mergeReconciliationHistory,
  unreconciledInvoiceCases
} from "../apps/web/src/invoice-state.ts";
import {
  ReimbursementCategory,
  ReimbursementStatus,
  type ReconciliationCase,
  type ReimbursementItem
} from "../apps/web/src/types.ts";

function invoice(id: string, serviceDate: string, overrides: Partial<ReimbursementItem> = {}): ReimbursementItem {
  return {
    Id: id,
    AccountLabel: "Kevin",
    AccountEmail: "kevin@example.test",
    SourceMessageId: `message-${id}`,
    ThreadId: `thread-${id}`,
    InternetMessageId: `<${id}@example.test>`,
    Subject: `Invoice ${id}`,
    Sender: "clinic@example.test",
    Provider: "Example Clinic",
    ReceivedAt: `${serviceDate}T12:00:00.000Z`,
    Category: ReimbursementCategory.HealthBenefit,
    Status: ReimbursementStatus.ToReview,
    DetectedAmount: 100,
    Currency: "CAD",
    Confidence: 99,
    Notes: "",
    Attachments: [],
    DocumentType: "invoice",
    WorkerManaged: true,
    NeedsReview: false,
    ReimbursementEligibility: "possible",
    Member: "Kevin",
    DocumentRole: "expense",
    ServiceDate: serviceDate,
    BilledAmount: 100,
    ...overrides
  };
}

function reconciliation(item: ReimbursementItem, overrides: Partial<ReconciliationCase> = {}): ReconciliationCase {
  return {
    Id: `case:${item.Id}`,
    Member: item.Member ?? "unknown",
    Provider: item.Provider,
    ServiceDate: item.ServiceDate ?? null,
    OriginalAmount: item.BilledAmount ?? item.DetectedAmount,
    ReimbursedAmount: 0,
    PotentialRemaining: item.BilledAmount ?? item.DetectedAmount,
    Currency: item.Currency,
    NextInsurer: null,
    Action: "review-amount",
    Status: "needs-attention",
    Summary: "Regression fixture",
    Confidence: 99,
    DocumentIds: [item.Id],
    ...overrides
  };
}

test("invoice history survives sorting, temporary filters, reconciliation refreshes and partial worker snapshots", () => {
  const september17 = invoice("invoice-2026-09-17", "2026-09-17");
  const september20 = invoice("invoice-2026-09-20", "2026-09-20");
  const september25 = invoice("invoice-2026-09-25", "2026-09-25");

  const initialItems = mergeInvoiceItems([], [september17, september20, september25]);
  const initialCases = mergeReconciliationHistory([], [
    reconciliation(september17, {
      Status: "fully-reimbursed",
      Action: "complete",
      PrimaryInsurer: "Desjardins",
      PrimaryReimbursedAmount: 80,
      SecondaryInsurer: "Blue Cross",
      SecondaryReimbursedAmount: 20,
      ReimbursedAmount: 100,
      PotentialRemaining: 0
    }),
    reconciliation(september20, {
      Status: "waiting-primary",
      Action: "submit-primary",
      NextInsurer: "Desjardins"
    })
  ], initialItems);

  const initiallyUnreconciled = unreconciledInvoiceCases(initialCases, initialItems);
  assert.deepEqual(initiallyUnreconciled.flatMap(item => item.DocumentIds), [september25.Id]);

  const newestFirst = buildInvoiceHistoryCases(initialCases, initialItems);
  assert.deepEqual(newestFirst.map(item => item.DocumentIds[0]), [
    september25.Id,
    september20.Id,
    september17.Id
  ]);
  assert.equal(newestFirst.length, 3);
  assert.equal(new Set(newestFirst.flatMap(item => item.DocumentIds)).size, 3);

  const fullyReimbursedOnly = filterInvoiceHistoryCases(newestFirst, new Set(["fully-reimbursed"]));
  assert.deepEqual(fullyReimbursedOnly.map(item => item.DocumentIds[0]), [september17.Id]);

  const filtersCleared = filterInvoiceHistoryCases(newestFirst, new Set());
  assert.deepEqual(filtersCleared.map(item => item.DocumentIds[0]), newestFirst.map(item => item.DocumentIds[0]));

  const partialSnapshotItems = mergeInvoiceItems(initialItems, [{
    ...september20,
    Subject: "Invoice invoice-2026-09-20 refreshed",
    UpdatedAt: "2026-09-27T12:00:00.000Z"
  }]);
  assert.equal(partialSnapshotItems.length, 3, "a partial worker snapshot must not erase previously indexed invoices");

  const refreshedSeptember20 = reconciliation(september20, {
    Status: "waiting-primary",
    Action: "submit-primary",
    NextInsurer: "Desjardins"
  });
  const partialSnapshotCases = mergeReconciliationHistory(initialCases, [refreshedSeptember20], partialSnapshotItems);
  const retainedSeptember17 = partialSnapshotCases.find(item => item.DocumentIds.includes(september17.Id));
  assert.equal(retainedSeptember17?.PreviouslyFound, true, "a reconciliation omitted by a partial snapshot must remain reviewable");

  const afterPartialSnapshot = buildInvoiceHistoryCases(partialSnapshotCases, partialSnapshotItems);
  assert.deepEqual(afterPartialSnapshot.map(item => item.DocumentIds[0]), [
    september25.Id,
    september20.Id,
    september17.Id
  ]);
  assert.equal(afterPartialSnapshot.length, 3);
});
