import type { SavingsContract } from "../savings";
import { insuranceExport, type InsuranceReference } from "../../../worker/src/insurance-reference";
import "../insurance-reference.css";
const status = { documented: "Documented", historical: "Historical", unknown: "Needs review", preparing: "Draft · not sent", sent: "Sent · awaiting quote", awaiting_quote: "Awaiting quote", received: "Quote received", expired: "Expired" };
const certainty = { documented: "Documented", reported: "Reported", unknown: "Unknown", conflict: "Needs clarification" };
const kind = { policy: "Policy", "strata-certificate": "Strata · building", membership: "Membership", "quote-request": "Quote request", quote: "Dated quote" };
const comparison = { unassessed: "Not assessed", partial: "Partial", "reviewed-comparable": "Reviewed as comparable" };
const scope = { original: "Original document", capture: "Partial screenshots", historical: "Historical evidence", payment: "Observed payment", statement: "Declaration", quote: "Quote received", advertisement: "Advertisement" };
const verification = { "parent-verified": "Reported verification", "locally-read": "Document reviewed here", unverified: "Needs review" };
function download(contract: SavingsContract) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(insuranceExport(contract), null, 2)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = "private-insurance-records.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Proofs({ reference, ids }: { reference: InsuranceReference; ids: string[] }) {
  return <ul>{ids.map(id => { const s = reference.sources.find(s => s.id === id)!; return <li key={id}><strong>{s.title}</strong> · {s.date || "source date unknown"} · {scope[s.scope]} · {verification[s.verification]}<br /><span className="insurance-source-reference">{s.reference}</span></li>; })}</ul>;
}
export default function InsuranceReferenceDetails({ contract }: { contract: SavingsContract }) {
  const reference = contract.insuranceReference; if (!reference) return null;
  return <section className="insurance-reference view-stack" aria-label="Insurance records">
    <header><h3>Insurance records</h3><p className="muted">Saved on the shared PC · recorded on {reference.updatedAt}. Missing information and partial evidence are identified.</p><button className="button secondary" onClick={() => download(contract)}>Export private records (JSON)</button></header>
    <p className="muted">This export contains private information. It is not sent to insurers or used in public research.</p>
    {reference.records.map(r => <details className="savings-checklist insurance-record" key={r.id}>
      <summary><span>{r.title}<small>{kind[r.kind]} · {status[r.status]}{reference.records.some(next => next.supersedes === r.id) ? " · previous version retained" : ""}</small></span></summary>
      <p><strong>{r.provider}</strong>{r.effectiveFrom || r.effectiveTo ? ` · period ${r.effectiveFrom || "unknown"} → ${r.effectiveTo || "unknown"}` : " · period to verify"}</p>
      {r.kind === "quote-request" && <p>No quote received or price confirmed. Request {r.requestedOn ? `dated ${r.requestedOn}` : "not sent"}.</p>}
      {r.kind === "quote" && <p>Received {r.receivedOn} · valid until {r.validUntil || "date unknown"} · annual premium {r.quotedAnnualPremium === null ? "unknown" : `${r.quotedAnnualPremium} CAD`} · comparison: {comparison[r.comparison]}.</p>}
      <dl className="insurance-facts">{r.facts.map(f => <div key={f.code}><dt>{f.label}</dt><dd><strong>{f.value === null ? "Unknown" : typeof f.value === "number" ? new Intl.NumberFormat("en-CA", { maximumFractionDigits: 5 }).format(f.value) : typeof f.value === "boolean" ? f.value ? "Yes" : "No" : f.value}{f.value !== null && f.unit ? ` ${f.unit}` : ""}</strong><small>{certainty[f.certainty]}</small>{f.notes && <p>{f.notes}</p>}<details><summary>Evidence and definition</summary><p>Key: {f.code}</p><Proofs reference={reference} ids={f.sourceIds} /></details></dd></div>)}</dl>
      {!!r.assumptions.length && <><h4>Assumptions</h4><ul>{r.assumptions.map((s, i) => <li key={i}>{s}</li>)}</ul></>}
      {!!r.differences.length && <><h4>Comparison differences</h4><ul>{r.differences.map((s, i) => <li key={i}>{s}</li>)}</ul></>}
      {!!r.limitations.length && <><h4>Limitations and open questions</h4><ul>{r.limitations.map((s, i) => <li key={i}>{s}</li>)}</ul></>}
      <details><summary>Record sources</summary><Proofs reference={reference} ids={r.sourceIds} /></details>
    </details>)}
  </section>;
}
