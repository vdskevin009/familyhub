import assert from "node:assert/strict";
import test from "node:test";
import { dateLabel } from "../apps/web/src/domain.ts";
import { healthcareTitle } from "../apps/web/src/invoice-state.ts";
import { healthcareEvidence } from "../apps/worker/dist/healthcare-evidence.js";
import { repairHealthcareAmounts, toInvoice, validateClassification } from "../apps/worker/dist/invoice-model.js";
import { buildReconciliationSnapshot } from "../apps/worker/dist/reconciliation.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Synthetic clinics, invoices and amounts reproduce the source shapes without private records.
const mail = (id = "copy", day = "16", service = "RMT - Follow Up Massage") => ({
  id, threadId: "test", internetMessageId: `<${id}@example.test>`,
  subject: "Fwd: Your Receipt - Example Clinic", sender: "Kevin Vanderstraeten <test@example.test>",
  receivedAt: "2026-07-19T01:30:00Z", labels: [], attachments: [], unsubscribe: false, bulk: false,
  text: `Items\nJuly ${day}, 2026 - 1:15pm, ${service}\nInvoice #EXAMPLE-${day}\nAmount not covered: $60.00\nDESJARDINS INSURANCE\n$57.14\nSubtotal $57.14\nGST $2.86\nPayer Total $60.00\nPayments\nFriday July 17, 2026 - 2:30pm Visa - Kevin Vanderstraeten - $60.00\nUpcoming Appointments\nJuly 30, 2026 - 1:15pm, Physiotherapy`,
  attachmentText: ""
});
const classification = { kind: "receipt", confidence: .97, transaction: true, reimbursement: "unknown", reason: "Synthetic",
  amount: 200, currency: "CAD", category: "health", member: "Kevin", documentRole: "expense", insurer: null,
  serviceDate: null, billedAmount: 200, reimbursedAmount: null };
const receipt = (source = mail()) => toInvoice(source, "test@example.test", "Test", classification, "codex");
const statement = (overrides = {}) => ({ ...receipt(), Id: "desj", AccountLabel: "Local Desjardins import",
  Provider: "Desjardins · Massothérapeute - visite subséquente", Healthcare: undefined, ClaimedService: undefined,
  DocumentType: "claim", DocumentRole: "insurer-statement", Insurer: "desjardins", ServiceDate: "2026-07-16",
  BilledAmount: null, DetectedAmount: 140, ReimbursedAmount: 140, Notes: "Submitted 200.00; admissible 180.00; paid 140.00; unpaid 60.00;",
  ReceivedAt: "2026-07-19T00:00:00Z", ...overrides });

test("calendar dates retain their day in western, eastern and extreme time zones; timestamps remain local", () => {
  const old = process.env.TZ;
  try {
    for (const tz of ["America/Vancouver", "America/Los_Angeles", "UTC", "Europe/Brussels", "Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
      process.env.TZ = tz;
      for (const value of ["2026-08-18", "2026-08-20", "2026-01-01", "2024-02-29"]) {
        assert.equal(dateLabel(value), new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined,
          { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" }));
      }
      const timestamp = "2026-08-20T01:00:00Z";
      assert.equal(dateLabel(timestamp), new Date(timestamp).toLocaleDateString(undefined,
        { weekday: "short", month: "short", day: "numeric", year: "numeric" }));
    }
    assert.equal(dateLabel("2026-02-30"), "2026-02-30");
    assert.equal(dateLabel("invalid"), "invalid");
    assert.throws(() => validateClassification({ ...classification, serviceDate: "2026-02-30" }));
  } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
});

test("forwarded Jane receipt separates clinic, patient, billed service and payment date", () => {
  const item = receipt();
  assert.equal(item.Provider, "Example Clinic");
  assert.equal(item.Member, "Kevin");
  assert.equal(item.ServiceDate, "2026-07-16");
  assert.equal(item.Healthcare.ServiceType, "RMT - Follow Up Massage");
  assert.equal(item.BilledAmount, null);
  assert.equal(item.Healthcare.InsurerPayments?.desjardins, undefined, "a Visa - $60 line is not insurer payment");
  assert.equal(healthcareTitle({ Provider: "Kevin Vanderstraeten", ServiceType: "Massage therapy" }), "Massage therapy");
  assert.equal(healthcareTitle({ Provider: "Kevin" }), "Provider to confirm");
  assert.equal(healthcareTitle({ Provider: "Kevin's Clinic", ServiceType: "Massage therapy" }), "Kevin's Clinic");
});

test("legacy submitted/service fields enrich one receipt with traceable gross amount and payment", () => {
  const original = receipt(mail("original"));
  const forwarded = receipt(mail("forwarded"));
  const source = statement();
  const evidence = healthcareEvidence(source);
  assert.equal(evidence.SubmittedAmount, 200);
  assert.equal(evidence.ServiceType, "Massothérapeute - visite subséquente");
  assert.equal(evidence.Provider, null);
  assert.equal(evidence.PaymentDate, "2026-07-19");
  const result = buildReconciliationSnapshot([original, forwarded, source]);
  assert.equal(result.cases.length, 1);
  assert.equal(result.unmatched.length, 0);
  const entry = result.cases[0];
  assert.deepEqual([entry.OriginalAmount, entry.PrimaryReimbursedAmount, entry.SecondaryReimbursedAmount, entry.PotentialRemaining], [200, 140, 0, 60]);
  assert.equal(entry.DocumentIds.length, 3);
  assert.equal(entry.Evidence.OriginalAmount.source, "desj");
  assert.equal(entry.Evidence.OriginalAmount.confidence, "reconstructed");
});

test("plain email plus whitespace-flattened PDF recovers the billed date and ignores header/payment/upcoming dates", () => {
  const source = { ...mail(), text: "Your receipt.\nJuly 16, 2026 - 1:15pm, RMT - Follow Up Massage\nSubtotal $57.14\nPayments Visa - Kevin - $60.00",
    attachmentText: "Example Clinic Receipt Items and Payments Items Details Amount July 16, 2026 - 1:15pm, RMT - Follow Up Massage Luis Example RMT, License #TEST Invoice #EXAMPLE-16 Amount not covered: $60.00 Desjardins $57.14 Subtotal $57.14 Payer Total $60.00 Payments July 17, 2026 - 2:30pm Visa - Kevin - $60.00 Upcoming Appointments July 30, 2026 - 1:15pm, Physiotherapy" };
  const item = receipt(source);
  assert.equal(item.ServiceDate, "2026-07-16");
  assert.equal(item.Healthcare.ServiceType, "RMT - Follow Up Massage");
  assert.equal(item.Healthcare.InvoiceNumber, "EXAMPLE-16");
  assert.equal(item.Healthcare.InsurerPayments?.desjardins, undefined);
});

test("known zero primary reimbursement stays confirmed and secondary subtracts from the same expense", () => {
  const expense = receipt(mail("chiro", "14", "20 min Chiropractic Return"));
  const primary = statement({ ServiceDate: "2026-07-14", Provider: "Desjardins · Chiropraticien - visite subséquente",
    ReimbursedAmount: 0, DetectedAmount: 0, Notes: "Submitted 60.00; paid 0.00;" });
  const secondary = statement({ Id: "bc", AccountLabel: "Test", StructuredSource: "blue-cross-portal", ServiceDate: "2026-07-14",
    Provider: "Blue Cross · Chiropractic", ClaimedService: "Chiropractic", Insurer: "blue-cross", BilledAmount: 60,
    ReimbursedAmount: 44, DetectedAmount: 44 });
  const result = buildReconciliationSnapshot([expense, secondary, primary]);
  assert.equal(result.cases.length, 1);
  assert.equal(result.unmatched.length, 0);
  const entry = result.cases[0];
  assert.deepEqual([entry.OriginalAmount, entry.PrimaryReimbursedAmount, entry.SecondaryReimbursedAmount, entry.PotentialRemaining], [60, 0, 44, 16]);
  assert.equal(entry.Evidence.PrimaryPaid.value, 0);
  assert.equal(entry.Evidence.PrimaryPaid.confidence, "confirmed");
  assert.equal(entry.Status, "patient-balance");
});

test("the collector repairs forwarded receipts resumably without classification or decision changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "familyhub-healthcare-repair-"));
  try {
    const result = spawnSync(process.execPath, ["tests/fixtures/healthcare-repair-runner.mjs"],
      { cwd: new URL("..", import.meta.url), env: { ...process.env, FAMILYHUB_WORKER_DATA: dir }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("conflicting service/member/date and tied expenses never auto-link even when residual arithmetic agrees", () => {
  for (const patch of [{ Provider: "Desjardins · Physiothérapeute" }, { Member: "Jasmine" }, { ServiceDate: "2026-07-15" }]) {
    assert.equal(buildReconciliationSnapshot([receipt(), statement(patch)]).unmatched.length, 1);
  }
  const second = { ...receipt(mail("distinct")), Healthcare: { ...receipt().Healthcare, InvoiceNumber: "DISTINCT" } };
  const tied = buildReconciliationSnapshot([receipt(), second, statement()]);
  assert.equal(tied.cases.length, 2);
  assert.equal(tied.unmatched[0].Reason, "ambiguous-match");
});

test("source repair replaces stale patient/provider/date/payment facts while preserving decisions and identity", () => {
  const item = { ...receipt(), Provider: "Kevin Vanderstraeten", ServiceDate: null, ClaimedService: undefined,
    BilledAmount: 57.14, DetectedAmount: 57.14, CorrectedAt: "2026-07-18", LastDecisionId: "manual", Status: 2,
    Healthcare: { OriginalBilledAmount: 57.14, PatientBalance: 0, InsurerPayments: { desjardins: 60 } } };
  const repaired = repairHealthcareAmounts(item, mail());
  assert.equal(repaired.Provider, "Example Clinic");
  assert.equal(repaired.ServiceDate, "2026-07-16");
  assert.equal(repaired.BilledAmount, null);
  assert.equal(repaired.Healthcare.PatientBalance, 60);
  assert.equal(repaired.Healthcare.InsurerPayments.desjardins, undefined);
  for (const field of ["Id", "SourceMessageId", "Status", "Member", "NeedsReview", "ReimbursementEligibility", "ClassificationSource", "CorrectedAt", "LastDecisionId"])
    assert.equal(repaired[field], item[field]);
});
