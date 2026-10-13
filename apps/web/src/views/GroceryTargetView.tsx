import { useState } from "react";
import type { GroceryPlan, ShoppingItem } from "../../../worker/src/grocery-planning";
import { modeLabels } from "../../../worker/src/grocery-planning";
import { savingLabel } from "../grocery-catalogue";
import { observedTargetOpportunities } from "../grocery-target-observations";
import { storeGroups, storeName, formatLabel } from "../grocery-comparison";
import { formatUnitRate } from "../grocery-unit-comparison";
import { ArticleOfferCard } from "./GroceryComparison";

export default function GroceryTargetView({plan,items,ready}:{plan:GroceryPlan;items:ShoppingItem[];ready:boolean}){
  const [validatedOnly,setValidatedOnly]=useState(false);
  const opportunities=observedTargetOpportunities(plan,items);
  const visible=opportunities.result.filter(row=>!validatedOnly || row.validated);
  return <>
    <div className="grocery-target-status"><strong>{opportunities.observedCount} à vérifier · {opportunities.validatedCount} validée{opportunities.validatedCount>1?"s":""}</strong><label className="grocery-check"><input type="checkbox" checked={validatedOnly} onChange={e=>setValidatedOnly(e.target.checked)} />Références validées seulement</label></div>
    <p className="grocery-target-note">Écarts unitaires face à Superstore, hors frais et taxes. « À vérifier » ne garantit ni l'équivalence ni une économie de commande.</p>
    {storeGroups(plan).filter(g=>g.name!=="Superstore").map(group=>{
      const rows=visible.filter(row=>storeName(row.alternative.r.name)===group.name);
      return rows.length?<section key={group.name} className="grocery-target-store"><h2>{group.name}</h2>{rows.map(row=><article key={row.item.id} className={`grocery-target-article${row.validated?"":" grocery-target-observed"}`}>
        <div className="grocery-article-heading"><h3>{row.item.name}</h3><strong className="grocery-target-saving">−{savingLabel(row.percent)}</strong></div>
        <p className="grocery-target-verification"><strong className={`grocery-target-badge ${row.validated?"is-validated":""}`}>{row.validated?"Référence validée":"À vérifier"}</strong><span>{row.validated?"Économie unitaire, hors frais":"Écart unitaire observé · équivalence à confirmer"}</span></p>
        <p>{formatUnitRate(row.alternative.rate!,plan.currency)} <small>contre {formatUnitRate(row.baseline.rate!,plan.currency)} chez Superstore</small></p>
        <p>{row.alternative.p.product} · {formatLabel(row.alternative.p,row.item)}<small>Superstore : {row.baseline.p.product} · {formatLabel(row.baseline.p,row.item)}</small></p>
        <p className="grocery-target-modes">{modeLabels[row.alternative.p.mode??"unknown"]} <small>Superstore : {modeLabels[row.baseline.p.mode??"unknown"]}{row.alternative.p.mode!==row.baseline.p.mode?" · Modes différents":""}</small></p>
        <small>Observé le {row.alternative.p.evidence.date} · Superstore le {row.baseline.p.evidence.date}</small>
        {!row.validated && row.warnings.includes("Substitution non autorisée") && <p className="grocery-target-limit">Substitution non autorisée : références à examiner, achat non recommandé.</p>}
        {row.validated && row.alternative.p.substitution && <p className="grocery-target-limit">Substitution revue</p>}
        <details className="grocery-info"><summary>Détails de {row.validated?"l'économie":"la comparaison"} <span className="sr-only">de {row.item.name} chez {group.name}</span></summary>
          <p>({row.baseline.rate!.amount} − {row.alternative.rate!.amount}) / {row.baseline.rate!.amount} × 100 = {savingLabel(row.percent)}. Prix unitaires uniquement ; les frais, taxes et quantités d'achat ne sont pas ajoutés à cet écart.</p>
          {!row.validated && <><p>Comparaison à vérifier, sans approbation ni équivalence déduite.</p><ul>{row.warnings.map(reason=><li key={reason}>{reason}</li>)}</ul></>}
          <ArticleOfferCard plan={plan} item={row.item} p={row.alternative.p} r={row.alternative.r} ranked={row.validated?row.alternative:{...row.alternative,tone:"neutral",percent:null,gap:"Observation à vérifier"}} included={false} />
          <ArticleOfferCard plan={plan} item={row.item} p={row.baseline.p} r={row.baseline.r} ranked={row.validated?row.baseline:{...row.baseline,tone:"neutral",percent:null,gap:"Référence Superstore à vérifier"}} included={false} />
        </details>
      </article>)}</section>:null;
    })}
    {ready && !visible.length && <p className="grocery-empty">{validatedOnly?"Aucune référence entièrement validée. Décochez le filtre pour examiner les écarts observés à vérifier.":"Aucun écart unitaire moins cher calculable face à Superstore pour ces filtres."}</p>}
    {!!opportunities.excluded.length && <details className="grocery-info"><summary>Références manquantes ou non comparables ({opportunities.excluded.length})</summary><ul>{opportunities.excluded.map(({item,reasons})=><li key={item.id}><strong>{item.name}</strong> : {reasons.join(" ; ")}</li>)}</ul><p>Les unités ou types explicitement incompatibles n'ont aucun pourcentage. Les prix anciens, formats estimés et magasins désactivés restent exclus ; leurs sources sont conservées dans les fiches du catalogue.</p></details>}
  </>;
}
