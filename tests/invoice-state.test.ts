import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInvoiceHistoryCases,
  excludeAssignedUnmatched,
  filterInvoiceHistoryCases,
  filterReimbursementWorkflowCases,
  mergeInvoiceItems,
  mergeReconciliationHistory,
  namedInsurerReimbursementAmount,
  reimbursementInvoiceDocument,
  reimbursementInvoiceAttachmentIndex,
  reimbursementInvoiceUrl,
  reimbursementWorkflowStatus,
  reimbursementWorkflowSummary,
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


test("workflow summaries are person-scoped and exclude Closed/Ignore from recoverable totals", () => {
  const kevinOpenInvoice = invoice("kevin-open", "2026-09-26", { Member: "Kevin" });
  const kevinClosedInvoice = invoice("kevin-closed", "2026-09-25", { Member: "Kevin" });
  const jasmineIgnoredInvoice = invoice("jasmine-ignore", "2026-09-24", { Member: "Jasmine" });
  const nathanOpenInvoice = invoice("nathan-open", "2026-09-23", { Member: "Nathan" });

  const cases = [
    reconciliation(kevinOpenInvoice, { WorkflowStatus: "open", WorkflowOrigin: "automatic", PotentialRemaining: 38 }),
    reconciliation(kevinClosedInvoice, { WorkflowStatus: "closed", WorkflowOrigin: "manual", PotentialRemaining: 50 }),
    reconciliation(jasmineIgnoredInvoice, { WorkflowStatus: "ignore", WorkflowOrigin: "manual", PotentialRemaining: 75 }),
    reconciliation(nathanOpenInvoice, { WorkflowStatus: "open", WorkflowOrigin: "automatic", PotentialRemaining: null })
  ];

  assert.deepEqual(reimbursementWorkflowSummary(cases, "all"), { open: 2, potentiallyRecoverable: 38 });
  assert.deepEqual(reimbursementWorkflowSummary(cases, "Kevin"), { open: 1, potentiallyRecoverable: 38 });
  assert.deepEqual(reimbursementWorkflowSummary(cases, "Jasmine"), { open: 0, potentiallyRecoverable: 0 });
  assert.deepEqual(filterReimbursementWorkflowCases(cases, "Kevin", "all").map(item => item.DocumentIds[0]), ["kevin-open", "kevin-closed"]);
  assert.deepEqual(filterReimbursementWorkflowCases(cases, "all", "ignore").map(item => item.DocumentIds[0]), ["jasmine-ignore"]);
  assert.equal(reimbursementWorkflowStatus(reconciliation(invoice("legacy-closed", "2026-09-22"), { Status: "fully-reimbursed", Action: "complete" })), "closed");
});


test("Nathan unknown insurer order shows Desjardins and Blue Cross amounts without inventing primary or secondary", () => {
  const expense = invoice("nathan-physio", "2026-05-29", { Member: "Nathan", BilledAmount: 145, DetectedAmount: 145 });
  const desjardins = invoice("nathan-desjardins", "2026-05-29", {
    Member: "Nathan", DocumentRole: "insurer-statement", DocumentType: "claim", Insurer: "desjardins",
    BilledAmount: null, DetectedAmount: 35.36, ReimbursedAmount: 35.36
  });
  const blueCross = invoice("nathan-blue-cross", "2026-05-29", {
    Member: "Nathan", DocumentRole: "insurer-statement", DocumentType: "claim", Insurer: "blue-cross",
    BilledAmount: null, DetectedAmount: 100.8, ReimbursedAmount: 100.8
  });
  const byId = new Map([expense, desjardins, blueCross].map(item => [item.Id, item]));
  const legacyWorkerCase = reconciliation(expense, {
    PrimaryInsurer: null,
    PrimaryReimbursedAmount: 0,
    SecondaryInsurer: null,
    SecondaryReimbursedAmount: 0,
    ReimbursedAmount: 136.16,
    PotentialRemaining: 8.84,
    MatchAssignments: [
      { ExpenseDocumentId: expense.Id, ReimbursementDocumentId: desjardins.Id, Insurer: "desjardins", Confidence: 95, Verification: "auto", Evidence: [] },
      { ExpenseDocumentId: expense.Id, ReimbursementDocumentId: blueCross.Id, Insurer: "blue-cross", Confidence: 95, Verification: "auto", Evidence: [] }
    ]
  });
  assert.equal(namedInsurerReimbursementAmount(legacyWorkerCase, "Desjardins", byId), 35.36);
  assert.equal(namedInsurerReimbursementAmount(legacyWorkerCase, "Blue Cross", byId), 100.8);

  const currentWorkerCase = {
    ...legacyWorkerCase,
    PrimaryReimbursedAmount: null,
    SecondaryReimbursedAmount: null,
    DesjardinsReimbursedAmount: 35.36,
    BlueCrossReimbursedAmount: 100.8
  };
  assert.equal(namedInsurerReimbursementAmount(currentWorkerCase, "Desjardins", byId), 35.36);
  assert.equal(namedInsurerReimbursementAmount(currentWorkerCase, "Blue Cross", byId), 100.8);
});


test("already assigned insurer rows are excluded from stale Unmatched projections", () => {
  const expense = invoice("expense-feb-19", "2026-02-19");
  const insurer = invoice("desjardins-feb-19", "2026-02-19", {
    DocumentRole: "insurer-statement", DocumentType: "claim", Insurer: "desjardins",
    ReimbursedAmount: 72, DetectedAmount: 72
  });
  const matched = reconciliation(expense, {
    MatchAssignments: [{
      ExpenseDocumentId: expense.Id,
      ReimbursementDocumentId: insurer.Id,
      Insurer: "desjardins",
      Confidence: 93,
      Verification: "auto",
      Evidence: ["same member", "same service date"]
    }]
  });
  const unmatched = [
    { DocumentId: insurer.Id, Reason: "no-expense-match" as const },
    { DocumentId: "genuinely-unmatched", Reason: "no-expense-match" as const }
  ];
  assert.deepEqual(excludeAssignedUnmatched(unmatched, [matched]), [unmatched[1]]);
});

test("invoice PDF action uses an archived file or the expense's indexed worker attachment", () => {
  const archivedPdf = invoice("expense-with-pdf", "2026-09-20", {
    DriveFileId: "drive-file-123",
    Attachments: [{ Id: "a1", FileName: "invoice.pdf", MimeType: "application/pdf", Size: 1234 }]
  });
  const caseWithPdf = reconciliation(archivedPdf, { ExpenseDocumentId: archivedPdf.Id });
  const byId = new Map([[archivedPdf.Id, archivedPdf]]);
  assert.equal(reimbursementInvoiceDocument(caseWithPdf, byId)?.Id, archivedPdf.Id);
  assert.equal(reimbursementInvoiceUrl(archivedPdf), "https://drive.google.com/file/d/drive-file-123/view");

  const workerPdf = invoice("worker-expense-pdf", "2026-09-20", {
    Attachments: [{ Id: "source-pdf", FileName: "receipt.pdf", MimeType: "application/pdf", Size: 1234 }]
  });
  const insurerPdf = invoice("insurer-pdf", "2026-09-20", {
    DocumentRole: "insurer-statement",
    Attachments: [{ Id: "claim-pdf", FileName: "claim.pdf", MimeType: "application/pdf", Size: 1234 }]
  });
  const linked = reconciliation(workerPdf, { DocumentIds: [workerPdf.Id, insurerPdf.Id] });
  assert.equal(reimbursementInvoiceDocument(linked, new Map([[workerPdf.Id, workerPdf], [insurerPdf.Id, insurerPdf]]))?.Id, workerPdf.Id);
  assert.equal(reimbursementInvoiceAttachmentIndex(workerPdf), 0);
  assert.equal(reimbursementInvoiceUrl(workerPdf), null);
  assert.equal(reimbursementInvoiceDocument(reconciliation(insurerPdf), new Map([[insurerPdf.Id, insurerPdf]])), null);

  const noPdf = invoice("expense-without-pdf", "2026-09-21", {
    DriveFileId: "drive-file-image",
    Attachments: [{ Id: "a2", FileName: "receipt.jpg", MimeType: "image/jpeg", Size: 100 }]
  });
  assert.equal(reimbursementInvoiceDocument(reconciliation(noPdf), new Map([[noPdf.Id, noPdf]])), null);
});
