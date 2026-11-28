import { useState } from "react";
import type { filterFinanceRegister, RegisterObservation } from "../finance-register";
import { displayFinanceCapture } from "./FinanceCollectionNote";

const reasons = { "unmapped-account": "Account needs reconciliation", "unmapped-transaction": "Transaction needs reconciliation", "conflicting-source-facts": "Check conflicting versions", "invalid-binding": "Check match", "competing-bindings": "Check competing matches" };
export function RegisterProvenance({observations}: {observations: RegisterObservation[]}) {
  if (!observations.length) return null;
  return <details><summary>Sources and collections ({observations.length})</summary>{observations.map((observation,index)=><p key={index}>Collected on {displayFinanceCapture(observation.collectedAt)}. Bank update: {observation.sourceAsOf ?? "unknown"}. Transaction from {observation.row.date}. Source category: {observation.row.category.primary ?? "unknown"}. Amount: {new Intl.NumberFormat("en-CA",{style:"currency",currency:observation.row.currency}).format(-observation.row.outflowCents/100)}.</p>)}</details>;
}
export default function FinanceRegisterSources({ result }: { result: ReturnType<typeof filterFinanceRegister> }) {
  const entries = [...result.unresolved.map(item => ({ key: item.sourceKey, observations: item.observations, label: reasons[item.reason] })), ...result.pending.map(observations => ({ key: observations.at(-1)!.row.sourceKey, observations, label: "Pending" }))];
  const scope = entries.map(e=>e.key).join("|");
  const [pagination,setPagination] = useState({scope,limit:20});
  const limit = pagination.scope===scope ? pagination.limit : 20;
  if (!entries.length) return null;
  return <section className="finance-unresolved" aria-label="Unreconciled or pending transactions"><h3>Unreconciled or pending</h3><p>These transactions are excluded from the subtotal until reconciled. A similar name or amount does not establish a match. The source category is only a suggestion.</p>
    <ul className="finance-source-register">{entries.sort((a,b)=>b.observations.at(-1)!.row.date.localeCompare(a.observations.at(-1)!.row.date)||a.key.localeCompare(b.key)).slice(0,limit).map(item => {
      const latest = item.observations.at(-1)!;
      return <li key={item.key}><div><strong>{latest.row.description}</strong><span>{latest.row.date} · {item.label} · Excluded from total</span><RegisterProvenance observations={item.observations}/></div><strong>{new Intl.NumberFormat("en-CA",{style:"currency",currency:latest.row.currency}).format(-latest.row.outflowCents/100)}</strong></li>;
    })}</ul>{limit<entries.length && <button type="button" className="button secondary" onClick={()=>setPagination({scope,limit:limit+20})}>View more source transactions ({entries.length-limit})</button>}
  </section>;
}
