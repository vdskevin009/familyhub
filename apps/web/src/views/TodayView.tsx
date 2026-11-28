import { useEffect, useId, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { ArrowRight, CheckCircle2, ChevronDown, ChevronRight, CircleDollarSign, Clock3, FileCheck2, HeartHandshake, Home, Info, MessageCircle, RefreshCw, Settings2, ShieldCheck, ShoppingBasket, TrendingDown, WifiOff } from "lucide-react";
import { Notice, PageHeader, Sheet, SkeletonList } from "../ui/primitives";
import type { HubState } from "../state";
import type { AppView } from "../types";
import { runWorkerTask } from "../worker";
import { dateOnly, opportunityHref, opportunitySnoozeTiming, type Opportunity } from "../opportunities";
import { useOpportunities } from "../useOpportunities";

type Props = {
  hub: HubState;
  onNavigate: (view: AppView) => void;
  onOpenTarget: (href: string) => void;
  commandOpen: boolean;
  onCommandOpenChange: (open: boolean) => void;
};
const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 2 });
const domainLabels: Record<Opportunity["domain"], string> = { claims: "Reimbursement", insurance: "Insurance", subscriptions: "Subscription", finances: "Finances", groceries: "Groceries", mortgage: "Mortgage", system: "Service" };
const domainIcons = { claims: HeartHandshake, insurance: ShieldCheck, subscriptions: TrendingDown, finances: CircleDollarSign, groceries: ShoppingBasket, mortgage: Home, system: Settings2 };
const periods = { once: "one-time", month: "/ month", year: "/ year", "first-year": "over 12 months" };
function dateLabel(value: string | null | undefined, withTime = false) {
  if (!value || (value.length === 10 && dateOnly(value) !== value)) return "Date unknown";
  const date = new Date(value.length === 10 ? value + "T12:00:00" : value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-CA", { day: "numeric", month: "short", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } as const : {}) }).format(date) : "Date unknown";
}
function benefitLabel(opportunity: Opportunity) {
  return opportunity.benefit.amount === null ? opportunity.benefit.label : money.format(opportunity.benefit.amount);
}
function decisionLabel(opportunity: Opportunity) {
  if (opportunity.decision === "snoozed") return "Snoozed";
  if (opportunity.decision === "dismissed") return "Hidden";
  if (opportunity.decision === "resolved") return "Handled";
  return opportunity.freshness === "stale" ? "Needs refreshing" : opportunity.status === "waiting" ? "Pending" : opportunity.status === "ready" ? "To prepare" : opportunity.status === "unavailable" ? "Unavailable" : "Needs review";
}

export default function TodayView({ hub, onNavigate, onOpenTarget, commandOpen, onCommandOpenChange }: Props) {
  const feed = useOpportunities(hub.worker, hub.savings.Reviews);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [showAll, setShowAll] = useState(false);
  const [showManaged, setShowManaged] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState("");
  const [notice, setNotice] = useState("");
  const askGeneration = useRef(0);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  useEffect(() => { askGeneration.current++; setAsking(false); setAnswer(""); setAskError(""); setSelectedId(null); setNotice(""); return () => { askGeneration.current++; }; }, [hub.worker.Endpoint, hub.worker.ApiKey]);
  const actions = feed.opportunities.filter(item => item.status !== "waiting");
  const followUps = feed.opportunities.filter(item => item.status === "waiting");
  const visible = showAll ? actions : actions.slice(0, 3);
  const managed = feed.allOpportunities.filter(item => item.decision && item.decision !== "seen");
  const selected = feed.allOpportunities.find(item => item.id === selectedId);
  const snoozeWarningId = useId();
  const now = new Date();
  const due = selected?.dueDate ?? null;
  const weekTiming = opportunitySnoozeTiming(due, 7 * 86_400_000, now);
  const hourTiming = opportunitySnoozeTiming(due, 3_600_000, now);
  const snoozeWarning = weekTiming === "past" ? "This deadline has passed. Snoozing won’t extend it."
    : weekTiming === "today" ? "This deadline is today. The cutoff time is unknown, so even one hour could be too late."
    : hourTiming === "same-day" ? `A one-hour snooze returns on the deadline, ${dateLabel(due)}. The cutoff time is unknown.`
    : weekTiming === "after" ? `A 7-day snooze returns after the deadline of ${dateLabel(due)}.`
    : weekTiming === "same-day" ? `A 7-day snooze returns on the deadline, ${dateLabel(due)}. The cutoff time is unknown.` : null;
  const sourceErrors = feed.sources.filter(source => source.status === "error");
  const partialSources = feed.sources.filter(source => source.coverage?.complete === false);
  const claimsPartial = partialSources.some(source => source.id === "claims");
  const accessibleSources = feed.sources.filter(source => source.status === "ready").length;
  const numericPotential = feed.allOpportunities.filter(item => item.benefit.kind === "potential" && item.benefit.amount !== null && item.freshness === "fresh");
  const unknownPotential = feed.allOpportunities.filter(item => item.domain !== "system" && item.benefit.kind !== "recoverable" && item.benefit.kind !== "time" && item.benefit.amount === null);
  const sourceLabel = !online ? "Offline" : feed.loading ? "Checking sources…" : !feed.configured ? "Connect your PC" : sourceErrors.length ? sourceErrors.length + " source" + (sourceErrors.length > 1 ? "s" : "") + " to review" : partialSources.length ? partialSources.length + (partialSources.length === 1 ? " partial source" : " partial sources") : accessibleSources + " sources reachable";
  const followLink = (event: MouseEvent<HTMLAnchorElement>, item: Opportunity) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onOpenTarget(opportunityHref(item.target));
  };
  async function decide(item: Opportunity, action: "seen" | "snooze" | "dismiss" | "resolve" | "restore", delayMs = 7 * 86_400_000) {
    setNotice("");
    const options = action === "snooze" ? { snoozedUntil: new Date(Date.now() + delayMs).toISOString() } : undefined;
    const saved = await feed.setAction(item, action, options);
    if (!saved) return;
    setSelectedId(null);
    setNotice(action === "snooze" ? `Snoozed for ${delayMs === 3_600_000 ? "1 hour" : "7 days"}. Returns ${dateLabel(options?.snoozedUntil, true)}.` : action === "dismiss" ? "Hidden. You can restore it from Managed items." : action === "restore" ? "Restored to your actions." : action === "resolve" ? "Marked as handled. No savings or submission is confirmed." : "Marked as read.");
  }
  async function ask(event: FormEvent) {
    event.preventDefault();
    const prompt = question.trim();
    if (!prompt || asking || !feed.connected || !online) return;
    const generation = askGeneration.current;
    setAsking(true); setAnswer(""); setAskError("");
    try {
      const context = JSON.stringify({
        observedSources: feed.sources,
        priorities: feed.allOpportunities.map(item => ({ title: item.title, domain: item.domain, description: item.description, benefit: item.benefit, dueDate: item.dueDate, sourceDate: item.sourceDate, freshness: item.freshness, evidence: item.evidence, decision: item.decision })),
        potentialRecovery: feed.recoverable, confirmedSavings: null
      });
      const task = await runWorkerTask(hub.worker, "general",
        "You are the private FamilyHub assistant. Reply briefly in Canadian English with one useful next action. Use only the supplied summary. Distinguish facts, unknowns, older sources and potential amounts. No confirmed savings have been established. Do not take external action or claim to have done so. A reachable connection does not prove a recent collection.\n\nPRIVATE SUMMARY\n" + context + "\n\nQUESTION\n" + prompt);
      if (generation !== askGeneration.current) return;
      if (task.status === "failed") throw new Error(task.error || "Your PC could not finish the response.");
      setAnswer(task.result || "No text was returned. You can try again.");
    } catch (error) { if (generation === askGeneration.current) setAskError(error instanceof Error ? error.message : "The request did not complete."); }
    finally { if (generation === askGeneration.current) setAsking(false); }
  }
  function opportunityCard(item: Opportunity, rank?: number) {
    const Icon = domainIcons[item.domain];
    const isManaged = Boolean(item.decision && item.decision !== "seen");
    return <article className={`opportunity-card${rank === 0 ? " opportunity-first" : ""}${isManaged ? " opportunity-managed" : ""}`} data-domain={item.domain} key={item.id}>
      <div className="opportunity-top"><span className="opportunity-domain"><span className="opportunity-icon"><Icon size={20} aria-hidden="true" /></span>{domainLabels[item.domain]}</span><span className={`opportunity-status${item.freshness === "stale" || item.status === "unavailable" ? " caution" : ""}`}>{decisionLabel(item)}</span></div>
      <div className="opportunity-heading"><h3>{item.title}</h3><p className="opportunity-description">{item.description}</p></div>
      <div className="opportunity-value"><div className={item.benefit.amount === null ? "opportunity-benefit unknown" : "opportunity-benefit"}><strong>{benefitLabel(item)}</strong>{item.benefit.amount !== null && <span>{item.benefit.period ? periods[item.benefit.period] : "period unconfirmed"}</span>}</div>
        {item.benefit.amount !== null && <p className="opportunity-qualification">{item.benefit.label} · unconfirmed</p>}</div>
      {(item.dueDate || item.decision === "seen" || item.decision === "snoozed" || item.freshness !== "fresh") && <div className="opportunity-meta">{item.decision === "snoozed" && <span><Clock3 size={14} aria-hidden="true" />Returns: {dateLabel(item.snoozedUntil, true)}</span>}{item.dueDate && <span><Clock3 size={14} aria-hidden="true" />Deadline: {dateLabel(item.dueDate)}</span>}{item.freshness !== "fresh" && <span className="opportunity-evidence-state">{item.freshness === "stale" ? "Older data" : "Freshness unknown"}</span>}{item.decision === "seen" && <span>Already viewed</span>}</div>}
      <div className="opportunity-actions"><a className="button" href={opportunityHref(item.target)} onClick={event => followLink(event, item)}>{item.actionLabel}<ArrowRight size={17} aria-hidden="true" /></a><button type="button" className="opportunity-details" onClick={() => { setNotice(""); setSelectedId(item.id); }} aria-label={`Sources and options: ${item.title}`} aria-haspopup="dialog"><Info size={18} aria-hidden="true" /><span>Sources and options</span></button></div>
    </article>;
  }

  const benefitSummary = <section className="today-benefits" aria-label="Distinct amounts, without double counting">
        <button type="button" className="benefit-tile recovery-tile" onClick={() => setSummaryOpen(true)} aria-haspopup="dialog"><HeartHandshake size={20} aria-hidden="true" /><span>Potential recovery</span><strong>{feed.sources.find(source => source.id === "claims")?.status === "loading" ? "…" : feed.recoverable.amount === null ? "Needs review" : money.format(feed.recoverable.amount)}</strong><small>{claimsPartial ? "Partial coverage" : "Potential · one-time"}</small></button>
        <button type="button" className="benefit-tile" onClick={() => setSummaryOpen(true)} aria-haspopup="dialog"><TrendingDown size={20} aria-hidden="true" /><span>Potential savings</span><strong>{feed.loading ? "…" : numericPotential.length ? numericPotential.length + (numericPotential.length === 1 ? " item" : " items") : "No estimate"}</strong><small>Based on available evidence</small></button>
        <button type="button" className="benefit-tile" onClick={() => setSummaryOpen(true)} aria-haspopup="dialog"><FileCheck2 size={20} aria-hidden="true" /><span>Realized savings</span><strong>Not measured</strong><small>Evidence required</small></button>
      </section>;

  return <div className="view-stack today-view">
    <PageHeader title="Today" subtitle="Your priorities, based on available evidence" />
    <button type="button" className={`today-source-status${sourceErrors.length || partialSources.length || !online ? " caution" : ""}`} onClick={() => setSourceOpen(true)} aria-haspopup="dialog">
      {!online ? <WifiOff size={17} aria-hidden="true" /> : <span className="source-indicators" aria-hidden="true">{feed.sources.map(source => <span key={source.id} className={`source-dot ${source.status}`} />)}</span>}<span>{sourceLabel}</span><ChevronRight size={16} aria-hidden="true" />
    </button>
    {!online && <div className="today-state" role="status"><WifiOff size={20} aria-hidden="true" /><div><strong>Connection interrupted</strong><p>Amounts reflect the last successful read in this session. Reconnect and refresh before relying on them.</p></div></div>}
    {!feed.configured && !feed.loading && <div className="today-empty"><span className="today-empty-icon"><Home size={25} aria-hidden="true" /></span><h2>Find your priorities</h2><p>Connect your PC to see your records and next actions.</p><button type="button" className="button" onClick={() => onNavigate("more")}>Open settings<ArrowRight size={17} aria-hidden="true" /></button></div>}
    {feed.configured && <>

      <section className="today-priorities" aria-labelledby="today-priorities-title" aria-busy={feed.loading}>
        <div className="today-section-heading"><div><h2 id="today-priorities-title">Your next actions{!feed.loading && <span className="today-action-count">{actions.length}</span>}</h2>{feed.loading && <p>Reading records from your PC</p>}</div><button type="button" className="icon-button" onClick={feed.refresh} disabled={feed.loading || !online} aria-label="Refresh priorities" title="Refresh"><RefreshCw size={19} aria-hidden="true" /></button></div>
        {visible.length ? <><div className="opportunity-list">{opportunityCard(visible[0], 0)}</div>{benefitSummary}{visible.length > 1 && <div className="opportunity-list">{visible.slice(1).map(item => opportunityCard(item))}</div>}</> : feed.loading ? <SkeletonList label="Reading sources for your priorities" /> : <div className="today-empty"><CheckCircle2 size={25} aria-hidden="true" /><h3>{managed.length ? "Your opportunities are set aside" : sourceErrors.length ? "Priorities are incomplete" : "No actionable items found"}</h3><p>{sourceErrors.length ? "Some sources did not respond. Check their status before assuming everything is up to date." : managed.length ? "Find your snoozed, hidden or handled items below." : "This result covers only the sources checked. No savings are assumed."}</p><button type="button" className="button secondary" onClick={() => setSourceOpen(true)}>View sources</button></div>}
        {!visible.length && benefitSummary}
        {actions.length > 3 && <button type="button" className="today-more-button" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>{showAll ? "Back to top 3" : "View all " + actions.length + " actions"}<ChevronDown size={17} aria-hidden="true" /></button>}
      </section>
      {followUps.length > 0 && <section className="today-follow-ups" aria-labelledby="today-follow-ups-title"><div className="today-section-heading"><div><h2 id="today-follow-ups-title">In progress</h2><p>Waiting for a response. No further contact has been made.</p></div></div>{followUps.map(item => <article className="today-follow-up" key={item.id}><div><span className="opportunity-status">Pending</span><h3>{item.description}</h3><p>{item.dueDate ? "Deadline: " + dateLabel(item.dueDate) : "Deadline unknown"}</p></div><button type="button" className="opportunity-details" onClick={() => setSelectedId(item.id)} aria-label={`Sources and options: ${item.title}`} aria-haspopup="dialog">View follow-up<ChevronRight size={18} aria-hidden="true" /></button></article>)}</section>}
      {managed.length > 0 && <section className="today-managed"><button type="button" className="today-disclosure" onClick={() => setShowManaged(!showManaged)} aria-expanded={showManaged}><span>Managed items <small>{managed.length}</small></span><ChevronDown size={18} aria-hidden="true" /></button>{showManaged && <div className="opportunity-list">{managed.map(item => opportunityCard(item))}</div>}</section>}
      {notice && <Notice onDismiss={() => setNotice("")}>{notice}</Notice>}
      {feed.actionError && <Notice error>{feed.actionError}</Notice>}
    </>}
    <section className="today-assistant">
      <button type="button" className="today-disclosure" onClick={() => onCommandOpenChange(!commandOpen)} aria-expanded={commandOpen} aria-controls="today-ask-body"><span className="today-ask-label"><MessageCircle size={20} aria-hidden="true" /><span><strong>Ask FamilyHub</strong><small>An answer based on your priorities</small></span></span><ChevronDown size={19} aria-hidden="true" /></button>
      {commandOpen && <div className="today-ask-body" id="today-ask-body">
        {!feed.connected || !online ? <p>Your PC must be reachable to answer. <button type="button" className="text-action" onClick={() => onNavigate("more")}>Check connection</button></p> : <form onSubmit={ask}><label htmlFor="today-question">Your question</label><textarea id="today-question" value={question} onChange={event => setQuestion(event.target.value)} placeholder="Which action can I prepare first?" rows={3} /><button className="button" disabled={asking || !question.trim()}>{asking ? "Working on an answer…" : "Ask"}</button></form>}
        {asking && <p role="status">Your PC is preparing the answer…</p>}{askError && <Notice error>{askError}</Notice>}{answer && <div className="today-answer" role="status">{answer}</div>}
        <p className="today-fine-print">Only the card summaries are sent to your paired PC. Attachments are not included.</p>
      </div>}
    </section>

    <Sheet open={sourceOpen} onClose={() => setSourceOpen(false)} title="Source status" description="A successful read does not guarantee a recent collection." className="today-sheet" footer={<><button type="button" className="button secondary" onClick={() => onNavigate("more")}><Settings2 size={17} aria-hidden="true" />Settings</button><button type="button" className="button" onClick={feed.refresh} disabled={!feed.configured || feed.loading || !online}><RefreshCw size={17} aria-hidden="true" />Refresh</button></>}>
      <div className="today-source-list">{feed.sources.map(source => <article key={source.id}><div><h3>{source.label}</h3><span className={`opportunity-status${source.status === "error" || source.coverage?.complete === false ? " caution" : ""}`}>{source.status === "ready" ? source.coverage?.complete === false ? "Partial read" : "Reachable" : source.status === "loading" ? "Reading…" : source.status === "unpaired" ? "Not connected" : "Needs review"}</span></div><dl className="today-facts"><div><dt>Last read</dt><dd>{dateLabel(source.checkedAt, true)}</dd></div><div><dt>Source date</dt><dd>{dateLabel(source.sourceDate)}</dd></div></dl>{source.coverage?.complete === false && <p>{source.coverage.heldMessages ? `${source.coverage.heldMessages} held message${source.coverage.heldMessages === 1 ? "" : "s"}. ` : ""}Known claims are still visible. The total potentially recoverable is unknown.</p>}{source.error && <details><summary>Issue details</summary><p>{source.error}</p></details>}</article>)}</div>
      <p className="today-fine-print">Refresh reads data already on your PC. Collections and research run on their own schedules.</p>
    </Sheet>
    <Sheet open={summaryOpen} onClose={() => setSummaryOpen(false)} title="Understanding the amounts" description="Three separate categories. They are never added together." className="today-sheet">
      <section className="today-explanation"><HeartHandshake size={22} aria-hidden="true" /><h3>Potentially recoverable money</h3><p>{feed.recoverable.amount === null ? "The available evidence is not recent or complete enough to establish an amount." : money.format(feed.recoverable.amount) + " potentially recoverable across the claims included in the calculation."} This one-time amount is neither owed nor guaranteed.</p><p>{feed.recoverable.known} claims with a known amount · {feed.recoverable.unknown} amounts unknown. Each claim shows insurer order and payments received.</p></section>
      <section className="today-explanation"><TrendingDown size={22} aria-hidden="true" /><h3>Potential savings</h3>{numericPotential.length ? <ul>{numericPotential.map(item => <li key={item.id}>{item.title} : {benefitLabel(item)} {item.benefit.period ? periods[item.benefit.period] : "unknown period"}</li>)}</ul> : <p>No personal savings estimate has been established in the current cards.</p>}<p>{unknownPotential.length ? unknownPotential.length + " opportunities still need more data or a like-for-like comparison. " : ""}Costs, quantities, coverage and periods must be comparable before any decision.</p></section>
      <section className="today-explanation"><FileCheck2 size={22} aria-hidden="true" /><h3>Realized savings</h3><p>Not measured. Reading, hiding or resolving a card does not prove savings. A result must link to a verified payment or invoice, without double counting.</p></section>
    </Sheet>
    <Sheet open={Boolean(selected)} onClose={() => setSelectedId(null)} title={selected?.title || "Sources and options"} description={selected?.description} className="today-sheet" footer={selected && <a className="button" href={opportunityHref(selected.target)} onClick={event => followLink(event, selected)}>{selected.actionLabel}<ArrowRight size={17} aria-hidden="true" /></a>}>
      {selected && <>
        <div className="today-detail-benefit"><span>{domainLabels[selected.domain]}</span><strong>{benefitLabel(selected)}</strong><p>{selected.benefit.amount === null ? "No amount is assumed." : (selected.benefit.period ? periods[selected.benefit.period] : "Period unconfirmed") + " · potential, not confirmed"}</p></div>
        <dl className="today-facts"><div><dt>Deadline</dt><dd>{selected.dueDate ? dateLabel(selected.dueDate) : "Unknown"}</dd></div><div><dt>Source date</dt><dd>{dateLabel(selected.sourceDate)}</dd></div><div><dt>Freshness</dt><dd>{selected.freshness === "fresh" ? "Within the validity period" : selected.freshness === "stale" ? "Needs refreshing" : "Not established"}</dd></div><div><dt>Confidence</dt><dd>{selected.confidence === "verified" ? "Verified evidence" : selected.confidence === "conditional" ? "Conditional" : "Not established"}</dd></div></dl>
        <h3>Evidence and conditions</h3><ul className="today-evidence">{selected.evidence.map((evidence, index) => <li key={index}>{evidence}</li>)}</ul>
        <section className="today-card-options">
          <h3>Manage this item</h3>
          <p>Your decision is saved on your PC. New evidence can bring the item back.</p>
          {!feed.actionsAvailable ? <p role="status">Tracking unavailable. Check the connection or service version in Settings.</p> : selected.decision && selected.decision !== "seen" ? <button type="button" className="button secondary" disabled={feed.actionBusy || !online} onClick={() => void decide(selected, "restore")}>Restore to my actions</button> : <div className="today-option-buttons">
            {snoozeWarning && <div id={snoozeWarningId}><Notice warning>{snoozeWarning}</Notice></div>}
            {selected.decision !== "seen" && <button type="button" className="button secondary" disabled={feed.actionBusy || !online} onClick={() => void decide(selected, "seen")}>Mark as read</button>}
            <button type="button" className="button secondary" aria-describedby={snoozeWarning ? snoozeWarningId : undefined} disabled={feed.actionBusy || !online} onClick={() => void decide(selected, "snooze", 3_600_000)}><Clock3 size={17} aria-hidden="true" />Snooze for 1 hour</button>
            <button type="button" className="button secondary" aria-describedby={snoozeWarning ? snoozeWarningId : undefined} disabled={feed.actionBusy || !online} onClick={() => void decide(selected, "snooze")}><Clock3 size={17} aria-hidden="true" />Snooze for 7 days</button>
            <button type="button" className="button secondary" disabled={feed.actionBusy || !online} onClick={() => void decide(selected, "dismiss")}>Hide this item</button>
            <button type="button" className="button secondary" disabled={feed.actionBusy || !online} onClick={() => void decide(selected, "resolve")}>Mark as handled</button>
            <p className="today-fine-print">Marking this as handled does not confirm savings or a submission.</p>
          </div>}
          {feed.actionBusy && <p role="status">Saving to your PC…</p>}
          {feed.actionError && <Notice error>{feed.actionError}</Notice>}
        </section>
      </>}
    </Sheet>
  </div>;
}
