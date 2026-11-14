import { useState } from "react";
import type { GroceryRecord } from "../../../worker/src/grocery-model";
import { pcExpressMonthlySpending } from "../grocery-monthly-spending";
import "../grocery-monthly-spending.css";
const money = (value: number, currency: string) => new Intl.NumberFormat("fr-CA", { style: "currency", currency, currencyDisplay: "code" }).format(value);
const label = (month: string, short = false) => new Intl.DateTimeFormat("fr-CA", { month: short ? "short" : "long", ...(short ? {} : {year: "numeric" as const}), timeZone: "UTC" }).format(new Date(month + "-01T12:00:00Z"));
export default function GroceryMonthlySpending({ records, offline }: { records: GroceryRecord[]; offline: boolean }) {
  const summary = pcExpressMonthlySpending(records);
  const years = [...new Set(summary.months.map(m => m.month.slice(0, 4)))].sort().reverse();
  const [selection, setSelection] = useState("");
  const year = years.includes(selection) ? selection : years[0];
  const months = summary.months.filter(m => m.month.startsWith(year || "none"));
  const currencies = [...new Set(months.map(m => m.currency))];
  return <section className="grocery-spending" aria-label="Dépenses mensuelles PC Express">
    <div className="grocery-section-heading"><div><p className="grocery-spending-eyebrow">PC Express · historique disponible</p><h2>Dépenses par mois</h2></div>{years.length > 1 && <label>Année<select aria-label="Année" value={year} onChange={e => setSelection(e.target.value)}>{years.map(y => <option key={y}>{y}</option>)}</select></label>}</div>
    <p>Reçus finaux vérifiés et confirmations estimées sont séparés. Une estimation ne prouve pas un débit. Tous les achats PC Express sont inclus, y compris les articles non alimentaires.</p>
    {offline && <p className="grocery-warning">Données en cache : les derniers courriels ne sont pas vérifiés.</p>}
    {!months.length ? <p className="grocery-empty">Aucun montant PC Express daté et exploitable. Les achats importés apparaîtront ici, sans inventer de dépense.</p> : currencies.map(currency => {
      const rows = months.filter(m => m.currency === currency), max = Math.max(1, ...rows.flatMap(m => [m.paid, m.estimated]));
      const firstMonth = Math.min(...rows.map(m => Number(m.month.slice(5)))), lastMonth = Math.max(...rows.map(m => Number(m.month.slice(5))));
      const paid = rows.reduce((s, m) => s + Math.round(m.paid * 100), 0) / 100, estimated = rows.reduce((s, m) => s + Math.round(m.estimated * 100), 0) / 100;
      return <div key={currency} className="grocery-spending-currency">
        <div className="grocery-spending-summary"><div><span>Payé vérifié · {year}</span><strong>{rows.some(m => m.paidCount) ? money(paid, currency) : "Non établi"}</strong></div><div><span>Commandes estimées · {year}</span><strong>{rows.some(m => m.estimatedCount) ? money(estimated, currency) : "Aucune"}</strong></div></div>
        <p className="grocery-spending-legend"><span><i className="paid" />Payé vérifié</span><span><i className="estimated" />Estimé, paiement inconnu</span></p>
        <p className="grocery-spending-note">Échelle : 0 à {money(max, currency)}</p>
        <div className="grocery-spending-scroll" role="region" aria-label={`Graphique mensuel ${year}, ${currency}`} tabIndex={0}>
          <div className="grocery-spending-bars" style={{ minWidth: `${(lastMonth - firstMonth + 1) * 44}px` }} role="img" aria-label={`Montants mensuels en ${currency}. Valeurs exactes dans le détail sous le graphique.`}>
            {Array.from({ length: lastMonth - firstMonth + 1 }, (_, index) => {
              const month = `${year}-${String(index + firstMonth).padStart(2, "0")}`, row = rows.find(m => m.month === month);
              return <div className="grocery-spending-column" key={month}>
                <div className="grocery-spending-pair" aria-hidden="true">{row ? <><span className="paid" style={{ height: `${row.paid / max * 100}%` }} title={`${label(month)} : ${money(row.paid, currency)} payés vérifiés`} /><span className="estimated" style={{ height: `${row.estimated / max * 100}%` }} title={`${label(month)} : ${money(row.estimated, currency)} estimés`} /></> : <span className="grocery-spending-missing">—</span>}</div>
                <span>{label(month, true)}</span>
              </div>;
            })}
          </div>
        </div>
        <p className="grocery-spending-note">— Aucun montant exploitable retrouvé pour ce mois, pas une dépense de zéro. Même échelle pour les deux séries ; les montants ne s'additionnent pas.</p>
        <details><summary>Montants et commandes par mois · {currency}</summary><ul className="grocery-spending-values">{rows.map(row => <li key={row.month}><strong>{label(row.month)}</strong><span>{row.paidCount ? `${money(row.paid, currency)} payés · ${row.paidCount} reçu(s)` : "Payé : non établi"}</span><span>{row.estimatedCount ? `${money(row.estimated, currency)} estimés · ${row.estimatedCount} commande(s)` : "Aucune confirmation estimée"}</span></li>)}</ul></details>
      </div>;
    })}
    <details><summary>Couverture et méthode</summary><p>{summary.firstDate ? `Sources datées du ${summary.firstDate} au ${summary.lastDate}.` : "Période couverte inconnue."} Tous les achats PC Express enregistrés disponibles sont utilisés, y compris les archives, quel que soit le compte d'origine. La date du reçu ou de la confirmation détermine le mois.</p><p>L'historique des deux boîtes mail n'est pas certifié exhaustif. Les autorisations de carte ne sont jamais additionnées. Les remboursements et annulations ne sont pas vérifiés par ce graphique : il ne représente pas un débit bancaire net.</p><p>Une référence de commande identique ne compte qu'une fois. Un reçu final vérifié remplace son estimation dans le graphique, sans modifier les sources.</p>{summary.duplicates > 0 && <p>{summary.duplicates} source(s) supplémentaire(s) de la même commande non additionnée(s).</p>}{(summary.excluded > 0 || summary.conflicts > 0) && <p className="grocery-warning">{summary.excluded} commande(s) sans date, devise, total ou type de preuve exploitable ; {summary.conflicts} commande(s) avec sources contradictoires. Exclues des montants.</p>}</details>
  </section>;
}
