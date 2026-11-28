import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, ChevronRight, CircleAlert } from "lucide-react";
import type { WorkerConfig } from "../types";
import { PageHeader, Sheet } from "../ui/primitives";
import { contributionMetrics, type ContributionCard, type ContributionPayment, type ContributionsSnapshot } from "../contributions";
import { fetchContributions } from "../contributions-api";
import "../finance-visual.css";
import "../contributions.css";

const title = (kind: ContributionCard["kind"]) => kind === "rrsp" ? "RRSP" : "RESP";
const money = (cents: number, currency: string) => new Intl.NumberFormat("en-CA", { style: "currency", currency, maximumFractionDigits: 2 }).format(cents / 100);
const date = (day: string) => new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(day + "T12:00:00Z"));
const warningLabel = (warning: string) => ({
  "Fraîcheur de la source non confirmée.": "Source freshness has not been confirmed.",
  "source-freshness-unverified": "Source freshness has not been confirmed.",
  "source-unavailable": "Financial source unavailable.",
  "destination-unverified": "Check the destination account.",
  "source-account-unverified": "Check the source account.",
  "coverage-unverified": "Contribution coverage has not been confirmed.",
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

const sourceDay = (stamp?: string | null) => {
  const day = stamp?.slice(0, 10);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const time = Date.parse(day + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day ? day : null;
};
const hasCurrentSourceEvidence = (plan: ContributionCard, evaluatedOn: string) => {
  // Same calendar prefix as the detail display; do not shift the source date by timezone.
  const day = sourceDay(plan.sourceAsOf);
  return day !== null && day <= evaluatedOn;
};
const canShowGoalProgress = (plan: ContributionCard, evaluatedOn: string) =>
  Number.isSafeInteger(plan.goalCents) && plan.goalCents > 0
  && hasCurrentSourceEvidence(plan, evaluatedOn)
  && plan.warnings.length === 0
  && plan.attribution === "confirmed"
  && (plan.kind !== "resp" || plan.beneficiaryConfirmed);

const percentNumber = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2 });
const formattedPercent = (percent: number) => {
  if (percent > 0 && percent < 0.01) return "< 0.01%";
  if (percent < 100 && percent >= 99.995) return "< 100%";
  if (percent > 100 && percent < 100.005) return "> 100%";
  return percentNumber.format(percent) + "%";
};
type RingValue = Pick<ContributionCard, "goalCents" | "beneficiary" | "deadline"> & { percent: number };
function GoalRing({ plan, percent, previous }: { plan: ContributionCard; percent: number; previous?: RingValue }) {
  const clamped = Math.min(100, percent);
  const sameGoal = previous?.goalCents === plan.goalCents && previous.deadline === plan.deadline && previous.beneficiary === plan.beneficiary;
  const start = sameGoal ? Math.min(100, previous.percent) : clamped;
  const label = formattedPercent(percent);
  const compact = label.length > 9;
  return <div className="contribution-ring" data-contribution-ring>
    <div className="contribution-ring-art" aria-hidden="true">
      <svg viewBox="0 0 120 120" focusable="false">
        <circle className="contribution-ring-outline" cx="60" cy="60" r="52" />
        <circle className="contribution-ring-track" cx="60" cy="60" r="52" />
        <circle data-ring-fill className={start === clamped ? "contribution-ring-fill" : "contribution-ring-fill is-updating"} cx="60" cy="60" r="52" pathLength="100"
          style={{ "--ring-start": 100 - start, "--ring-end": 100 - clamped } as CSSProperties} />
      </svg>
      <div className="contribution-ring-centre"><span className={compact ? "contribution-ring-number compact" : "contribution-ring-number"}>{label}</span><span>of goal</span></div>
    </div>
    <progress className="sr-only" max={100} value={clamped} aria-label={`${title(plan.kind)}: progress toward your personal goal`}
      aria-valuetext={`${label} of goal. ${money(plan.identifiedCents, plan.currency)} identified out of ${money(plan.goalCents, plan.currency)}.`} />
  </div>;
}

/** Decorative duplicate of the adjacent text state; it represents no measured value. */
function UnconfirmedGoalRing() {
  return <div className="contribution-ring contribution-ring-unconfirmed" data-contribution-unconfirmed aria-hidden="true">
    <div className="contribution-ring-art">
      <svg viewBox="0 0 120 120" focusable="false">
        <circle className="contribution-ring-dashed" cx="60" cy="60" r="52" pathLength="100" />
      </svg>
      <div className="contribution-ring-centre"><span>Not<br />confirmed</span></div>
    </div>
  </div>;
}

function Payments({ heading, rows, currency }: { heading: string; rows: ContributionPayment[]; currency: string }) {
  return <section className="contribution-payments"><h3>{heading}</h3>{rows.length ? <ul>{rows.map(row => <li key={row.id}><time dateTime={row.date}>{date(row.date)}</time><strong>{money(row.amountCents, currency)}</strong></li>)}</ul> : <p>No contributions identified.</p>}</section>;
}
function ContributionDetails({ plan, snapshot }: { plan: ContributionCard; snapshot: ContributionsSnapshot }) {
  const m = contributionMetrics(plan, snapshot);
  const recordedSourceDay = sourceDay(plan.sourceAsOf);
  return <div className="contribution-details">
    <dl className="contribution-detail-summary"><div><dt>Personal goal</dt><dd>{money(plan.goalCents, plan.currency)}</dd></div><div><dt>Deadline</dt><dd>{date(plan.deadline)}</dd></div><div><dt>Evaluated on</dt><dd>{date(snapshot.evaluatedOn)}</dd></div><div><dt>Time remaining</dt><dd>{m.remainingDays === 0 ? "Deadline reached" : `${m.months} mo ${m.days} d`}</dd></div></dl>
    <p>Identified contributions are not a tax receipt and do not represent contribution room.</p>
    <p>Source date: {recordedSourceDay ? date(recordedSourceDay) : "unconfirmed"}. Retrieved: {plan.retrievedAt ? date(plan.retrievedAt.slice(0, 10)) : "unconfirmed"}.</p>
    {recordedSourceDay && recordedSourceDay > snapshot.evaluatedOn && <p className="contribution-caution">The source date is after the evaluation date. Progress cannot be confirmed.</p>}
    {plan.kind === "resp" && <p>{plan.beneficiaryConfirmed ? `Confirmed beneficiary: ${plan.beneficiary}.` : "Confirm the beneficiary before confirming that the goal has been reached."} Personal goal for the calendar year. No grant is assumed.</p>}
    {plan.attribution !== "confirmed" && <p className="contribution-caution">Contribution allocation needs confirmation.</p>}
    {plan.kind === "rrsp" && <><Payments heading="Completed weekly contributions" rows={plan.weeklyPaid} currency={plan.currency} /><section className="contribution-forecast"><h3>Estimated future weekly contributions</h3>{plan.weeklyForecast ? <><p><strong>{money(m.forecastCents, plan.currency)}</strong> projected{m.remainingDays > 0 ? ` (${plan.weeklyForecast.count} × ${money(plan.weeklyForecast.amountCents, plan.currency)})` : ": deadline reached"}.</p><p>{plan.weeklyForecast.assumption}</p><p>Not yet paid. These amounts do not count toward progress or the goal.</p></> : <p>No forecast is configured. No future contributions are assumed.</p>}</section></>}
    <Payments heading={plan.kind === "rrsp" ? "One-time contributions" : "Identified contributions"} rows={plan.kind === "rrsp" ? plan.oneOffPaid : [...plan.weeklyPaid, ...plan.oneOffPaid].sort((a, b) => b.date.localeCompare(a.date))} currency={plan.currency} />
    {inferenceLabel(plan.inferenceStatus) && <p className="contribution-caution">{inferenceLabel(plan.inferenceStatus)} Unknown amounts are not treated as zero.</p>}
    {(plan.inferredPayments?.length ?? 0) > 0 && <section className="contribution-inferred"><h3>Inferred allocation: {money(plan.inferredCents ?? 0, plan.currency)}</h3><p>The destination is inferred from past transfers. The bank has not confirmed receipt. These amounts are separate from identified contributions, progress and the amount remaining.</p><ul>{plan.inferredPayments!.map(row => <li key={row.id}><div><time dateTime={row.date}>{date(row.date)}</time><strong>{money(row.amountCents, plan.currency)}</strong></div><p>{inferenceRationale(row.rationale)}</p><p>{row.evidenceTransactionIds.length} historical reference(s). Collected on: {date(row.collectedAt.slice(0, 10))}, not a date of bank receipt.</p></li>)}</ul></section>}
    <section><h3>Amount remaining</h3>{canShowGoalProgress(plan, snapshot.evaluatedOn) ? <><p>{money(m.remainingCents, plan.currency)}{plan.kind === "rrsp" ? " after forecast weekly contributions" : " left to contribute"}.</p><p>{m.monthlyCents === null ? "The deadline has passed. No monthly amount is estimated." : `About ${money(Math.round(m.monthlyCents), plan.currency)} per month.`} Assumption: one month = {snapshot.daysPerMonth} days, to be confirmed.</p></> : <p>The amount remaining cannot be confirmed. Check coverage and allocation.</p>}</section>
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
  const lastVerified = useRef<Partial<Record<ContributionCard["kind"], RingValue>>>({});
  const [previous, setPrevious] = useState<Partial<Record<ContributionCard["kind"], RingValue>>>({});
  useEffect(() => { lastVerified.current = {}; }, [worker.Endpoint, worker.ApiKey]);
  useEffect(() => {
    const controller = new AbortController();
    setSnapshot(null); setSelected(null); setError(""); setLoading(true);
    void fetchContributions(worker, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      const values: Partial<Record<ContributionCard["kind"], RingValue>> = {};
      for (const plan of result.plans) {
        if (canShowGoalProgress(plan, result.evaluatedOn)) values[plan.kind] = { goalCents: plan.goalCents, deadline: plan.deadline, beneficiary: plan.beneficiary, percent: contributionMetrics(plan, result).percent };
      }
      setPrevious(lastVerified.current);
      lastVerified.current = values;
      setSnapshot(result);
    }).catch(reason => {
      if (controller.signal.aborted) return;
      lastVerified.current = {};
      setError(reason instanceof Error ? reason.message : "Contributions unavailable.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [worker.Endpoint, worker.ApiKey, attempt]);
  return <section className="view-stack contributions-view">
    {embedded ? <div className="compact-heading"><h2>Contributions</h2><button type="button" className="button secondary" aria-disabled={loading} onClick={() => { if (!loading) setAttempt(n => n + 1); }}>Refresh contributions</button></div> : <PageHeader title="Contributions"><button type="button" className="button secondary" aria-disabled={loading} onClick={() => { if (!loading) setAttempt(n => n + 1); }}>Refresh</button></PageHeader>}
    <div role="status" className={loading || error ? "notice" : "sr-only"}>{loading ? "Loading contributions…" : error || "Contributions loaded."}</div>
    <div className="contribution-cards">{(["rrsp", "resp"] as const).map(kind => {
      const plan = snapshot?.plans.find(p => p.kind === kind);
      if (plan?.warnings.includes("source-unavailable")) return <article className="contribution-card unavailable" key={kind}><h2>{title(kind)}</h2><p>Financial source unavailable</p><span>No amount assumed</span></article>;
      if (!plan || !snapshot) return <article className="contribution-card unavailable" key={kind}><h2>{title(kind)}</h2><p>{loading ? "Loading…" : error ? "Data unavailable" : "Private goal not configured"}</p><span>No amount assumed</span></article>;
      const m = contributionMetrics(plan, snapshot);
      const reliable = canShowGoalProgress(plan, snapshot.evaluatedOn);
      const reached = reliable && m.reached;
      const gap = Math.max(0, plan.goalCents - plan.identifiedCents);
      const coverage = plan.warnings.length > 0 || !hasCurrentSourceEvidence(plan, snapshot.evaluatedOn);
      const attribution = kind === "resp" && !plan.beneficiaryConfirmed ? "Beneficiary needs confirmation" : plan.attribution !== "confirmed" ? "Allocation needs confirmation" : null;
      return <article key={kind} className={`contribution-card${reached ? " reached" : ""}`} aria-labelledby={`contribution-${kind}`}>
        <header>
          <div><h2 id={`contribution-${kind}`}>{title(kind)}</h2>{kind === "resp" && plan.beneficiary && <p>{plan.beneficiary}</p>}</div>
          {reached && <span className="contribution-achieved"><Check size={16} aria-hidden="true" />{m.percent > 100 ? "Goal exceeded" : "Goal reached"}</span>}
        </header>
        <div className="contribution-figure has-ring">
          <dl className="contribution-summary">
            <div className="contribution-identified"><dt>Identified contributions</dt><dd>{plan.identifiedCents > 0 || reliable ? money(plan.identifiedCents, plan.currency) : "Unconfirmed"}</dd></div>
            <div><dt>Personal goal</dt><dd>{money(plan.goalCents, plan.currency)}</dd></div>
            {reliable && <div><dt>Amount remaining</dt><dd>{money(gap, plan.currency)}</dd></div>}
          </dl>
          {reliable ? <GoalRing plan={plan} percent={m.percent} previous={previous[kind]} /> : <UnconfirmedGoalRing />}
        </div>
        {!reliable && <p className="contribution-state"><CircleAlert size={16} aria-hidden="true" /><span>{[coverage ? "Partial data" : null, attribution].filter(Boolean).join(" · ")}. Progress unconfirmed.</span></p>}
        <button type="button" className="contribution-open" aria-label={`View ${title(kind)} contributions`} onClick={() => setSelected(plan)}>View contributions<ChevronRight size={18} aria-hidden="true" /></button>
      </article>;
    })}</div>
    <Sheet open={selected !== null} onClose={() => setSelected(null)} title={`${selected ? title(selected.kind) + " " : ""}Contributions`} className="contribution-sheet" resetScrollOnOpen>{selected && snapshot && <ContributionDetails plan={selected} snapshot={snapshot} />}</Sheet>
  </section>;
}
