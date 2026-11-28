import { useEffect, useState } from "react";
import { Check, ChevronRight, CircleAlert } from "lucide-react";
import type { WorkerConfig } from "../types";
import { PageHeader, Sheet } from "../ui/primitives";
import { contributionMetrics, type ContributionCard, type ContributionPayment, type ContributionsSnapshot } from "../contributions";
import { fetchContributions } from "../contributions-api";
import "../contributions.css";
import "../finance-visual.css";

const title = (kind: ContributionCard["kind"]) => kind === "rrsp" ? "RRSP" : "RESP";
const money = (cents: number, currency: string) => new Intl.NumberFormat("en-CA", { style: "currency", currency, maximumFractionDigits: 2 }).format(cents / 100);
const date = (day: string) => new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(day + "T12:00:00Z"));
const warningLabel = (warning: string) => ({
  "Fraîcheur de la source non confirmée.": "Source freshness has not been confirmed.",
  "source-freshness-unverified": "Source freshness has not been confirmed.",
  "source-unavailable": "Financial source unavailable.",
  "destination-unverified": "Check the destination account.",
  "source-account-unverified": "Check the source account.",
  "coverage-incomplete": "History is incomplete for this period.",
  "source-not-current": "The latest collection does not cover today.",
  "pending-excluded": "Pending transactions are excluded.",
  "source-limitations": "The source reports coverage limitations.",
  "excluded-observations": "Some transactions were excluded after review.",
}[warning] || warning);

const inferenceLabel = (status: ContributionCard["inferenceStatus"]) => ({
  "not-configured": "Inferred allocations are not configured.",
  "requires-review": "Inferred allocations need review.",
  "source-unavailable": "Inferred allocations are unavailable because the source is missing.",
  "partial-conflict": "Inferred allocations are partial. Conflicting data was excluded.",
  "partial-canonical-overlap": "Inferred allocations are partial. Possible duplicates were excluded.",
  "available": "",
}[status ?? "available"]);
const inferenceRationale = (rationale: string) =>
  rationale === "Même référence de destination que des virements antérieurs explicitement attribués. Réception bancaire non vérifiée."
    ? "The destination reference matches earlier transfers with confirmed allocation. Bank receipt has not been verified."
    : rationale;

function Payments({ heading, rows, currency }: { heading: string; rows: ContributionPayment[]; currency: string }) {
  return <section className="contribution-payments"><h3>{heading}</h3>{rows.length ? <ul>{rows.map(row => <li key={row.id}><time dateTime={row.date}>{date(row.date)}</time><strong>{money(row.amountCents, currency)}</strong></li>)}</ul> : <p>No contributions identified.</p>}</section>;
}
function ContributionDetails({ plan, snapshot }: { plan: ContributionCard; snapshot: ContributionsSnapshot }) {
  const m = contributionMetrics(plan, snapshot);
  return <div className="contribution-details">
    <dl className="contribution-detail-summary"><div><dt>Personal goal</dt><dd>{money(plan.goalCents, plan.currency)}</dd></div><div><dt>Deadline</dt><dd>{date(plan.deadline)}</dd></div><div><dt>Evaluated on</dt><dd>{date(snapshot.evaluatedOn)}</dd></div></dl>
    <p>Identified contributions are not a tax receipt and do not represent contribution room.</p>
    <p>Source date: {plan.sourceAsOf ? date(plan.sourceAsOf.slice(0, 10)) : "unconfirmed"}. Retrieved: {plan.retrievedAt ? date(plan.retrievedAt.slice(0, 10)) : "unconfirmed"}.</p>
    {plan.kind === "resp" && <p>{plan.beneficiaryConfirmed ? `Confirmed beneficiary: ${plan.beneficiary}.` : "Confirm the beneficiary before confirming that the goal has been reached."} Personal goal for the calendar year. No grant is assumed.</p>}
    {plan.attribution !== "confirmed" && <p className="contribution-caution">Contribution allocation needs confirmation.</p>}
    {plan.kind === "rrsp" && <><Payments heading="Completed weekly contributions" rows={plan.weeklyPaid} currency={plan.currency} /><section className="contribution-forecast"><h3>Estimated future weekly contributions</h3>{plan.weeklyForecast ? <><p><strong>{money(m.forecastCents, plan.currency)}</strong> projected{m.remainingDays > 0 ? ` (${plan.weeklyForecast.count} × ${money(plan.weeklyForecast.amountCents, plan.currency)})` : ": deadline reached"}.</p><p>{plan.weeklyForecast.assumption}</p><p>Not yet paid. These amounts do not count toward progress or the goal.</p></> : <p>No forecast is configured. No future contributions are assumed.</p>}</section></>}
    <Payments heading={plan.kind === "rrsp" ? "One-time contributions" : "Identified contributions"} rows={plan.kind === "rrsp" ? plan.oneOffPaid : [...plan.weeklyPaid, ...plan.oneOffPaid].sort((a, b) => b.date.localeCompare(a.date))} currency={plan.currency} />
    {inferenceLabel(plan.inferenceStatus) && <p className="contribution-caution">{inferenceLabel(plan.inferenceStatus)} Unknown amounts are not treated as zero.</p>}
    {(plan.inferredPayments?.length ?? 0) > 0 && <section className="contribution-inferred"><h3>Inferred allocation: {money(plan.inferredCents ?? 0, plan.currency)}</h3><p>The destination is inferred from past transfers. The bank has not confirmed receipt. These amounts are separate from identified contributions, progress and the amount remaining.</p><ul>{plan.inferredPayments!.map(row => <li key={row.id}><div><time dateTime={row.date}>{date(row.date)}</time><strong>{money(row.amountCents, plan.currency)}</strong></div><p>{inferenceRationale(row.rationale)}</p><p>{row.evidenceTransactionIds.length} historical reference(s). Collected on: {date(row.collectedAt.slice(0, 10))}, not a date of bank receipt.</p></li>)}</ul></section>}
    <section><h3>Amount remaining</h3><p>{money(m.remainingCents, plan.currency)}{plan.kind === "rrsp" ? " after forecast weekly contributions" : " left to contribute"}.</p><p>{m.monthlyCents === null ? "The deadline has passed. No monthly amount is estimated." : `About ${money(Math.round(m.monthlyCents), plan.currency)} per month.`} Assumption: one month = {snapshot.daysPerMonth} days, to be confirmed. Orange indicates more than $1,000 per month.</p></section>
    <section><h3>Excluded, unallocated transfers</h3><p>These transfers are not included in identified contributions or forecasts.</p>{plan.unassigned.length > 0 && <Payments heading="Needs review" rows={plan.unassigned} currency={plan.currency} />}{!plan.unassigned.length && <p>No unallocated transfers were found in the data received.</p>}</section>
    {plan.warnings.length > 0 && <section><h3>Data limitations</h3><ul>{[...new Set(plan.warnings.map(warningLabel))].map((warning, i) => <li key={i}>{warning}</li>)}</ul></section>}
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
    void fetchContributions(worker, controller.signal).then(result => { if (!controller.signal.aborted) setSnapshot(result); }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Contributions unavailable."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [worker.Endpoint, worker.ApiKey, attempt]);
  return <section className="view-stack contributions-view">
    {embedded ? <div className="compact-heading"><h2>Contributions</h2><button type="button" className="button secondary" disabled={loading} onClick={() => setAttempt(n => n + 1)}>Refresh contributions</button></div> : <PageHeader title="Contributions"><button type="button" className="button secondary" disabled={loading} onClick={() => setAttempt(n => n + 1)}>Refresh</button></PageHeader>}
    <div role="status" className={loading || error ? "notice" : "sr-only"}>{loading ? "Loading contributions…" : error || "Contributions loaded."}</div>
    <div className="contribution-cards">{(["rrsp", "resp"] as const).map(kind => {
      const plan = snapshot?.plans.find(p => p.kind === kind);
      if (plan?.warnings.includes("source-unavailable")) return <article className="contribution-card unavailable" key={kind}><h2>{title(kind)}</h2><p>Financial source unavailable</p><span>No amount assumed</span></article>;
      if (!plan || !snapshot) return <article className="contribution-card unavailable" key={kind}><h2>{title(kind)}</h2><p>{loading ? "Loading…" : error ? "Data unavailable" : "Private goal not configured"}</p><span>No amount assumed</span></article>;
      const m = contributionMetrics(plan, snapshot);
      const uncertain = plan.attribution !== "confirmed" || (kind === "resp" && !plan.beneficiaryConfirmed);
      return <article key={kind} className={`contribution-card${m.reached ? " reached" : m.effort ? " effort" : ""}`} aria-labelledby={`contribution-${kind}`}>
        <header><div><h2 id={`contribution-${kind}`}>{title(kind)}</h2>{kind === "resp" && <p>{plan.beneficiary || "Beneficiary"}{!plan.beneficiaryConfirmed && " · Needs confirmation"}</p>}</div>{m.reached && <span className="contribution-achieved"><Check size={16} aria-hidden="true" />Goal reached</span>}</header>
        <div className="contribution-goal"><span>Personal goal</span><strong>{money(plan.goalCents, plan.currency)}</strong></div>
        <div className="contribution-progress-label"><span><strong>{money(plan.identifiedCents, plan.currency)}</strong><span>Identified contributions</span></span><strong>{new Intl.NumberFormat("en-CA", {maximumFractionDigits: 1}).format(m.percent)}%</strong></div>
        <progress max={100} value={Math.min(100, m.percent)} aria-label={`${title(kind)}: identified contributions toward the personal goal`} aria-valuetext={`${money(plan.identifiedCents, plan.currency)} identified out of ${money(plan.goalCents, plan.currency)}`} />
        {inferenceLabel(plan.inferenceStatus) && <p className="contribution-inferred-summary">{inferenceLabel(plan.inferenceStatus)}</p>}
        {(plan.inferredCents ?? 0) > 0 && <p className="contribution-inferred-summary"><strong>{money(plan.inferredCents!, plan.currency)}</strong> inferred, excluded from total<br /><span>Receipt unconfirmed</span></p>}
        {kind === "rrsp" && plan.weeklyForecast && <div className="contribution-forecast-summary"><span>Estimated future contributions</span><strong>{money(m.forecastCents, plan.currency)}</strong><small>Not counted toward progress</small></div>}
        <div className="contribution-bottom"><div><span>{kind === "rrsp" ? "Remaining after forecast" : "Remaining"}</span><strong>{money(m.remainingCents, plan.currency)}</strong></div><div><span>Time remaining</span><strong>{m.remainingDays === 0 ? "Deadline reached" : `${m.months} mo ${m.days} d`}</strong></div></div>
        <div className="contribution-state">{uncertain ? <span><CircleAlert size={16} aria-hidden="true" />{kind === "resp" && !plan.beneficiaryConfirmed ? "Beneficiary needs confirmation" : "Allocation needs confirmation"}</span> : null}{m.effort && <span><CircleAlert size={16} aria-hidden="true" />{m.remainingDays === 0 ? "Amount remaining after deadline" : "More than $1,000 per month needed"}</span>}{plan.warnings.length > 0 && <span>Partial data · view contributions</span>}</div>
        <button type="button" className="contribution-open" aria-label={`View ${title(kind)} contributions`} onClick={() => setSelected(plan)}>View contributions<ChevronRight size={18} aria-hidden="true" /></button>
      </article>;
    })}</div>
    <Sheet open={selected !== null} onClose={() => setSelected(null)} title={`${selected ? title(selected.kind) + " " : ""}Contributions`} className="contribution-sheet" resetScrollOnOpen>{selected && snapshot && <ContributionDetails plan={selected} snapshot={snapshot} />}</Sheet>
  </section>;
}
