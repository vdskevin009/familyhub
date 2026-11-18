import { useEffect, useState } from "react";
import { Check, ChevronRight, CircleAlert } from "lucide-react";
import type { WorkerConfig } from "../types";
import { PageHeader, Sheet } from "../ui/primitives";
import { contributionMetrics, type ContributionCard, type ContributionPayment, type ContributionsSnapshot } from "../contributions";
import { fetchContributions } from "../contributions-api";
import "../contributions.css";
import "../finance-visual.css";

const title = (kind: ContributionCard["kind"]) => kind === "rrsp" ? "REER" : "REEE";
const money = (cents: number, currency: string) => new Intl.NumberFormat("fr-CA", { style: "currency", currency, maximumFractionDigits: 2 }).format(cents / 100);
const date = (day: string) => new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(day + "T12:00:00Z"));
const warningLabel = (warning: string) => ({
  "source-freshness-unverified": "Fraîcheur de la source non confirmée.",
  "source-unavailable": "Source financière indisponible.",
  "destination-unverified": "Compte de destination à vérifier.",
  "source-account-unverified": "Compte source à vérifier.",
  "coverage-incomplete": "Historique incomplet sur la période.",
  "source-not-current": "La dernière collecte ne couvre pas aujourd’hui.",
  "pending-excluded": "Opérations en attente exclues.",
  "source-limitations": "La source signale des limites de couverture.",
  "excluded-observations": "Certaines opérations ont été exclues après vérification.",
}[warning] || warning);

const inferenceLabel = (status: ContributionCard["inferenceStatus"]) => ({
  "not-configured": "Attributions déduites non configurées.",
  "requires-review": "Attributions déduites à revoir.",
  "source-unavailable": "Attributions déduites indisponibles : source manquante.",
  "partial-conflict": "Attributions déduites partielles : données contradictoires exclues.",
  "partial-canonical-overlap": "Attributions déduites partielles : doublons potentiels exclus.",
  "available": "",
}[status ?? "available"]);
function Payments({ heading, rows, currency }: { heading: string; rows: ContributionPayment[]; currency: string }) {
  return <section className="contribution-payments"><h3>{heading}</h3>{rows.length ? <ul>{rows.map(row => <li key={row.id}><time dateTime={row.date}>{date(row.date)}</time><strong>{money(row.amountCents, currency)}</strong></li>)}</ul> : <p>Aucun versement identifié.</p>}</section>;
}
function ContributionDetails({ plan, snapshot }: { plan: ContributionCard; snapshot: ContributionsSnapshot }) {
  const m = contributionMetrics(plan, snapshot);
  return <div className="contribution-details">
    <dl className="contribution-detail-summary"><div><dt>Objectif personnel</dt><dd>{money(plan.goalCents, plan.currency)}</dd></div><div><dt>Échéance</dt><dd>{date(plan.deadline)}</dd></div><div><dt>Évalué le</dt><dd>{date(snapshot.evaluatedOn)}</dd></div></dl>
    <p>Les versements identifiés ne constituent ni une attestation fiscale ni des droits de cotisation.</p>
    <p>Date de la source : {plan.sourceAsOf ? date(plan.sourceAsOf.slice(0, 10)) : "non confirmée"}. Récupération : {plan.retrievedAt ? date(plan.retrievedAt.slice(0, 10)) : "non confirmée"}.</p>
    {plan.kind === "resp" && <p>{plan.beneficiaryConfirmed ? `Bénéficiaire confirmé : ${plan.beneficiary}.` : "Bénéficiaire à confirmer. L’objectif atteint ne peut pas être confirmé."} Objectif personnel de l’année civile, sans subvention supposée.</p>}
    {plan.attribution !== "confirmed" && <p className="contribution-caution">Attribution des versements à confirmer.</p>}
    {plan.kind === "rrsp" && <><Payments heading="Hebdomadaires réalisés" rows={plan.weeklyPaid} currency={plan.currency} /><section className="contribution-forecast"><h3>Hebdomadaires à venir · estimation</h3>{plan.weeklyForecast ? <><p><strong>{money(m.forecastCents, plan.currency)}</strong> prévus{m.remainingDays > 0 ? ` (${plan.weeklyForecast.count} × ${money(plan.weeklyForecast.amountCents, plan.currency)})` : " : échéance atteinte"}.</p><p>{plan.weeklyForecast.assumption}</p><p>Non réalisés, exclus du pourcentage et de l’état « objectif atteint ».</p></> : <p>Prévision non configurée. Aucun versement futur n’est supposé.</p>}</section></>}
    <Payments heading={plan.kind === "rrsp" ? "Versements ponctuels" : "Versements identifiés"} rows={plan.kind === "rrsp" ? plan.oneOffPaid : [...plan.weeklyPaid, ...plan.oneOffPaid].sort((a, b) => b.date.localeCompare(a.date))} currency={plan.currency} />
    {inferenceLabel(plan.inferenceStatus) && <p className="contribution-caution">{inferenceLabel(plan.inferenceStatus)} Aucun montant inconnu n’est supposé nul.</p>}
    {(plan.inferredPayments?.length ?? 0) > 0 && <section className="contribution-inferred"><h3>Attribution déduite : {money(plan.inferredCents ?? 0, plan.currency)}</h3><p>Destination déduite de virements antérieurs. Réception bancaire non confirmée. Ces montants restent séparés du total identifié, du pourcentage et de l'effort restant.</p><ul>{plan.inferredPayments!.map(row => <li key={row.id}><div><time dateTime={row.date}>{date(row.date)}</time><strong>{money(row.amountCents, plan.currency)}</strong></div><p>{row.rationale}</p><p>{row.evidenceTransactionIds.length} référence(s) historique(s). Collecte : {date(row.collectedAt.slice(0, 10))}, pas une date de réception bancaire.</p></li>)}</ul></section>}
    <section><h3>Effort restant</h3><p>{money(m.remainingCents, plan.currency)}{plan.kind === "rrsp" ? " après la prévision hebdomadaire" : " à verser"}.</p><p>{m.monthlyCents === null ? "Échéance atteinte : aucun calcul mensuel." : `Environ ${money(Math.round(m.monthlyCents), plan.currency)} par mois.`} Convention : un mois = {snapshot.daysPerMonth} jours, à confirmer. Orange au-delà de 1 000 $ par mois.</p></section>
    <section><h3>Virements non attribués · exclus</h3><p>Ces mouvements ne sont pas ajoutés au montant identifié ni à la prévision.</p>{plan.unassigned.length > 0 && <Payments heading="À vérifier" rows={plan.unassigned} currency={plan.currency} />}{!plan.unassigned.length && <p>Aucun mouvement non attribué dans les données reçues.</p>}</section>
    {plan.warnings.length > 0 && <section><h3>Limites des données</h3><ul>{[...new Set(plan.warnings.map(warningLabel))].map((warning, i) => <li key={i}>{warning}</li>)}</ul></section>}
  </div>;
}

export default function ContributionsView({ worker, embedded = false }: { worker: WorkerConfig; embedded?: boolean }) {
  const [snapshot, setSnapshot] = useState<ContributionsSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<ContributionCard | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setSnapshot(null); setSelected(null); setError(""); setLoading(true);
    void fetchContributions(worker, controller.signal).then(result => { if (!controller.signal.aborted) setSnapshot(result); }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Contributions indisponibles."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [worker.Endpoint, worker.ApiKey, attempt]);
  return <section className="view-stack contributions-view">
    {embedded ? <div className="compact-heading"><h2>Contributions</h2><button type="button" className="button secondary" disabled={loading} onClick={() => setAttempt(n => n + 1)}>Actualiser les contributions</button></div> : <PageHeader title="Contributions"><button type="button" className="button secondary" disabled={loading} onClick={() => setAttempt(n => n + 1)}>Actualiser</button></PageHeader>}
    <div role="status" className={loading || error ? "notice" : "sr-only"}>{loading ? "Chargement des contributions…" : error || "Contributions chargées."}</div>
    <div className="contribution-cards">{(["rrsp", "resp"] as const).map(kind => {
      const plan = snapshot?.plans.find(p => p.kind === kind);
      if (plan?.warnings.includes("source-unavailable")) return <article className="contribution-card unavailable" key={kind}><h2>{title(kind)}</h2><p>Source financière indisponible</p><span>Aucun montant supposé</span></article>;
      if (!plan || !snapshot) return <article className="contribution-card unavailable" key={kind}><h2>{title(kind)}</h2><p>{loading ? "Chargement…" : error ? "Données indisponibles" : "Objectif privé non configuré"}</p><span>Aucun montant supposé</span></article>;
      const m = contributionMetrics(plan, snapshot);
      const uncertain = plan.attribution !== "confirmed" || (kind === "resp" && !plan.beneficiaryConfirmed);
      return <article key={kind} className={`contribution-card${m.reached ? " reached" : m.effort ? " effort" : ""}`} aria-labelledby={`contribution-${kind}`}>
        <header><div><h2 id={`contribution-${kind}`}>{title(kind)}</h2>{kind === "resp" && <p>{plan.beneficiary || "Bénéficiaire"}{!plan.beneficiaryConfirmed && " · à confirmer"}</p>}</div>{m.reached && <span className="contribution-achieved"><Check size={16} aria-hidden="true" />Objectif atteint</span>}</header>
        <div className="contribution-goal"><span>Objectif personnel</span><strong>{money(plan.goalCents, plan.currency)}</strong></div>
        <div className="contribution-progress-label"><span><strong>{money(plan.identifiedCents, plan.currency)}</strong><span>Versements identifiés</span></span><strong>{new Intl.NumberFormat("fr-CA", {maximumFractionDigits: 1}).format(m.percent)} %</strong></div>
        <progress max={100} value={Math.min(100, m.percent)} aria-label={`${title(kind)} : versements identifiés par rapport à l’objectif personnel`} aria-valuetext={`${money(plan.identifiedCents, plan.currency)} identifiés sur ${money(plan.goalCents, plan.currency)}`} />
        {inferenceLabel(plan.inferenceStatus) && <p className="contribution-inferred-summary">{inferenceLabel(plan.inferenceStatus)}</p>}
        {(plan.inferredCents ?? 0) > 0 && <p className="contribution-inferred-summary"><strong>{money(plan.inferredCents!, plan.currency)}</strong> déduits, hors total<br /><span>Réception non confirmée</span></p>}
        {kind === "rrsp" && plan.weeklyForecast && <div className="contribution-forecast-summary"><span>À venir · estimation</span><strong>{money(m.forecastCents, plan.currency)}</strong><small>Hors progression</small></div>}
        <div className="contribution-bottom"><div><span>{kind === "rrsp" ? "Restant après prévision" : "Restant"}</span><strong>{money(m.remainingCents, plan.currency)}</strong></div><div><span>Temps restant</span><strong>{m.remainingDays === 0 ? "Échéance atteinte" : `${m.months} mois ${m.days} j`}</strong></div></div>
        <div className="contribution-state">{uncertain ? <span><CircleAlert size={16} aria-hidden="true" />{kind === "resp" && !plan.beneficiaryConfirmed ? "Bénéficiaire à confirmer" : "Attribution à confirmer"}</span> : null}{m.effort && <span><CircleAlert size={16} aria-hidden="true" />{m.remainingDays === 0 ? "Effort restant après échéance" : "Effort supérieur à 1 000 $/mois"}</span>}{plan.warnings.length > 0 && <span>Données partielles · voir les versements</span>}</div>
        <button type="button" className="contribution-open" aria-label={`Voir les versements ${title(kind)}`} onClick={() => setSelected(plan)}>Voir les versements<ChevronRight size={18} aria-hidden="true" /></button>
      </article>;
    })}</div>
    <Sheet open={selected !== null} onClose={() => setSelected(null)} title={`Versements ${selected ? title(selected.kind) : ""}`} className="contribution-sheet" resetScrollOnOpen>{selected && snapshot && <ContributionDetails plan={selected} snapshot={snapshot} />}</Sheet>
  </section>;
}
