import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, FileCheck2, RefreshCw } from "lucide-react";
import { claimDossierReadiness } from "../../../worker/src/claim-readiness";
import { claimAction, type ClaimPreparation } from "../worker";
import type { WorkerConfig } from "../types";
import { Notice, SkeletonList } from "../ui/primitives";

/** Reads the existing preview only: never opens a portal or starts preparation. */
export default function ClaimDossier({ expenseId, initialInsurer, config, remaining, sourceRevision, preparationAllowed, onPrepare }: {
  expenseId: string; initialInsurer?: "blue-cross" | "desjardins"; config: WorkerConfig;
  remaining?: number | null; sourceRevision: string; preparationAllowed: boolean; onPrepare: (insurer: "blue-cross" | "desjardins") => void;
}) {
  const [insurer, setInsurer] = useState(initialInsurer || "");
  const [loaded, setLoaded] = useState<{ key: string; dossier: ClaimPreparation }>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false), [retry, setRetry] = useState(0);
  const key = JSON.stringify([expenseId, insurer, config.Endpoint, config.ApiKey, sourceRevision]);
  const dossier = loaded?.key === key ? loaded.dossier : undefined;
  useEffect(() => {
    let active = true;
    setLoaded(undefined); setError("");
    if (!insurer || !config.Endpoint || !config.ApiKey) { setLoading(false); return; }
    setLoading(true);
    void claimAction<ClaimPreparation>(config, "preview", { expenseId, insurer }).then(value => {
      if (active) setLoaded({ key, dossier: value });
    }).catch(() => { if (active) setError("The PC could not refresh this claim. The evidence may be out of date."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [key, retry]);
  // Derive from the received facts, including with a worker predating this view.
  const readiness = dossier && claimDossierReadiness(dossier);
  const money = (value: number | null | undefined) => {
    if (value == null || !Number.isFinite(value)) return "Unknown";
    if (!dossier?.currency) return `${value.toFixed(2)} · unknown currency`;
    try { return new Intl.NumberFormat("en-CA", { style: "currency", currency: dossier.currency }).format(value); }
    catch { return `${value.toFixed(2)} · verify currency`; }
  };
  const needs = readiness?.checks.filter(c => c.state === "missing" || c.state === "blocked") ?? [];
  return <section className="claim-dossier" aria-labelledby="claim-dossier-title" aria-busy={loading}>
    <div className="claim-dossier-heading"><FileCheck2 size={21} aria-hidden="true" /><div><h2 id="claim-dossier-title">Evidence and next action</h2><p>Review what is known and what still needs to be checked in the insurer portal.</p></div></div>
    {!initialInsurer && <label>Insurer to review<select value={insurer} onChange={e => setInsurer(e.target.value)}><option value="">Choose an insurer</option><option value="blue-cross">Blue Cross</option><option value="desjardins">Desjardins</option></select></label>}
    {!config.Endpoint || !config.ApiKey ? <Notice>Connect your PC to refresh the evidence. Saved records are still available.</Notice> : !insurer ? <Notice>Insurer order is not confirmed. Choose a claim to review. This choice does not set the order.</Notice> : null}
    {loading && <SkeletonList label="Loading reimbursement evidence" />}
    {error && <Notice error>{error}<button type="button" className="button secondary" onClick={() => setRetry(x => x + 1)}><RefreshCw size={16} aria-hidden="true" />Refresh evidence</button></Notice>}
    {dossier && readiness && <>
      <div className="claim-dossier-facts" aria-label="Claim amounts"><div><span>{dossier.originalAmountEvidence?.confidence === "reconstructed" ? "Reconstructed gross amount" : "Gross claim amount"}</span><strong>{money(dossier.fields.originalAmount)}</strong></div><div><span>Paid by other insurer</span><strong>{money(dossier.fields.otherInsurancePaid)}</strong></div><div><span>Remaining to review</span><strong>{money(remaining)}</strong></div></div>
      <p className="claim-dossier-limit">The remaining balance is not confirmed. An unknown amount is not zero.</p>
      <div className={`claim-dossier-state ${readiness.status === "blocked" ? "caution" : ""}`}><span>{readiness.status === "blocked" ? "Evidence needs clarification" : readiness.status === "needs-information" ? "Claim needs information" : "Available facts"}</span><strong>{readiness.nextAction}</strong></div>
      {needs.length > 0 && <ul className="claim-dossier-needs">{needs.slice(0, 3).map(check => <li key={check.id}><AlertTriangle size={16} aria-hidden="true" /><span><strong>{check.label}</strong>{check.detail}</span></li>)}</ul>}
      <details className="claim-dossier-checks"><summary>Evidence, checks and sources · {readiness.checks.length}</summary><ul>{readiness.checks.map(check => <li key={check.id}><span className={`claim-check-state ${check.state}`}>{check.state === "available" ? <CheckCircle2 size={17} aria-hidden="true" /> : <AlertTriangle size={17} aria-hidden="true" />}{check.state === "available" ? "Known" : check.state === "blocked" ? "Blocking" : check.state === "missing" ? "Missing" : "Needs review"}</span><strong>{check.label}</strong>{check.value != null && <p className="claim-check-value">{check.value}</p>}<p>{check.detail}</p></li>)}</ul></details>
      <p className="claim-dossier-limit">Recent history and pending claims have not been checked. Confirm the reviewed fields and that attachments were added in the insurer portal. Your final approval is still required.</p>
      {!preparationAllowed && <Notice>This claim is no longer open. Its decisions are saved, but you cannot start a new preparation from this preview.</Notice>}
      <button type="button" className="button" disabled={dossier.blocked || !preparationAllowed} onClick={() => onPrepare(insurer as "blue-cross" | "desjardins")}>{readiness.status === "needs-information" ? "Prepare known values" : "Prepare on the PC"}<ChevronRight size={17} aria-hidden="true" /></button>
    </>}
  </section>;
}
