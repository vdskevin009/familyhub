import { useState, type ReactNode } from "react";
import { Store } from "lucide-react";
import type { GroceryPlan, ShoppingItem } from "../../../worker/src/grocery-planning";
import { modeLabels } from "../../../worker/src/grocery-planning";
import { savingLabel } from "../grocery-catalogue";
import { observedTargetOpportunities, type TargetObservation } from "../grocery-target-observations";
import { storeGroups, storeName, formatLabel } from "../grocery-comparison";
import { formatUnitRate } from "../grocery-unit-comparison";
import { packagePrice } from "../grocery-price-display";
import { ArticleOfferCard } from "./GroceryComparison";

function TargetArticle({ row, plan }: { row: TargetObservation; plan: GroceryPlan }) {
  return <article className={'grocery-target-article' + (row.validated ? '' : ' grocery-target-observed')}>
    <h3>{row.item.name}</h3>
    <p className="grocery-target-identity">{row.alternative.p.product} · {formatLabel(row.alternative.p, row.item)}</p>
    <div className="grocery-target-price-line">
      <div className="grocery-target-price"><strong>{packagePrice(row.alternative.p.price, row.alternative.p.currency)}</strong><small>{formatUnitRate(row.alternative.rate!, plan.currency)}</small></div>
      <div className="grocery-target-gap"><strong className="grocery-target-saving">−{savingLabel(row.percent)}</strong><small>vs Superstore</small></div>
    </div>
    <p className="grocery-target-baseline">Superstore : {packagePrice(row.baseline.p.price, row.baseline.p.currency)} · {formatLabel(row.baseline.p, row.item)}<small>{formatUnitRate(row.baseline.rate!, plan.currency)}</small></p>
    <p className="grocery-target-observation">{row.validated ? 'Économie unitaire, hors frais et taxes' : 'Écart observé, hors frais et taxes · équivalence à confirmer'}</p>
    {row.alternative.p.mode !== row.baseline.p.mode && <p className="grocery-target-modes">Modes différents : {modeLabels[row.alternative.p.mode ?? 'unknown']} ; Superstore : {modeLabels[row.baseline.p.mode ?? 'unknown']}</p>}
    {!row.validated && row.warnings.includes('Substitution non autorisée') && <p className="grocery-target-limit">Substitution non autorisée : références à examiner, achat non recommandé.</p>}
    {row.validated && row.alternative.p.substitution && <p className="grocery-target-limit">Substitution revue</p>}
    <details className="grocery-info grocery-target-details"><summary>Détails <span className="sr-only">de {row.validated ? "l'économie" : 'la comparaison'} de {row.item.name} chez {storeName(row.alternative.r.name)}</span></summary>
      <p className="grocery-target-verification"><strong className={'grocery-target-badge' + (row.validated ? ' is-validated' : '')}>{row.validated ? 'Référence validée' : 'À vérifier'}</strong><span>{row.validated ? 'Économie unitaire, hors frais' : 'Écart unitaire observé · équivalence à confirmer'}</span></p>
      <p>{modeLabels[row.alternative.p.mode ?? 'unknown']} ; Superstore : {modeLabels[row.baseline.p.mode ?? 'unknown']}</p>
      <p>Observé le {row.alternative.p.evidence.date} · Superstore le {row.baseline.p.evidence.date}</p>
      <p>({row.baseline.rate!.amount} − {row.alternative.rate!.amount}) / {row.baseline.rate!.amount} × 100 = {savingLabel(row.percent)}. Prix unitaires uniquement ; les frais, taxes et quantités d'achat ne sont pas ajoutés à cet écart.</p>
      {!row.validated && <><p>Comparaison à vérifier, sans approbation ni équivalence déduite.</p><ul>{row.warnings.map(reason => <li key={reason}>{reason}</li>)}</ul></>}
      <ArticleOfferCard plan={plan} item={row.item} p={row.alternative.p} r={row.alternative.r} ranked={row.validated ? row.alternative : { ...row.alternative, tone: 'neutral', percent: null, gap: 'Observation à vérifier' }} included={false} />
      <ArticleOfferCard plan={plan} item={row.item} p={row.baseline.p} r={row.baseline.r} ranked={row.validated ? row.baseline : { ...row.baseline, tone: 'neutral', percent: null, gap: 'Référence Superstore à vérifier' }} included={false} />
    </details>
  </article>;
}

export default function GroceryTargetView({ plan, items, ready, controls }: { plan: GroceryPlan; items: ShoppingItem[]; ready: boolean; controls?: ReactNode }) {
  const [validatedOnly, setValidatedOnly] = useState(false);
  const opportunities = observedTargetOpportunities(plan, items);
  const visible = opportunities.result.filter(row => !validatedOnly || row.validated);
  return <>
    <div className="grocery-target-status"><strong>{opportunities.observedCount} piste{opportunities.observedCount > 1 ? 's' : ''} à vérifier</strong><span>{opportunities.validatedCount} validée{opportunities.validatedCount > 1 ? 's' : ''}</span></div>
    {controls}
    <label className="grocery-target-filter grocery-check"><input type="checkbox" checked={validatedOnly} onChange={e => setValidatedOnly(e.target.checked)} />Références validées seulement</label>
    {storeGroups(plan).filter(g => g.name !== 'Superstore').map(group => {
      const rows = visible.filter(row => storeName(row.alternative.r.name) === group.name);
      if (!rows.length) return null;
      const validated = rows.filter(row => row.validated), observed = rows.filter(row => !row.validated);
      return <section key={group.name} className="grocery-target-store" aria-label={'Pistes chez ' + group.name}>
        <header className="grocery-target-store-heading"><span className="grocery-store-icon"><Store size={18} aria-hidden="true" /></span><h2>{group.name}</h2><span className={'grocery-store-status' + (!observed.length ? ' is-validated' : '')}>{observed.length ? 'À vérifier' : 'Références validées'}</span></header>
        {!!validated.length && <div className="grocery-target-section" role="group" aria-label={'Références validées chez ' + group.name}>{!!observed.length && <p className="grocery-target-section-title">Références validées</p>}{validated.map(row => <TargetArticle key={row.item.id} row={row} plan={plan} />)}</div>}
        {!!observed.length && <div className="grocery-target-section" role="group" aria-label={'Observations à vérifier chez ' + group.name}>{!!validated.length && <p className="grocery-target-section-title">Pistes à vérifier</p>}{observed.map(row => <TargetArticle key={row.item.id} row={row} plan={plan} />)}</div>}
      </section>;
    })}
    <details className="grocery-info grocery-target-explanation"><summary>À propos des écarts</summary><p>Écarts unitaires face à Superstore, hors frais et taxes. « À vérifier » ne garantit ni l'équivalence ni une économie de commande.</p></details>
    {ready && !visible.length && <p className="grocery-empty">{validatedOnly ? 'Aucune référence entièrement validée. Décochez le filtre pour examiner les écarts observés à vérifier.' : 'Aucun écart unitaire moins cher calculable face à Superstore pour ces filtres.'}</p>}
    {!!opportunities.excluded.length && <details className="grocery-info"><summary>Références manquantes ou non comparables ({opportunities.excluded.length})</summary><ul>{opportunities.excluded.map(({ item, reasons }) => <li key={item.id}><strong>{item.name}</strong> : {reasons.join(' ; ')}</li>)}</ul><p>Les unités ou types explicitement incompatibles n'ont aucun pourcentage. Les prix anciens, formats estimés et magasins désactivés restent exclus ; leurs sources sont conservées dans les fiches du catalogue.</p></details>}
  </>;
}
