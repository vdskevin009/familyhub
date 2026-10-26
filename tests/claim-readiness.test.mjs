import test from "node:test";
import assert from "node:assert/strict";
import { claimDossierReadiness } from "../apps/worker/dist/claim-readiness.js";
import { prepareClaim } from "../apps/worker/dist/claim-preparation.js";

function dossier() {
  return { insurer: "blue-cross", blocked: false, currency: "CAD", fields: { patient: "Synthetic person", provider: "Synthetic clinic", practitioner: "Synthetic therapist", serviceDate: "2027-03-01", originalAmount: 150, service: "Physiotherapy - 30 Min Follow Up Visit (30 minutes)", otherInsurancePaid: 90 }, missing: [], conflicts: [], reviewableWarnings: [], attachments: [{ documentId: "synthetic-source", attachmentId: "synthetic-pdf", name: "synthetic-receipt.pdf" }], duplicate: { status: "not-verified" }, coordination: { required: true, ready: true, primaryInsurer: "Desjardins", importedStatementAvailable: true, ownerConfirmation: null } };
}
const check = (r, id) => r.checks.find(c => c.id === id);

test("complete source facts are never portal, history, upload or submission proof", () => {
  const p = dossier(), before = structuredClone(p), r = claimDossierReadiness(p);
  assert.equal(r.status, "source-ready");
  for (const key of ["portalHistoryVerified", "portalValuesVerified", "uploadVerified", "submitAllowed"]) assert.equal(r[key], false);
  assert.equal(check(r, "portal-history").state, "unverified");
  assert.equal(check(r, "primary-statement").state, "unverified");
  assert.equal(check(r, "patient").value, "Synthetic person");
  assert.equal(check(r, "originalAmount").value, 150);
  assert.match(check(r, "primary-statement").detail, /PDF officiel.*vérifier/);
  assert.deepEqual(p, before);
});

test("zero primary payment is known; unknown is not zero or a completed secondary dossier", () => {
  const p = dossier(); p.fields.otherInsurancePaid = 0;
  assert.equal(check(claimDossierReadiness(p), "primary-payment").state, "available");
  p.fields.otherInsurancePaid = null;
  const r = claimDossierReadiness(p);
  assert.equal(r.status, "needs-information"); assert.equal(check(r, "primary-payment").state, "missing");
  assert.equal(p.fields.otherInsurancePaid, null);
  p.coordination.required = false;
  assert.equal(check(claimDossierReadiness(p), "primary-payment"), undefined);
});

test("owner confirmation cannot become an insurer statement or attached explanation", () => {
  const p = dossier(); p.coordination.ownerConfirmation = { amount: 90 }; p.coordination.importedStatementAvailable = false;
  const r = claimDossierReadiness(p);
  assert.equal(check(r, "primary-payment").state, "available");
  assert.match(check(r, "primary-payment").detail, /confirmé par vous/);
  assert.equal(check(r, "primary-statement").state, "unverified");
  assert.match(check(r, "primary-statement").detail, /Aucun décompte importé/);
});

test("local possible, pending and recorded evidence blocks readiness", () => {
  for (const status of ["possible", "recorded", "unknown-status"]) {
    const p = dossier(); p.duplicate.status = status;
    assert.equal(claimDossierReadiness(p).status, "blocked");
  }
  const p = dossier(); p.blocked = true;
  assert.equal(claimDossierReadiness(p).status, "blocked");
});

test("missing original, identity, valid date, amount, currency or order stays visible", () => {
  for (const change of [p => p.attachments = [], p => p.fields.patient = null, p => p.fields.patient = "unknown", p => p.fields.serviceDate = "2027-02-30", p => p.fields.serviceDate = "2027-03-01junk", p => p.fields.originalAmount = null, p => p.fields.originalAmount = NaN, p => p.currency = null, p => p.currency = "USD", p => p.coordination.primaryInsurer = null]) {
    const p = dossier(); change(p); const r = claimDossierReadiness(p);
    assert.equal(r.status, "needs-information"); assert.ok(r.checks.some(c => c.state === "missing"));
  }
});

test("receipt copies are candidates, never proof of a unique original or successful upload", () => {
  const p = dossier(); p.attachments.push({ ...p.attachments[0], documentId: "synthetic-copy" });
  const r = claimDossierReadiness(p);
  assert.equal(r.status, "source-ready"); assert.match(check(r, "receipt").detail, /^2 fichier.*identifier et vérifier/);
  assert.equal(r.uploadVerified, false);
});

test("reconstructed gross and old previews with unknown provenance do not become confirmed amounts", () => {
  const p = dossier(); p.originalAmountEvidence = { source: "synthetic-primary-statement", confidence: "reconstructed" };
  assert.equal(check(claimDossierReadiness(p), "amount-basis").state, "unverified");
  assert.match(check(claimDossierReadiness(p), "amount-basis").detail, /Brut reconstruit/);
  delete p.originalAmountEvidence;
  assert.match(check(claimDossierReadiness(p), "amount-basis").detail, /non qualifiée/);
});

test("known unsupported service and reviewable source warning are distinct", () => {
  const p = dossier(); p.fields.service = "Synthetic unobserved therapy";
  const r = claimDossierReadiness(p);
  assert.equal(r.status, "needs-information"); assert.equal(check(r, "service-support").state, "missing");
  const q = dossier(); q.conflicts = q.reviewableWarnings = ["Synthetic corroborated warning"];
  assert.equal(claimDossierReadiness(q).status, "source-ready");
  assert.equal(check(claimDossierReadiness(q), "source-review").state, "unverified");
  q.conflicts = [...q.conflicts, "Synthetic conflicting date"];
  assert.equal(claimDossierReadiness(q).status, "blocked");
});

test("the existing preview adds a checklist while preserving source fields and manual records", () => {
  const expense = { Id: "synthetic-expense", Category: 0, DocumentRole: "expense", Member: "Kevin", Currency: "CAD", Provider: "Synthetic clinic", ServiceDate: "2027-03-01", Attachments: [{ Id: "pdf", FileName: "synthetic.pdf", MimeType: "application/pdf" }], Healthcare: { ServiceType: "Physiotherapy - 30 Min Follow Up Visit (30 minutes)" } };
  const entry = { Id: "synthetic-case", DocumentIds: [expense.Id], Member: "Kevin", Currency: "CAD", PrimaryInsurer: "Desjardins", OriginalAmount: 150, DesjardinsReimbursedAmount: 90, MatchAssignments: [], WorkflowStatus: "open", OwnerAdjudications: [], ManualStatus: "open" };
  const before = structuredClone([expense, entry]);
  const p = prepareClaim(expense.Id, "blue-cross", [expense], [entry]);
  assert.equal(p.fields.originalAmount, 150); assert.equal(p.fields.otherInsurancePaid, 90);
  assert.equal(p.readiness.status, "source-ready"); assert.equal(p.blocked, false); assert.equal(p.submitAllowed, false);
  assert.deepEqual([expense, entry], before);
});
