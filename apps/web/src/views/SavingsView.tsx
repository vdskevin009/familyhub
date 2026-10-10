import { useEffect, useRef, useState } from "react";
import { Plus, Pencil, Search, FileText, RefreshCw, TrendingDown, ChevronRight } from "lucide-react";
import { PageHeader, Sheet, Notice } from "../ui/primitives";
import { currency, recurringCandidates } from "../domain";
import type { HubState } from "../state";
import type { AppView } from "../types";
import { categories, newContract, missingInformation, effectiveContracts, monthlyPrice, publicBaseline,
  comparisonFingerprint, baselineKey, shortlistTotal, type SavingsContract, type SavingsCategory } from "../savings";
import { startSavingsResearch, fetchSavingsResearch } from "../worker";
import SavingsContractForm from "./SavingsContractForm";
import RecurringServices from "./RecurringServices";
import { contractMonthly } from "../savings";
import SavingsOfferCard from "./SavingsOfferCard";
import { useSavingsSharing } from "../savings-sharing";

const price = (value: number | null, code = "CAD") => value === null ? "Unknown" : new Intl.NumberFormat("en-CA", {style:"currency",currency:code}).format(value);
export default function SavingsView({ hub, onNavigate }: { hub: HubState; onNavigate: (view: AppView) => void }) {
  const contracts = effectiveContracts(hub.savings), reviews = hub.savings.Reviews ?? [];
  const [editing, setEditing] = useState<SavingsContract | null>(null);
  const [editingRevision, setEditingRevision] = useState<string | null>(null);
  const sharing = useSavingsSharing(hub);
  function openEditor(contract: SavingsContract) { setEditingRevision(sharing.revisionFor(contract)); setEditing(contract); }
  const [researching, setResearching] = useState<SavingsContract | null>(null);
  const [openResult, setOpenResult] = useState<string | null>(null);
  const [resultJob, setResultJob] = useState<string>("");
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const [starting, setStarting] = useState(false), startingRef = useRef(false);
  const [filter, setFilter] = useState<SavingsCategory | "all">("all");
  const pending = reviews.filter(review => review.job.status === "queued" || review.job.status === "running").map(review => review.job.id).join(",");
  useEffect(() => {
    if (!pending || !hub.worker.Endpoint || !hub.worker.ApiKey) return;
    let cancelled = false, timer: ReturnType<typeof setTimeout>, delay = 2000;
    const poll = async () => {
      try {
        for (const id of pending.split(",")) {
          const job = await fetchSavingsResearch(hub.worker, id);
          if (cancelled) return;
          hub.setSavings(previous => ({ ...previous, Reviews: (previous.Reviews ?? []).map(review => review.job.id === id ? { ...review, job } : review) }));
        }
        delay = 2000;
      } catch (err) { if (!cancelled) { setError(err instanceof Error ? err.message : "Could not refresh research. Saved contracts remain available."); delay = Math.min(delay * 2, 30_000); } }
      if (!cancelled) timer = setTimeout(() => void poll(), delay);
    };
    timer = setTimeout(() => void poll(), delay);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pending, hub.worker.Endpoint, hub.worker.ApiKey, hub.setSavings]);
  const latest = (id: string) => reviews.filter(review => review.job.contractId === id).at(-1);
  const entries = contracts.flatMap(contract => {
    const review = reviews.filter(review => review.job.contractId === contract.id && Object.values(review.decisions).includes("shortlist")).at(-1);
    if (!review?.job.report || review.localKey !== baselineKey(contract)) return [];
    return review.job.report.offers.flatMap((offer, index) => review.decisions[String(index)] === "shortlist" ? [{ contract, offer, reviewed: true }] : []);
  });
  const total = shortlistTotal(entries);
  const recurring = recurringCandidates(hub.spending).filter(item => !contracts.some(contract => contract.name.toLowerCase() === item.merchant.toLowerCase())).slice(0, 5);
  const knownMonthly = contracts.filter(contract => contract.category !== "mortgage" && (!contract.billing || contract.billing.currency === "CAD")).reduce((sum, contract) => sum + (contractMonthly(contract) ?? 0), 0);
  function save(contract: SavingsContract) {
    hub.setSavings(previous => ({ ...previous, Contracts: [...(previous.Contracts ?? []).filter(item => item.id !== contract.id), contract] }));
    setEditing(null); setMessage("Contract saved on this device."); setError("");
    if (editingRevision) { setMessage("Edit saved on this device; updating your paired PC…"); void sharing.update(contract, editingRevision).then(saved => setMessage(saved ? "Contract saved on this device and your paired PC." : "Edit saved on this device. The shared version was not updated; see the connection or conflict message.")); }
  }
  async function startResearch() {
    if (!researching || startingRef.current) return;
    startingRef.current = true; setStarting(true); setError("");
    try {
      const job = await startSavingsResearch(hub.worker, { contractId: researching.id, baselineKey: await comparisonFingerprint(researching), baseline: publicBaseline(researching) });
      const localKey = baselineKey(researching);
      hub.setSavings(previous => ({ ...previous, Reviews: [...(previous.Reviews ?? []).filter(review => review.job.id !== job.id), { job, localKey, decisions: {} }] }));
      setOpenResult(researching.id); setResearching(null); setMessage("Public comparison started on your paired PC. You can leave this screen and return to the saved job.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not start public research."); }
    finally { startingRef.current = false; setStarting(false); }
  }
  const focusedContract = contracts.find(contract => contract.id === openResult);
  const focusedReview = focusedContract ? reviews.find(review => review.job.id === resultJob && review.job.contractId === focusedContract.id) ?? latest(focusedContract.id) : undefined;
  const stale = focusedContract && focusedReview && focusedReview.localKey !== baselineKey(focusedContract);
  return <section className="view-stack savings-view">
    <PageHeader title="Savings" subtitle="Find a better deal for the same needs"><button className="button" disabled={sharing.busy} onClick={() => { setError(""); openEditor(newContract("telecom", crypto.randomUUID())); }}><Plus size={17} />Add contract</button></PageHeader>
    <div className="surface view-stack"><p className="muted">{sharing.paired ? sharing.status || "Loading shared contracts from your PC…" : "Connect your PC in Settings & tools to see shared contracts on your phone."}</p>{sharing.error && <Notice error>{sharing.error}</Notice>}{sharing.paired && <div className="row-actions"><button className="button secondary" disabled={sharing.busy} onClick={() => void sharing.refresh()}><RefreshCw size={15} />{sharing.busy ? "Updating contracts…" : "Refresh shared contracts"}</button><button className="button secondary" disabled={sharing.busy || !(hub.savings.Contracts ?? []).length} onClick={() => void sharing.share()}>Share device contracts with paired devices</button></div>}<p className="muted">Sharing copies contract details, notes and attached documents to your own paired PC. Other paired devices can then load them. Different saved versions are preserved.</p></div>
    {error && <Notice error onDismiss={() => setError("")}>{error}</Notice>}
    {sharing.paired && <div className="surface view-stack"><h2>Daily public research</h2><p>{sharing.research?.schedule?.enabled ? `Every day at ${sharing.research.schedule.at} (${sharing.research.schedule.timeZone}). Your PC must be running with your Windows user signed in.` : "No daily schedule has been confirmed by your paired PC."}</p>{sharing.research?.daily && <p className="muted">Last attempt {sharing.research.daily.attemptedAt ? new Date(sharing.research.daily.attemptedAt).toLocaleString() : "unknown"} · {sharing.research.daily.outcome?.replaceAll("-", " ")} · {sharing.research.daily.results?.filter(result => result.outcome === "complete").length ?? 0} completed comparisons.</p>}{sharing.researchError && <Notice error>{sharing.researchError}</Notice>}<p className="muted">New comparisons load when you open Savings or refresh shared contracts. Public estimates still need your review. Previous decisions are retained in result history.</p></div>}
    {message && <Notice onDismiss={() => setMessage("")}>{message}</Notice>}
    {contracts.length > 0 && <RecurringServices contracts={contracts.filter(c => filter === "all" || filter === c.category)} onOpen={openEditor} />}
    <div className="savings-summary"><div><small>Known recurring costs</small><strong>{currency.format(knownMonthly)}<span>/month</span></strong><small>Entered costs; mortgage shown separately</small></div><div><small>Reviewed shortlist</small><strong>{currency.format(total.firstYear)}<span>/first year</span></strong><small>Estimated, not realized · {total.count} compatible {total.count === 1 ? "option" : "options"}</small></div></div>
    {total.excluded > 0 && <p className="muted">{total.excluded} shortlisted options excluded from totals because costs, requirements or dependencies need review.</p>}
    <div className="savings-toolbar"><label>Category<select value={filter} onChange={event => setFilter(event.target.value as typeof filter)}><option value="all">All contracts</option>{Object.entries(categories).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><button className="button secondary" onClick={() => onNavigate("finances")}>Finances<ChevronRight size={16} /></button></div>
    {!contracts.length && <div className="surface savings-empty"><TrendingDown size={30} /><h2>Start with one recurring cost</h2><p>Phone, insurance, subscriptions, card fees or mortgage. Add what you know; the checklist shows what is still missing.</p><div className="savings-category-picks">{Object.entries(categories).map(([key, label]) => <button className="button secondary" key={key} onClick={() => openEditor(newContract(key as SavingsCategory, crypto.randomUUID()))}>{label}</button>)}</div></div>}
    <h2>Par contrat et forfait</h2><div className="savings-contracts">{contracts.filter(contract => filter === "all" || filter === contract.category).map(contract => {
      const missing = missingInformation(contract), review = latest(contract.id), active = review?.job.status === "queued" || review?.job.status === "running";
      return <article className="surface savings-contract" key={contract.id}>
        <div className="savings-contract-heading"><div><small>{categories[contract.category]}</small><h2>{contract.name}</h2><span className="muted">{contract.provider || "Provider missing"}{contract.renewal && " · Review " + contract.renewal}</span></div><strong>{contract.category === "mortgage" ? String(contract.mortgageRate ?? "?") + "%" : price(contractMonthly(contract), contract.billing?.currency ?? "CAD")}<small>{contract.category === "mortgage" ? "current rate" : "/month"}</small></strong></div>
        {contract.billing && <p className="muted">Facture source : {price(contract.billing.amount,contract.billing.currency)} / {contract.billing.count} {contract.billing.unit} · {contract.billing.asOf || "date à compléter"}. {contract.billing.source}</p>}<details className="savings-checklist"><summary>{missing.length ? missing.length + " details to complete" : "Ready for public comparison"}</summary>{missing.length > 0 ? <ul>{missing.map(item => <li key={item}>{item}</li>)}</ul> : <p>Public offers still need an eligibility and service/coverage check before you change anything.</p>}<p className="muted">Useful document: {contract.category.includes("insurance") ? "policy and renewal package" : contract.category === "mortgage" ? "mortgage statement and renewal terms" : contract.category === "credit-card" ? "fee schedule and benefits" : "recent bill and contract"}. Documents stay within your devices and paired PC after sharing.</p></details>
        <div className="row-actions"><button className="button secondary" onClick={() => { setError(""); openEditor(contract); }}><Pencil size={15} />{missing.length ? "Complete details" : "Edit"}</button><button className="button secondary" disabled={active} onClick={() => { setError(""); setResearching(contract); }}><Search size={15} />{active ? "Researching…" : "Compare public offers"}</button>{review && <button className="button secondary" onClick={() => setOpenResult(contract.id)}><FileText size={15} />{active ? "Research status" : "Results"}</button>}</div>
      </article>;
    })}</div>
    {contracts.length > 0 && !contracts.some(contract => filter === "all" || filter === contract.category) && <p className="muted">No contracts in this category. Add one or choose All contracts.</p>}
    {recurring.length > 0 && <section className="surface"><h2>From your imported spending</h2><p className="muted">Repeating merchants are candidates. Confirm the billing cycle and amount.</p>{recurring.map(item => <div className="savings-candidate" key={item.merchant}><span><strong>{item.merchant}</strong><small>{item.count} charges · average {currency.format(item.average)}</small></span><button className="button secondary" onClick={() => openEditor({ ...newContract("other", crypto.randomUUID()), name: item.merchant, price: Number(item.average.toFixed(2)) })}>Review candidate</button></div>)}</section>}
    <p className="savings-privacy muted">Contracts are saved on this device and your paired PC after sharing. Public research runs on request or through your explicitly enabled daily PC schedule. Names, notes and documents stay out of research. No provider contact or contract change occurs.</p>
    <Sheet open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.name ? "Edit contract" : "Add contract"} description="Save what you know. Missing details remain unknown." wide>
      {editing && <SavingsContractForm key={editing.id} initial={editing} onSave={save} onClose={() => setEditing(null)} />}
    </Sheet>
    <Sheet open={Boolean(researching)} onClose={() => !starting && setResearching(null)} title="Compare public offers" description="Review the summary sent to your paired PC and Codex for public research.">
      {researching && <div className="view-stack">{error && <Notice error>{error}</Notice>}<p>Only category, recognized provider, province, entered costs and numeric comparison requirements are sent. Names, notes, documents, raw spending and account identifiers are excluded from public research.</p><details open><summary>Summary to analyze</summary><pre className="savings-context">{JSON.stringify(publicBaseline(researching), null, 2)}</pre></details>{publicBaseline(researching).provider === "Provider not disclosed" && <p className="muted">This custom provider name stays private. Current-provider offers cannot be checked until a recognized provider is selected.</p>}<p>Public prices are estimates. No information is submitted to providers, no personalized quotes are requested and no contracts are changed.</p>{!hub.worker.Endpoint || !hub.worker.ApiKey ? <button className="button secondary" onClick={() => { setResearching(null); onNavigate("more"); }}>Connect your PC in Settings & tools</button> : <button className="button" disabled={starting} onClick={() => void startResearch()}><Search size={17} />{starting ? "Starting…" : "Start public comparison"}</button>}</div>}
    </Sheet>
    <Sheet open={Boolean(openResult)} onClose={() => setOpenResult(null)} title={focusedContract ? focusedContract.name + ": comparison" : "Comparison"} wide>
      {focusedReview && focusedContract && <div className="view-stack">
        <label>Result history<select value={focusedReview.job.id} onChange={event => setResultJob(event.target.value)}>{reviews.filter(review => review.job.contractId === focusedContract.id).slice().reverse().map(review => <option key={review.job.id} value={review.job.id}>{new Date(review.job.createdAt).toLocaleString()} · {review.job.scheduledDate ? "Daily" : "Requested"} · {review.job.status}</option>)}</select></label>
        {stale && <Notice error>Your contract changed after this research. Results are excluded from totals. Run a new comparison.</Notice>}
        {(focusedReview.job.status === "queued" || focusedReview.job.status === "running") && <Notice>Public research is {focusedReview.job.status}. The job is saved on your PC; returning to Savings resumes checking its status.</Notice>}
        {focusedReview.job.status === "failed" && <Notice error>{focusedReview.job.error || "Research failed."}</Notice>}
        <p className="muted">Started {new Date(focusedReview.job.createdAt).toLocaleString()}{focusedReview.job.completedAt && " · Finished " + new Date(focusedReview.job.completedAt).toLocaleString()}</p>
        {focusedReview.job.report && <><p className="savings-report-summary">{focusedReview.job.report.summary}</p>{focusedReview.job.report.missing.length > 0 && <div className="savings-checklist"><h3>Still needed</h3><ul>{focusedReview.job.report.missing.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
          {!focusedReview.job.report.offers.length && <p>No verified public offers were returned. This is not a personalized quote or a completed market comparison.</p>}
          {focusedReview.job.report.offers.map((offer, index) => <SavingsOfferCard key={focusedReview.job.id + ":" + index} contract={focusedContract} offer={offer} decision={focusedReview.decisions[String(index)] ?? "review"} stale={Boolean(stale)} onDecision={decision => hub.setSavings(previous => ({ ...previous, Reviews: (previous.Reviews ?? []).map(review => review.job.id === focusedReview.job.id ? { ...review, decisions: { ...review.decisions, [String(index)]: decision } } : review) }))} />)}
        </>}
        <div className="row-actions"><button className="button secondary" onClick={() => { openEditor(focusedContract); setOpenResult(null); }}><Pencil size={15} />Edit details</button><button className="button secondary" disabled={focusedReview.job.status === "running" || focusedReview.job.status === "queued"} onClick={() => { setResearching(focusedContract); setOpenResult(null); }}><RefreshCw size={15} />Run new comparison</button></div>
      </div>}
    </Sheet>
  </section>;
}
