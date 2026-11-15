import React, { useId } from "react";
import { sourceInventoryIsStale, type FinanceSourceInventory as Inventory, type SourceAvailability, type SourceDatedMoney, type SourceMoney } from "../../../worker/src/finance-source-inventory-model";

const kinds = { depository: "Compte bancaire", credit: "Crédit", investment: "Placement", loan: "Prêt", other: "Autre compte", unknown: "Type non fourni" };
const frequencies = { weekly: "Hebdomadaire", biweekly: "Toutes les deux semaines", semimonthly: "Deux fois par mois", monthly: "Mensuelle", quarterly: "Trimestrielle", yearly: "Annuelle", irregular: "Irrégulière", unknown: "Fréquence non fournie" };
const money = (value: SourceMoney) => new Intl.NumberFormat("fr-CA", { style: "currency", currency: value.currency, currencyDisplay: "code" }).format(value.amountCents / 100);
function DateValue({ value }: { value: string }) {
  const dateOnly = value.length === 10;
  const formatted = new Intl.DateTimeFormat("fr-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit", ...(dateOnly ? {} : { hour: "2-digit", minute: "2-digit", second: "2-digit" }) }).format(new Date(dateOnly ? value + "T12:00:00.000Z" : value));
  return <time dateTime={value}>{formatted}{dateOnly ? "" : " UTC"}</time>;
}
function MoneyEvidence({ title, value, collectedAt }: { title: string; value: SourceDatedMoney | null; collectedAt: string }) {
  return <div className="finance-source-money"><dt>{title}</dt><dd>
    <strong>{value === null ? "Montant non fourni" : money(value)}</strong>
    <small>Récupéré le <DateValue value={collectedAt} /></small>
    {value !== null && <small>{value.sourceAsOf === null ? "Date bancaire non fournie" : <>Date bancaire : <DateValue value={value.sourceAsOf} /></>}</small>}
  </dd></div>;
}
export function SourceAvailabilityNotice({ label, value }: { label: string; value: SourceAvailability }) {
  return <li><strong>{label} : </strong>{value.status === "unavailable" ? "indisponible, couverture non établie" : value.status === "partial" ? "couverture partielle" : "couverture fournie pour le périmètre collecté"}
    {value.observedCount === 0 && value.coverage === "unknown" ? ". Aucune ligne renvoyée ne prouve une absence de données." : value.observedCount === null ? ". Nombre de lignes inconnu." : ` (${value.observedCount} ligne${value.observedCount === 1 ? "" : "s"} renvoyée${value.observedCount === 1 ? "" : "s"}).`}</li>;
}

/** Read-only view. Import finance-source-inventory.css in the integrating screen.
 * Snapshot must be validated at the API boundary. No ledger or navigation dependency.
 */
export default function FinanceSourceInventory({ snapshot, now = new Date() }: { snapshot: Inventory | null; now?: Date }) {
  const heading = useId();
  if (snapshot === null) return <section className="finance-source-inventory" aria-labelledby={heading}><h2 id={heading}>Autres données de la source</h2><p>Inventaire non disponible. Aucun solde ni aucune absence de compte ne peut être déduit.</p></section>;
  const stale = sourceInventoryIsStale(snapshot, now);
  return <section className="finance-source-inventory" aria-labelledby={heading}>
    <header><h2 id={heading}>Autres données de la source</h2><p>Collecte du <DateValue value={snapshot.collectedAt} />{stale && <strong> · Collecte ancienne (plus de 24 h)</strong>}</p></header>
    <p>Ces comptes ne sont pas rapprochés du registre existant. Leurs montants restent séparés des totaux de dépenses, de placements et de patrimoine.</p>
    <p className="finance-source-note">La date de collecte indique quand le montant a été récupéré, pas quand la banque l’a mis à jour.</p>
    {snapshot.accounts.length === 0 ? <p>Aucun compte dans cet inventaire. Cela ne certifie pas l’absence de comptes liés.</p> : <ul className="finance-source-accounts">{snapshot.accounts.map(account => <li key={account.sourceKey}>
      <article><header><h3>{account.name}</h3><p>{account.institution ?? "Établissement non fourni"} · {kinds[account.kind]}</p><strong className="finance-source-status">Non rapproché</strong></header>
        <dl><MoneyEvidence title="Solde récupéré" value={account.balance} collectedAt={snapshot.collectedAt} /></dl>
        {account.credit !== null && <details><summary>Relevé et échéance de crédit</summary><dl>
          <MoneyEvidence title="Solde du relevé" value={account.credit.statementBalance} collectedAt={snapshot.collectedAt} />
          <MoneyEvidence title="Paiement minimum indiqué" value={account.credit.minimumPayment} collectedAt={snapshot.collectedAt} />
          <div><dt>Échéance indiquée</dt><dd>{account.credit.paymentDueOn === null ? "Date non fournie" : <DateValue value={account.credit.paymentDueOn} />}</dd></div>
        </dl><p>Ces champs ne confirment ni un paiement effectué ni un impayé. Chaque montant conserve sa propre date bancaire.</p></details>}
      </article>
    </li>)}</ul>}
    <details className="finance-source-coverage"><summary>Disponibilité des sections</summary><ul>
      <SourceAvailabilityNotice label="Comptes de cet inventaire" value={snapshot.availability.accounts} />
      <SourceAvailabilityNotice label="Positions de placement" value={snapshot.availability.holdings} />
      <SourceAvailabilityNotice label="Activité de placement" value={snapshot.availability.activity} />
      <SourceAvailabilityNotice label="Crédits et échéances" value={snapshot.availability.liabilities} />
      <SourceAvailabilityNotice label="Prévisions récurrentes" value={snapshot.availability.recurring} />
      <li><strong>Budgets et objectifs : </strong>non fournis par cette source. Les données déjà enregistrées ailleurs sont inchangées.</li>
    </ul></details>
    <details className="finance-source-forecasts"><summary>Prévisions récurrentes ({snapshot.predictions.length})</summary>
      <p>Prévisions de la source uniquement. Ce ne sont ni des dépenses comptabilisées ni des factures confirmées. Aucun montant n’est ajouté aux totaux.</p>
      {snapshot.predictions.length === 0 ? <p>Aucune prévision dans cette collecte. Consultez la disponibilité ci-dessus pour connaître la couverture.</p> : <ul>{snapshot.predictions.map(prediction => <li key={prediction.sourceKey}>
        <h3>{prediction.name}</h3><p><strong>Prévision</strong> · {prediction.flow === "outflow" ? "Sortie prévue" : prediction.flow === "inflow" ? "Entrée prévue" : "Sens non fourni"} · {frequencies[prediction.frequency]}</p>
        <p>{prediction.amount === null ? "Montant non fourni" : money(prediction.amount)} · {prediction.predictedOn === null ? "Date prévue non fournie" : <>Date prévue : <DateValue value={prediction.predictedOn} /></>}</p>
        {prediction.accountSourceKey !== null && <p>Compte source : {snapshot.accounts.find(account => account.sourceKey === prediction.accountSourceKey)?.name}</p>}
        {prediction.predictedOn !== null && prediction.predictedOn < snapshot.collectedAt.slice(0, 10) && <p>Date prévue déjà passée lors de la collecte. Réalisation non vérifiée.</p>}
      </li>)}</ul>}
    </details>
  </section>;
}
