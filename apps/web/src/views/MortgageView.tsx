import { useEffect, useState } from "react";
import type { WorkerConfig } from "../types";
import { fetchMortgage } from "../mortgage-api";
import { emptyMortgage, localDate, productKeys, referenceDates, observationOn, snapshotOn, change, negotiatedEstimate, mortgageScenario, type MortgageState, type ProductKey, type Quote, type MortgageAssumptions, currentAssumptions } from "../../../worker/src/mortgage-model";
import "../mortgage.css";
const label = (p: ProductKey) => `${p.startsWith("fixed") ? "Fixe" : "Variable"} ${p.endsWith("3") ? "3" : "5"} ans`;
const percent = (n: number | null | undefined) => n === null || n === undefined ? "Indisponible" : `${n.toFixed(2)} %`;
const cad = (n: number) => new Intl.NumberFormat("fr-CA",{style:"currency",currency:"CAD"}).format(n);
const variantLabel = (variant: Quote["variant"]) => variant === "adjustable-payment" ? "Paiements ajustables" : variant === "fixed-payment" ? "Paiements fixes" : "Taux fixe";
function QuoteIllustration({rate,quote,assumptions:a}:{rate:number;quote:Quote;assumptions:MortgageAssumptions|undefined}) {
  if(!a) return <p>Hypothèses privées indisponibles. Enregistrez les hypothèses sur le PC pour calculer cette illustration.</p>;
  if(quote.variant === "fixed-payment") return <p>Variable à paiements fixes : montant contractuel et règles du prêteur nécessaires pour estimer les versements et intérêts. Aucune économie de trésorerie n’est présumée.</p>;
  const months=quote.product.endsWith("3")?36:60,current=mortgageScenario(a.principal,a.currentRate,a.remainingMonths,months),offer=mortgageScenario(a.principal,rate,a.remainingMonths,months,quote.product.startsWith("variable")?"monthly":"semiannual");
  return <><p>Illustration à taux constant : {cad(a.principal)} et {a.remainingMonths} mois restants supposés, taux actuel fourni {percent(a.currentRate)}, pénalité et frais exclus. Le taux actuel est maintenu sur toute la durée illustrée; son échéance reste à confirmer. {quote.product.startsWith("variable") ? "Capitalisation mensuelle supposée; les versements futurs ne sont pas garantis." : "Capitalisation semestrielle canadienne."}</p><dl className="mortgage-numbers"><div><dt>Versement mensuel illustratif</dt><dd>{cad(offer.payment)}</dd></div><div><dt>Baisse du versement mensuel</dt><dd>{cad(current.payment-offer.payment)}</dd></div><div><dt>Intérêts évités sur {months} mois</dt><dd>{cad(current.interest-offer.interest)}</dd></div></dl></>;
}
export default function MortgageView({ worker }: { worker: WorkerConfig }) {
  const [state,setState]=useState<MortgageState>(emptyMortgage),[error,setError]=useState(""),[busy,setBusy]=useState(true),[reload,setReload]=useState(0),[estimate,setEstimate]=useState(false),[selected,setSelected]=useState<ProductKey>("fixed-5");
  const [today,setToday]=useState(()=>localDate(new Date()));
  useEffect(()=>{ const timer=setInterval(()=>setToday(localDate(new Date())),30000),refresh=setInterval(()=>setReload(n=>n+1),300000); return ()=>{clearInterval(timer);clearInterval(refresh);}; },[]);
  useEffect(()=>{ const controller=new AbortController(); setBusy(true); setError(""); setState(emptyMortgage());
    void fetchMortgage(worker,controller.signal).then(s=>{if(!controller.signal.aborted)setState(s);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);}); return ()=>controller.abort();
  },[worker.Endpoint,worker.ApiKey,reload]);
  const current=snapshotOn(state,today), last=[...state.snapshots].sort((a,b)=>Date.parse(b.collectedAt)-Date.parse(a.collectedAt))[0];
  const chosen=observationOn(state,today,selected);
  const a=currentAssumptions(state);
  const baseline=a ? mortgageScenario(a.principal,a.currentRate,a.remainingMonths,selected.endsWith("3")?36:60) : null;
  const comparison=chosen?.status === "observed" && a ? mortgageScenario(a.principal,chosen.rate!,a.remainingMonths,selected.endsWith("3")?36:60,selected.startsWith("variable")?"monthly":"semiannual") : null;
  return <section className="mortgage" aria-label="Mortgage" lang="fr-CA">
    <header className="mortgage-heading"><div><h1>Mortgage</h1><p>Les taux observés, jour après jour.</p></div><button type="button" disabled={busy} onClick={()=>setReload(n=>n+1)}>Actualiser</button></header>
    <p>Aujourd’hui à Vancouver : <strong>{today}</strong>. Référence conservée : <strong>{state.baselineDate}</strong>.</p>
    <div role="status" aria-live="polite">{busy ? "Chargement de l’historique…" : error || (!current ? `Aucune collecte pour aujourd’hui.${last ? ` Dernière tentative : ${last.localDate}.` : " Aucun historique enregistré."}` : current.status === "failed" ? `Collecte échouée : ${current.error}` : current.status === "partial" ? "Collecte partielle : certains produits sont indisponibles." : "Quatre produits observés aujourd’hui.")}</div>
    <p className="mortgage-caution">Observations publiques filtrées. Admissibilité personnelle, transfert anticipé et traitement assuré / assurable / non assuré à vérifier.</p>
    <div className="mortgage-rates">{productKeys.map(p=>{const o=observationOn(state,today,p);return <article key={p}><h2>{label(p)}</h2><strong>{percent(o?.rate)}</strong><p>{o?.lender || o?.reason || "Aucune observation datée aujourd’hui"}</p></article>;})}</div>
    <h2>Évolution par rapport à aujourd’hui</h2><p>Écart en points de pourcentage. Une date manquante ou des filtres différents ne donnent aucun écart. Faites défiler le tableau horizontalement pour voir les quatre produits.</p>
    <div className="mortgage-table" tabIndex={0} role="region" aria-label="Historique des taux"><table><thead><tr><th scope="col">Date comparée</th>{productKeys.map(p=><th scope="col" key={p}>{label(p)}</th>)}</tr></thead><tbody>{referenceDates(today).map(r=><tr key={r.label}><th scope="row">{r.label}<small>{r.date}</small></th>{productKeys.map(p=>{const n=change(state,today,r.date,p);return <td key={p}>{n===null?"Indisponible":`${n>0?"+":""}${n.toFixed(2)} pt`}</td>;})}</tr>)}</tbody></table></div>
    <h2>Offres indicatives reçues</h2><p>Ces offres restent datées. Elles ne sont pas actualisées avec Ratehub.</p>
    {state.quotes.length === 0 ? <p>Aucune offre reçue enregistrée. Aucun taux négocié 3 ans connu.</p> : state.quotes.map(q=><article className="mortgage-quote" key={q.id}><h3>{label(q.product)} · {percent(q.rate)}</h3><p>{q.lender} · {variantLabel(q.variant)} · reçue le {q.receivedDate}</p><details><summary>Source et limites</summary><p>{q.source}</p><ul>{q.limitations.map(s=><li key={s}>{s}</li>)}</ul></details><details><summary>Comparer cette offre au taux actuel</summary><QuoteIllustration rate={q.rate} quote={q} assumptions={a}/></details></article>)}
    <p>Aucune offre négociée 3 ans n’est présumée.</p>
    <label className="mortgage-toggle"><input type="checkbox" checked={estimate} onChange={e=>setEstimate(e.target.checked)}/> Afficher l’estimation de négociation</label>
    {estimate && <section aria-label="Estimation de négociation">
      <h2>Estimation de négociation</h2>
      <p>Méthode : taux public du jour + (offre reçue − taux public du {state.baselineDate}). Écart constant en points, propre à chaque offre. Les dates et produits peuvent différer; comparabilité et admissibilité non vérifiées. Ce scénario n’est pas une offre.</p>
      {state.quotes.length ? state.quotes.map(q=>{
        const e=negotiatedEstimate(state,today,q);
        return <article key={q.id}>
          <p>{label(q.product)} · {variantLabel(q.variant)} : <strong>{e ? percent(e.rate) : "Indisponible"}</strong>{e && ` (écart ${e.spread>=0?"+":""}${e.spread.toFixed(2)} pt)`}</p>
          {e && <details><summary>Comparer cette estimation au taux actuel</summary><QuoteIllustration rate={e.rate} quote={q} assumptions={a}/></details>}
        </article>;
      }) : <p>Une offre datée et les deux observations publiques sont nécessaires.</p>}
    </section>}
    <h2>Illustration brute des versements et intérêts</h2><p>{a ? `Hypothèses à confirmer : solde ${cad(a.principal)}, amortissement restant ${a.remainingMonths} mois; taux actuel fourni ${percent(a.currentRate)}.` : "Hypothèses privées indisponibles. Enregistrez les hypothèses sur le PC pour calculer une illustration."} Pénalité et frais exclus. Le taux actuel est maintenu sur toute la durée illustrée; son échéance reste à confirmer.</p>
    <label>Produit public comparé <select value={selected} onChange={e=>setSelected(e.target.value as ProductKey)}>{productKeys.map(p=><option key={p} value={p}>{label(p)}</option>)}</select></label>
    {comparison && baseline ? <dl className="mortgage-numbers"><div><dt>Versement mensuel actuel estimé</dt><dd>{cad(baseline.payment)}</dd></div><div><dt>Versement au taux public</dt><dd>{cad(comparison.payment)}</dd></div><div><dt>Baisse du versement mensuel</dt><dd>{cad(baseline.payment-comparison.payment)}</dd></div><div><dt>Intérêts évités sur {selected.endsWith("3")?36:60} mois</dt><dd>{cad(baseline.interest-comparison.interest)}</dd></div></dl> : <p>Comparaison indisponible sans taux public observé aujourd’hui.</p>}
    <p>Taux fixe : capitalisation semestrielle canadienne. Variable : hypothèse de capitalisation mensuelle et taux constant, à confirmer auprès du prêteur. Les taux futurs et les paiements fixes à taux variable peuvent changer la répartition capital / intérêts; aucune économie constante n’est garantie.</p>
    <details><summary>Observations, filtres et tentatives</summary>{[...state.snapshots].sort((a,b)=>Date.parse(b.collectedAt)-Date.parse(a.collectedAt)).map(s=><article key={s.id}><h3>{s.localDate} · {s.status === "complete" ? "Collecte complète" : s.status === "partial" ? "Collecte partielle" : "Collecte échouée"}</h3><p>Collecté : {s.collectedAt}. Date affichée par la source : {s.source.publishedAt || "non indiquée"} (fuseau non confirmé).</p><p><a href={s.source.url} target="_blank" rel="noreferrer">{s.source.title}</a> · {s.source.method}</p><p>Renouvellement · {cad(s.filters.balance)} · {s.filters.amortizationMonths/12} ans · Vancouver BC · occupé par le propriétaire · mensuel · CMHC non · LTV indisponible.</p>{s.observations.map(o=><p key={o.product}>{label(o.product)} : {percent(o.rate)} · {o.lender || o.reason}. {o.eligibility.join("; ")}</p>)}</article>)}</details>
  </section>;
}
