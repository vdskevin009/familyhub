import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Building2, ChevronLeft, ChevronRight, CreditCard, SlidersHorizontal } from "lucide-react";
import { shiftMonth } from "../finance-trends";
import { displayMonthlyCapture, historicalAccountVersions, sourceAccountVersions, selectAccountVersion, summarizeMonthlyAccounts, type MonthlyAccountSelection, type MonthlyAccountRow } from "../finance-monthly-accounts";
import type { AccountHistoryRead } from "../use-finance-account-history";
import type { AccountCaptureRead } from "../use-finance-account-captures";
import InfoPopover, { CompactDialog } from "../ui/InfoPopover";
import "../finance-monthly-accounts.css";
const money = (value: number | null, currency: string) => value === null ? "Non établi" : new Intl.NumberFormat("fr-CA", { style: "currency", currency }).format(value / 100);
const dateLabel = (date: string) => new Date(date.length === 10 ? date + "T12:00:00Z" : date).toLocaleDateString("fr-CA", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const monthLabel = (month: string) => new Date(month + "-15T12:00:00Z").toLocaleDateString("fr-CA", { month: "long", year: "numeric", timeZone: "UTC" });
const kindLabels: Record<string, string> = { depository: "Compte bancaire", bank: "Compte bancaire", credit: "Carte de crédit", "credit-card": "Carte de crédit", investment: "Placement", brokerage: "Placement", loan: "Prêt", gic: "CPG", other: "Autre compte", unknown: "Type non fourni" };
export default function FinanceMonthlyAccounts({ read, history, selection, onSelection, onOpenHistorical, historicalAccountIds, legacy }: {
  read: AccountCaptureRead; history: AccountHistoryRead; selection: MonthlyAccountSelection;
  onSelection: (value: MonthlyAccountSelection) => void; onOpenHistorical: (id: string) => void; historicalAccountIds: string[]; legacy: ReactNode;
}) {
  const versions = useMemo(() => [...historicalAccountVersions(history.versions), ...sourceAccountVersions(read.captures)], [history.versions, read.captures]);
  const resolved = selectAccountVersion(versions, selection);
  const version = selection.month === null && read.status === "loading" || selection.month === null && read.status === "error" ? undefined : resolved.version;
  const month = selection.month ?? (read.status === "loading" || read.status === "error" ? "" : resolved.month);
  const [filters, setFilters] = useState(false), filterAnchor = useRef<HTMLButtonElement>(null), filterId = useId();
  const [detail, setDetail] = useState<MonthlyAccountRow | null>(null), detailAnchor = useRef<HTMLButtonElement>(null), detailId = useId();
  const currencies = [...new Set(version?.rows.map(r => r.currency).filter((c): c is string => c !== null) ?? [])].sort();
  const summary = version ? summarizeMonthlyAccounts(version, selection.accountId, selection.currency) : null;
  useEffect(() => {
    if (selection.month !== null || !resolved.version || !["ready", "unsupported"].includes(read.status)) return;
    const available = [...new Set(resolved.version.rows.map(r => r.currency).filter((c): c is string => c !== null))].sort();
    onSelection({ ...selection, month: resolved.month, currency: available.includes(selection.currency) ? selection.currency : available[0] ?? "CAD" });
  }, [selection, resolved.month, resolved.version, read.status, onSelection]);
  // A re-read or changed selected version invalidates the currently open account detail.
  useEffect(() => { setDetail(null); }, [read.status, version?.id, selection.currency, selection.accountId]);
  const chooseMonth = (value: string) => onSelection({ ...selection, month: value, versionId: null, accountId: "" });
  const scopeName = selection.accountId ? version?.rows.find(r => r.id === selection.accountId)?.name ?? "Compte indisponible" : "Tous les comptes";
  const stamp = version ? version.dateKind === "received" ? `Reçu le ${displayMonthlyCapture(version.date)}` : `Valeurs du ${dateLabel(version.date)}` : "";
  const openRow = (row: MonthlyAccountRow, button: HTMLButtonElement) => {
    if (row.canonicalAccountId && historicalAccountIds.includes(row.canonicalAccountId)) { onOpenHistorical(row.canonicalAccountId); return; }
    detailAnchor.current = button; setDetail(row);
  };
  return <div className="finance-monthly-accounts view-stack">
    <div><div className="accounts-period-row"><div className="accounts-month-switcher">
      <button type="button" className="icon-button" aria-label="Mois précédent" disabled={!month || !resolved.firstMonth || month <= resolved.firstMonth || read.status === "loading"} onClick={() => chooseMonth(shiftMonth(month, -1))}><ChevronLeft size={19} aria-hidden="true" /></button>
      <strong aria-live="polite">{month ? monthLabel(month) : "Comptes"}</strong>
      <button type="button" className="icon-button" aria-label="Mois suivant" disabled={!month || !resolved.lastMonth || month >= resolved.lastMonth || read.status === "loading"} onClick={() => chooseMonth(shiftMonth(month, 1))}><ChevronRight size={19} aria-hidden="true" /></button>
    </div><button type="button" className="button secondary accounts-filter-button" ref={filterAnchor} aria-haspopup="dialog" aria-controls={filterId} aria-expanded={filters} onClick={() => setFilters(true)}><SlidersHorizontal size={17} aria-hidden="true" />Filtres</button></div><small className="accounts-scope">{scopeName} · {selection.currency}</small></div>
    {read.status === "loading" && <p className="accounts-status" role="status">Chargement des versions des comptes…</p>}
    {read.status === "error" && <p className="accounts-status" role="status">Versions récentes indisponibles. Actualisez pour relire le PC.</p>}
    {read.status === "unsupported" && <p className="accounts-status" role="status">Les nouvelles versions nécessitent une mise à jour du PC. L’historique reste disponible.</p>}
    {history.status === "error" && <p className="accounts-status" role="status">Historique archivé indisponible. Aucune ancienne valeur n’est reconstituée.</p>}
    {version && summary ? <>
      <section className="surface accounts-summary" aria-label={version.dateKind === "source" ? "Total enregistré des comptes" : "Solde net des comptes"}>
        <div className="accounts-total-heading"><span>{version.dateKind === "source" ? "Total enregistré" : summary.complete ? "Solde net" : "Sous-total établi"} · {version.origin === "legacy-inventory" ? "inventaire partiel" : version.dateKind === "received" ? "version reçue" : "historique"}</span><InfoPopover title="Solde et dates des comptes">
          <p>{stamp}.</p><p>{version.dateKind === "source" ? "Somme des valeurs signées enregistrées, sans réinverser les crédits. La convention historique n’est pas attestée." : "Actifs moins dettes selon les soldes nets attestés, pour cette version et cette devise seulement."} Ce total n’est ni votre patrimoine complet ni l’argent disponible.</p>
          <p>{summary.includedCount} compte(s) totalisé(s), {summary.unknownCount} valeur(s) ou devise(s) non établies dans ce filtre. Couverture : {version.coverage === "complete" ? "complète pour cette collecte" : version.coverage === "partial" ? "partielle" : "inconnue"}.</p>
          <p>Les dates bancaires restent propres à chaque compte; une réception ne prouve pas une nouvelle mise à jour bancaire. Les lignes sans solde net attesté ne sont pas additionnées. Le détail des dettes ou placements peut manquer même si leur solde est connu.</p>
          <p>Les anciennes versions ne s’ajoutent pas à celle-ci. Aucun rapprochement de comptes par nom ou suffixe; aucune variation entre périmètres non attestés.</p>
          {version.notes.map(note => <p key={note}>{note}</p>)}{history.unavailableArchiveCount > 0 && <p>{history.unavailableArchiveCount} archive(s) non disponible(s), hors de ces versions.</p>}{summary.arithmeticUnavailable && <p>Total arithmétique non représentable de façon sûre.</p>}
          {resolved.inMonth.length > 1 && <label>Version de ce mois<select aria-label="Version de ce mois" value={version.id} onChange={e => onSelection({ ...selection, month, versionId: e.target.value, accountId: "" })}>{[...resolved.inMonth].reverse().map(v => <option key={v.id} value={v.id}>{v.dateKind === "received" ? "Reçu " + displayMonthlyCapture(v.date) : "Valeurs du " + dateLabel(v.date)}{v.superseded ? " · remplacée" : v.origin === "legacy-inventory" ? " · inventaire partiel" : ""}</option>)}</select></label>}
        </InfoPopover></div>
        <p className="accounts-net" data-accounts-net>{money(summary.netCents, selection.currency)} <small>{summary.netCents !== null && selection.currency}</small></p>
        {version.dateKind !== "source" ? <p className="accounts-equation">Actifs <strong>{money(summary.includedCount ? summary.assetsCents : null, selection.currency)}</strong> − dettes <strong>{money(summary.includedCount ? summary.debtsCents : null, selection.currency)}</strong></p> : <p className="accounts-equation">{summary.includedCount} soldes signés enregistrés.</p>}
        {summary.unknownCount > 0 && <p className="accounts-equation">{summary.unknownCount} valeur(s) à préciser, hors total.</p>}
      </section>
      <p className="accounts-received"><time dateTime={version.date}>{stamp}</time></p>
      <div className="accounts-list-heading"><h2>{summary.rows.length} compte{summary.rows.length === 1 ? "" : "s"}</h2><small>{version.dateKind === "source" ? "Historique" : "Version reçue"}</small></div>
      <div className="accounts-month-list">{summary.rows.map(row => <button type="button" key={row.id} className="accounts-month-row" data-account-row={row.id} data-investment-account={row.canonicalAccountId} data-liability={version.dateKind !== "source" && row.netCents !== null && row.netCents < 0} onClick={event => openRow(row, event.currentTarget)}>
        <span className="accounts-row-title"><span className="accounts-row-icon">{["credit", "credit-card", "loan"].includes(row.kind) ? <CreditCard size={19} aria-hidden="true" /> : <Building2 size={19} aria-hidden="true" />}</span><span><strong>{row.name}</strong><small>{kindLabels[row.kind] ?? "Type non fourni"}{version.dateKind !== "source" && row.netCents !== null && row.netCents < 0 ? " · dette" : ""}</small></span></span>
        <span className="accounts-row-money">{row.currency ? money(row.netCents ?? row.rawCents, row.currency) : "Valeur manquante"}<small>{row.currency ?? "Devise inconnue"}{row.netCents === null && row.rawCents !== null ? " · brut, hors total" : ""}</small></span>
      </button>)}</div>
      {summary.rows.length === 0 && <p className="accounts-status">Aucun compte dans cette version pour ce filtre. Aucun montant nul n’est déduit.</p>}
    </> : read.status !== "loading" && <p className="accounts-status">{month ? "Aucune version disponible pour ce mois ou cette sélection." : "Aucune version de comptes enregistrée."}</p>}
    <CompactDialog id={filterId} title="Filtres des comptes" open={filters} onClose={() => setFilters(false)} anchor={filterAnchor}><div className="accounts-filter-content">
      <label>Mois<input type="month" aria-label="Mois des comptes" value={month} onChange={e => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) chooseMonth(e.target.value); }} /></label>
      <label>Compte<select aria-label="Compte des soldes" value={selection.accountId} onChange={e => onSelection({ ...selection, accountId: e.target.value })}><option value="">Tous les comptes</option>{version?.rows.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}{selection.accountId && !version?.rows.some(r => r.id === selection.accountId) && <option value={selection.accountId}>Compte indisponible</option>}</select></label>
      <label>Devise<select aria-label="Devise des soldes" value={selection.currency} onChange={e => onSelection({ ...selection, currency: e.target.value })}>{[...new Set([selection.currency, ...currencies])].sort().map(c => <option key={c}>{c}</option>)}</select></label>
      <button type="button" className="button" onClick={() => setFilters(false)}>Voir les résultats</button>
    </div></CompactDialog>
    <CompactDialog id={detailId} title={detail?.name ?? "Compte"} open={detail !== null} onClose={() => setDetail(null)} anchor={detailAnchor}>{detail && <>
      <p>{kindLabels[detail.kind] ?? "Type non fourni"} · {detail.currency ?? "Devise inconnue"}</p>
      <p>{version?.dateKind === "source" ? "Valeur enregistrée" : "Solde net"} : {detail.currency ? money(detail.netCents, detail.currency) : "Non établi"}.</p>
      <p>Solde brut reçu : {detail.currency ? money(detail.rawCents, detail.currency) : "Non établi"}.</p>
      <p>{stamp}.</p><p>{detail.sourceAsOf ? "Date bancaire : " + dateLabel(detail.sourceAsOf) : "Date bancaire inconnue"}.</p>
      {detail.source?.institution && <p>{detail.source.institution}</p>}
      {detail.source?.credit && <><p>Solde du relevé : {detail.source.credit.statementBalance ? money(detail.source.credit.statementBalance.amountCents, detail.source.credit.statementBalance.currency) : "Non fourni"}. {detail.source.credit.statementBalance?.sourceAsOf ? "Date bancaire : " + dateLabel(detail.source.credit.statementBalance.sourceAsOf) : "Date bancaire non fournie"}.</p><p>Paiement minimum : {detail.source.credit.minimumPayment ? money(detail.source.credit.minimumPayment.amountCents, detail.source.credit.minimumPayment.currency) : "Non fourni"}. {detail.source.credit.minimumPayment?.sourceAsOf ? "Date bancaire : " + dateLabel(detail.source.credit.minimumPayment.sourceAsOf) : "Date bancaire non fournie"}. Échéance : {detail.source.credit.paymentDueOn ?? "Non fournie"}.</p></>}
      <p>Les positions et les opérations détaillées ne sont pas établies par ce seul solde. Aucune correspondance avec le registre historique n’est supposée.</p>
    </>}</CompactDialog>
    <details className="accounts-legacy-disclosure" open={read.status === "unsupported" && history.status === "unsupported" || undefined}><summary className="accounts-history-link">Autres détails et registre historique</summary>{legacy}</details>
  </div>;
}
