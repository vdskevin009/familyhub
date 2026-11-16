import { useState } from "react";
import type { filterFinanceRegister, RegisterObservation } from "../finance-register";
import { displayFinanceCapture } from "./FinanceCollectionNote";

const reasons = { "unmapped-account": "Compte à rapprocher", "unmapped-transaction": "Opération à rapprocher", "conflicting-source-facts": "Versions contradictoires à vérifier", "invalid-binding": "Correspondance à vérifier", "competing-bindings": "Correspondances concurrentes à vérifier" };
export function RegisterProvenance({observations}: {observations: RegisterObservation[]}) {
  if (!observations.length) return null;
  return <details><summary>Provenance et collectes ({observations.length})</summary>{observations.map((observation,index)=><p key={index}>Collecté le {displayFinanceCapture(observation.collectedAt)}. Mise à jour bancaire : {observation.sourceAsOf ?? "inconnue"}. Opération du {observation.row.date}. Catégorie source : {observation.row.category.primary ?? "inconnue"}. Montant : {new Intl.NumberFormat("fr-CA",{style:"currency",currency:observation.row.currency}).format(-observation.row.outflowCents/100)}.</p>)}</details>;
}
export default function FinanceRegisterSources({ result }: { result: ReturnType<typeof filterFinanceRegister> }) {
  const entries = [...result.unresolved.map(item => ({ key: item.sourceKey, observations: item.observations, label: reasons[item.reason] })), ...result.pending.map(observations => ({ key: observations.at(-1)!.row.sourceKey, observations, label: "En attente" }))];
  const scope = entries.map(e=>e.key).join("|");
  const [pagination,setPagination] = useState({scope,limit:20});
  const limit = pagination.scope===scope ? pagination.limit : 20;
  if (!entries.length) return null;
  return <section className="finance-unresolved" aria-label="Opérations à rapprocher ou en attente"><h3>À rapprocher ou en attente</h3><p>Ces opérations restent hors du sous-total jusqu’au rapprochement. Une ressemblance de nom ou de montant ne prouve pas une correspondance. Leur catégorie source reste une indication.</p>
    <ul className="finance-source-register">{entries.sort((a,b)=>b.observations.at(-1)!.row.date.localeCompare(a.observations.at(-1)!.row.date)||a.key.localeCompare(b.key)).slice(0,limit).map(item => {
      const latest = item.observations.at(-1)!;
      return <li key={item.key}><div><strong>{latest.row.description}</strong><span>{latest.row.date} · {item.label} · Hors total</span><RegisterProvenance observations={item.observations}/></div><strong>{new Intl.NumberFormat("fr-CA",{style:"currency",currency:latest.row.currency}).format(-latest.row.outflowCents/100)}</strong></li>;
    })}</ul>{limit<entries.length && <button type="button" className="button secondary" onClick={()=>setPagination({scope,limit:limit+20})}>Voir les opérations source suivantes ({entries.length-limit})</button>}
  </section>;
}
