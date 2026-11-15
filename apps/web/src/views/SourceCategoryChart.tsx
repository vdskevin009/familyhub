import { useId, useState } from "react";
import type { SourceCategoryTotal } from "../source-category-totals";

export default function SourceCategoryChart({ totals, labels, currency, selected, onSelect }: {
  totals: SourceCategoryTotal[]; labels: Record<string, string>; currency: string; selected: string; onSelect: (key: string) => void;
}) {
  const [expanded, setExpanded] = useState(false), id = useId();
  const money = (value: number) => new Intl.NumberFormat("fr-CA", { style: "currency", currency, currencyDisplay: "code" }).format(value / 100);
  const scale = Math.max(1, ...totals.map(t => Math.abs(t.netCents)));
  if (!totals.length) return null;
  return <section className="source-category-chart" aria-labelledby={id}>
    <div className="source-category-heading"><h3 id={id}>Où va cet argent ?</h3><span>Net par catégorie</span></div>
    <p className="source-category-caption">Touchez une catégorie pour voir ses opérations.</p>
    <ul>{(expanded ? totals : totals.slice(0, 4)).map(total => <li key={total.key}>
      <button type="button" data-source-category={total.key} aria-pressed={selected === total.key} onClick={() => onSelect(total.key)}>
        <span className="source-category-value"><strong>{labels[total.key] ?? "Catégorie non reconnue"}</strong><strong>{money(total.netCents)}</strong></span>
        <span className="source-category-bar" aria-hidden="true"><span className={total.netCents < 0 ? "credit" : ""} style={{ width: `${Math.abs(total.netCents) / scale * 50}%`, left: `${total.netCents < 0 ? 50 - Math.abs(total.netCents) / scale * 50 : 50}%` }} /></span>
        <span className="source-category-meta"><span>{total.count} opération{total.count > 1 ? "s" : ""}</span>{total.refundCents > 0 && <span>{money(total.refundCents)} de crédits{total.netCents < 0 ? " · net créditeur" : ""}</span>}</span>
      </button>
    </li>)}</ul>
    {totals.length > 4 && <button type="button" className="text-action" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>{expanded ? "Réduire les catégories" : `Toutes les catégories (${totals.length})`}</button>}
    <p className="source-category-caption">Crédits à gauche de zéro, dépenses à droite. Même périmètre que le sous-total, sans objectif de budget.</p>
  </section>;
}
