import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInvoiceHistoryCases,
  excludeAssignedUnmatched,
  filterInvoiceHistoryCases,
  filterReimbursementWorkflowCases,
  insurerEvidenceExpenseCases,
  mergeInvoiceItems,
  mergeReconciliationHistory,
  namedInsurerReimbursementAmount,
  reimbursementInvoiceDocument,
  reimbursementInvoicePdfOptions,
  reimbursementInvoiceUrl,
  reimbursementActionLabel,
  reimbursementEvidenceSources,
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
import { manualReconciliationWorkerVersion, workerVersionAtLeast } from "../apps/web/src/worker.ts";
import {
  reconciliationContextCases,
  reconciliationTriageAssessment
} from "../apps/web/src/reconciliation-triage.ts";

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

test("invoice PDF action resolves only when a linked PDF is actually archived", () => {
  const archivedPdf = invoice("expense-with-pdf", "2026-09-20", {
    DriveFileId: "drive-file-123",
    Attachments: [{ Id: "a1", FileName: "invoice.pdf", MimeType: "application/pdf", Size: 1234 }]
  });
  const caseWithPdf = reconciliation(archivedPdf, { ExpenseDocumentId: archivedPdf.Id });
  const byId = new Map([[archivedPdf.Id, archivedPdf]]);
  assert.equal(reimbursementInvoiceDocument(caseWithPdf, byId)?.Id, archivedPdf.Id);
  assert.equal(reimbursementInvoiceUrl(archivedPdf), "https://drive.google.com/file/d/drive-file-123/view");

  const noPdf = invoice("expense-without-pdf", "2026-09-21", {
    DriveFileId: "drive-file-image",
    Attachments: [{ Id: "a2", FileName: "receipt.jpg", MimeType: "image/jpeg", Size: 100 }]
  });
  assert.equal(reimbursementInvoiceDocument(reconciliation(noPdf), new Map([[noPdf.Id, noPdf]])), null);
});


test("invoice PDF options prefer Drive, support private worker PDFs and stay absent without a PDF", () => {
  const drivePdf = invoice("drive-pdf", "2026-09-20", {
    DriveFileId: "drive-123",
    Attachments: [{ Id: "drive-a", FileName: "clinic-invoice.pdf", MimeType: "application/pdf", Size: 1200 }]
  });
  const driveCase = reconciliation(drivePdf, { ExpenseDocumentId: drivePdf.Id });
  assert.deepEqual(reimbursementInvoicePdfOptions(driveCase, new Map([[drivePdf.Id, drivePdf]])), [{
    ItemId: drivePdf.Id,
    AttachmentIndex: 0,
    FileName: "clinic-invoice.pdf",
    Source: "drive",
    Url: "https://drive.google.com/file/d/drive-123/view"
  }]);

  const workerPdf = invoice("worker-pdf", "2026-09-21", {
    DriveFileId: undefined,
    WorkerManaged: true,
    Attachments: [{ Id: "worker-a", FileName: "receipt.pdf", MimeType: "application/pdf", Size: 900 }]
  });
  const workerCase = reconciliation(workerPdf, { ExpenseDocumentId: workerPdf.Id });
  assert.deepEqual(reimbursementInvoicePdfOptions(workerCase, new Map([[workerPdf.Id, workerPdf]])), [{
    ItemId: workerPdf.Id,
    AttachmentIndex: 0,
    FileName: "receipt.pdf",
    Source: "worker"
  }]);

  const noPdf = invoice("no-pdf-option", "2026-09-22", {
    WorkerManaged: true,
    Attachments: [{ Id: "image-a", FileName: "receipt.jpg", MimeType: "image/jpeg", Size: 800 }]
  });
  assert.deepEqual(reimbursementInvoicePdfOptions(reconciliation(noPdf), new Map([[noPdf.Id, noPdf]])), []);

  const multiple = invoice("multi-pdf", "2026-09-23", {
    WorkerManaged: true,
    Attachments: [
      { Id: "m1", FileName: "invoice-front.pdf", MimeType: "application/pdf", Size: 500 },
      { Id: "m2", FileName: "invoice-detail.PDF", MimeType: "application/octet-stream", Size: 600 },
      { Id: "m3", FileName: "logo.png", MimeType: "image/png", Size: 100 }
    ]
  });
  const options = reimbursementInvoicePdfOptions(reconciliation(multiple, { ExpenseDocumentId: multiple.Id }), new Map([[multiple.Id, multiple]]));
  assert.deepEqual(options.map(option => [option.FileName, option.AttachmentIndex, option.Source]), [
    ["invoice-front.pdf", 0, "worker"],
    ["invoice-detail.PDF", 1, "worker"]
  ]);
  assert.equal(multiple.Attachments.length, 3, "resolving PDF actions must not mutate reimbursement evidence");
});

test("worker version guard requires manual reconciliation endpoints", () => {
  assert.equal(manualReconciliationWorkerVersion, "2.8.0");
  assert.equal(workerVersionAtLeast("2.7.0", manualReconciliationWorkerVersion), false);
  assert.equal(workerVersionAtLeast("2.8.0", manualReconciliationWorkerVersion), true);
  assert.equal(workerVersionAtLeast("2.8.1", manualReconciliationWorkerVersion), true);
  assert.equal(workerVersionAtLeast("3.0.0", manualReconciliationWorkerVersion), true);
});


test("reconciliation triage ranks one evidence-supported expense as the strong candidate", () => {
  const primary = invoice("triage-primary", "2026-09-12", {
    Provider: "Harbour Physiotherapy",
    Healthcare: { Provider: "Harbour Physiotherapy", ServiceType: "Physiotherapy" },
    BilledAmount: 120,
    DetectedAmount: 120
  });
  const nearby = invoice("triage-nearby", "2026-09-17", {
    Provider: "Other Clinic",
    Healthcare: { Provider: "Other Clinic", ServiceType: "Massage" },
    BilledAmount: 100,
    DetectedAmount: 100
  });
  const reimbursement = invoice("triage-reimbursement", "2026-09-12", {
    DocumentRole: "insurer-statement",
    DocumentType: "claim",
    Insurer: "desjardins",
    Provider: "Harbour Physiotherapy",
    Healthcare: { Provider: "Harbour Physiotherapy", ServiceType: "Physiotherapy" },
    ClaimedService: "Physiotherapy",
    BilledAmount: 120,
    ReimbursedAmount: 96,
    DetectedAmount: 96
  });
  const cases = [
    reconciliation(primary, { ExpenseDocumentId: primary.Id, Provider: "Harbour Physiotherapy", ServiceType: "Physiotherapy", OriginalAmount: 120 }),
    reconciliation(nearby, { ExpenseDocumentId: nearby.Id, Provider: "Other Clinic", ServiceType: "Massage", OriginalAmount: 100 })
  ];
  const byId = new Map([primary, nearby, reimbursement].map(item => [item.Id, item]));
  const assessment = reconciliationTriageAssessment(reimbursement, cases, byId);

  assert.equal(assessment.Kind, "strong");
  assert.equal(assessment.Candidates[0].Case.Id, "case:triage-primary");
  assert.ok(assessment.Candidates[0].Reasons.includes("Same family member"));
  assert.ok(assessment.Candidates[0].Reasons.includes("Exact service date"));
  assert.ok(assessment.Candidates[0].Reasons.includes("Submitted amount matches expense"));
});

test("reconciliation triage keeps tied same-day expenses ambiguous instead of choosing", () => {
  const first = invoice("triage-ambiguous-a", "2026-02-06", {
    Provider: "North Shore Chiropractic",
    Healthcare: { Provider: "North Shore Chiropractic", ServiceType: "Chiropractic" },
    BilledAmount: 80
  });
  const second = invoice("triage-ambiguous-b", "2026-02-06", {
    Provider: "North Shore Chiropractic",
    Healthcare: { Provider: "North Shore Chiropractic", ServiceType: "Chiropractic" },
    BilledAmount: 80
  });
  const reimbursement = invoice("triage-ambiguous-r", "2026-02-06", {
    DocumentRole: "insurer-statement",
    DocumentType: "claim",
    Insurer: "blue-cross",
    Provider: "North Shore Chiropractic",
    Healthcare: { Provider: "North Shore Chiropractic", ServiceType: "Chiropractic" },
    BilledAmount: 80,
    ReimbursedAmount: 64,
    DetectedAmount: 64
  });
  const cases = [
    reconciliation(first, { ExpenseDocumentId: first.Id, Provider: first.Provider, ServiceType: "Chiropractic", OriginalAmount: 80 }),
    reconciliation(second, { ExpenseDocumentId: second.Id, Provider: second.Provider, ServiceType: "Chiropractic", OriginalAmount: 80 })
  ];
  const byId = new Map([first, second, reimbursement].map(item => [item.Id, item]));
  const assessment = reconciliationTriageAssessment(reimbursement, cases, byId);

  assert.equal(assessment.Kind, "ambiguous");
  assert.equal(assessment.Candidates.length, 2);
  assert.equal(assessment.Candidates[0].Score, assessment.Candidates[1].Score);
});

test("reconciliation triage returns no candidate when person/date/evidence do not support one", () => {
  const expense = invoice("triage-none", "2026-01-01", {
    Member: "Kevin",
    Provider: "Example Dental",
    Healthcare: { Provider: "Example Dental", ServiceType: "Dental" },
    BilledAmount: 300
  });
  const reimbursement = invoice("triage-none-r", "2026-09-29", {
    Member: "Jasmine",
    DocumentRole: "insurer-statement",
    DocumentType: "claim",
    Insurer: "blue-cross",
    Provider: "Different Provider",
    Healthcare: { Provider: "Different Provider", ServiceType: "Vision" },
    BilledAmount: 90,
    ReimbursedAmount: 70,
    DetectedAmount: 70
  });
  const assessment = reconciliationTriageAssessment(
    reimbursement,
    [reconciliation(expense, { ExpenseDocumentId: expense.Id, Member: "Kevin", Provider: expense.Provider, ServiceType: "Dental", OriginalAmount: 300 })],
    new Map([expense, reimbursement].map(item => [item.Id, item]))
  );
  assert.equal(assessment.Kind, "none");
  assert.deepEqual(assessment.Candidates, []);
});

test("reconciliation context stays within the same member and thirty-day service window", () => {
  const current = invoice("triage-context-r", "2026-09-15", {
    Member: "Jasmine",
    DocumentRole: "insurer-statement",
    DocumentType: "claim",
    Insurer: "blue-cross"
  });
  const nearby = invoice("triage-context-near", "2026-09-01", { Member: "Jasmine" });
  const far = invoice("triage-context-far", "2026-07-01", { Member: "Jasmine" });
  const otherMember = invoice("triage-context-kevin", "2026-09-15", { Member: "Kevin" });
  const cases = [
    reconciliation(nearby, { ExpenseDocumentId: nearby.Id, Member: "Jasmine" }),
    reconciliation(far, { ExpenseDocumentId: far.Id, Member: "Jasmine" }),
    reconciliation(otherMember, { ExpenseDocumentId: otherMember.Id, Member: "Kevin" })
  ];
  const byId = new Map([current, nearby, far, otherMember].map(item => [item.Id, item]));
  assert.deepEqual(reconciliationContextCases(current, cases, byId).map(item => item.Id), ["case:triage-context-near"]);
});


test("trusted insurer reimbursement evidence becomes a visible expense without an emailed invoice", () => {
  const blueCross = invoice("bc-only-full", "2026-09-28", {
    DocumentRole: "insurer-statement",
    DocumentType: "claim",
    Insurer: "blue-cross",
    StructuredSource: "blue-cross-portal",
    Provider: "Blue Cross · Physiotherapy",
    ClaimedService: "Physiotherapy",
    BilledAmount: 150,
    ReimbursedAmount: 150,
    DetectedAmount: 150,
    NeedsReview: false
  });
  const [projected] = insurerEvidenceExpenseCases([], [{ DocumentId: blueCross.Id, Reason: "no-expense-match" }], [blueCross]);

  assert.ok(projected);
  assert.equal(projected.InferredFromInsurer, true);
  assert.equal(projected.OriginalInvoiceMissing, true);
  assert.equal(projected.OriginalAmount, 150);
  assert.equal(projected.ReimbursedAmount, 150);
  assert.equal(projected.PotentialRemaining, 0);
  assert.equal(reimbursementWorkflowStatus(projected), "closed");
  assert.equal(reimbursementActionLabel(projected), "No reimbursement action needed");
  assert.deepEqual(reimbursementEvidenceSources(projected, new Map([[blueCross.Id, blueCross]])), ["Blue Cross"]);
});

test("partial insurer-only expense stays open and asks for the other-insurer check", () => {
  const blueCross = invoice("bc-only-partial", "2026-09-28", {
    DocumentRole: "insurer-statement",
    DocumentType: "claim",
    Insurer: "blue-cross",
    StructuredSource: "blue-cross-portal",
    Provider: "Blue Cross · Massage therapy",
    ClaimedService: "Massage therapy",
    BilledAmount: 150,
    ReimbursedAmount: 100,
    DetectedAmount: 100,
    NeedsReview: false
  });
  const [projected] = insurerEvidenceExpenseCases([], [{ DocumentId: blueCross.Id, Reason: "no-expense-match" }], [blueCross]);

  assert.ok(projected);
  assert.equal(projected.PotentialRemaining, 50);
  assert.equal(reimbursementWorkflowStatus(projected), "open");
  assert.equal(reimbursementActionLabel(projected), "Check other insurer reimbursement");
});

test("insurer-only projection remains conservative for ambiguous or incomplete source rows", () => {
  const review = invoice("bc-review", "2026-09-28", {
    DocumentRole: "insurer-statement", DocumentType: "claim", Insurer: "blue-cross",
    StructuredSource: "blue-cross-portal", BilledAmount: 150, ReimbursedAmount: 100, NeedsReview: true
  });
  const missingOriginal = invoice("bc-no-original", "2026-09-28", {
    DocumentRole: "insurer-statement", DocumentType: "claim", Insurer: "blue-cross",
    StructuredSource: "blue-cross-portal", BilledAmount: null, ReimbursedAmount: 100, NeedsReview: false
  });
  const unknownMember = invoice("bc-unknown-member", "2026-09-28", {
    Member: "unknown", DocumentRole: "insurer-statement", DocumentType: "claim", Insurer: "blue-cross",
    StructuredSource: "blue-cross-portal", BilledAmount: 150, ReimbursedAmount: 100, NeedsReview: false
  });
  const unmatched = [review, missingOriginal, unknownMember].map(item => ({ DocumentId: item.Id, Reason: "no-expense-match" as const }));
  assert.deepEqual(insurerEvidenceExpenseCases([], unmatched, [review, missingOriginal, unknownMember]), []);
});

test("email and insurer evidence appear as separate sources on the same expense", () => {
  const expense = invoice("expense-with-email-source", "2026-09-26", {
    DocumentRole: "expense",
    DocumentType: "invoice",
    BilledAmount: 150
  });
  const blueCross = invoice("linked-blue-cross", "2026-09-26", {
    DocumentRole: "insurer-statement",
    DocumentType: "claim",
    Insurer: "blue-cross",
    StructuredSource: "blue-cross-portal",
    BilledAmount: 150,
    ReimbursedAmount: 100,
    DetectedAmount: 100
  });
  const item = reconciliation(expense, {
    MatchAssignments: [{
      ExpenseDocumentId: expense.Id,
      ReimbursementDocumentId: blueCross.Id,
      Insurer: "blue-cross",
      Confidence: 95,
      Verification: "auto",
      Evidence: ["same person", "same date"]
    }]
  });
  assert.deepEqual(reimbursementEvidenceSources(item, new Map([[expense.Id, expense], [blueCross.Id, blueCross]])), ["Email", "Blue Cross"]);
});
