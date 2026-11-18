import { useEffect, useRef, useState } from "react";
import { Plus, Pencil, Search, RefreshCw, TrendingDown, ChevronRight, ChevronLeft, MoreHorizontal, Upload } from "lucide-react";
import { PageHeader, Sheet, Notice } from "../ui/primitives";
import { currency, recurringCandidates } from "../domain";
import type { HubState } from "../state";
import type { AppView } from "../types";
import { newContract, effectiveContracts, publicBaseline,
  comparisonFingerprint, baselineKey, shortlistTotal, type SavingsContract, type SavingsCategory } from "../savings";
import { startSavingsResearch, fetchSavingsResearch, fetchFinances } from "../worker";
import SavingsContractForm from "./SavingsContractForm";
import RecurringServices from "./RecurringServices";
import type { FinanceState } from "../../../worker/src/finance-model";
import { calendarPeriod, shiftPeriod, rangeLabel } from "../finance-periods";
import { reconcilePayments } from "../savings-payments";
import PeriodNavigator from "./PeriodNavigator";
import SavingsPayments, { PaymentObservations } from "./SavingsPayments";
import SavingsContractDetails from "./SavingsContractDetails";
import SavingsOfferCard from "./SavingsOfferCard";
import { useSavingsSharing } from "../savings-sharing";
import { importSavingsContractBundle } from "../savings-contract-import";
import { useFinanceDialogHistory } from "../use-finance-dialog-history";
import { comparisonLead } from "../comparison-leads";
import { recurringCategories as categories } from "../recurring-presentation";
import SourceText from "../ui/SourceText";
import "../compact-finances.css";
import "../recurrents.css";
import "../savings-visual.css";

export default function SavingsView({ hub, onNavigate }: { hub: HubState; onNavigate: (view: AppView) => void }) {
  const contracts = effectiveContracts(hub.savings), reviews = hub.savings.Reviews ?? [];
  const [detailId, setDetailId] = useState<string | null>(() => new URLSearchParams(location.search).get("record"));
  const detailTrigger = useRef<HTMLElement | null>(null);
  function openDetails(contract: SavingsContract) { detailTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setDetailId(contract.id); }
  function closeDetails() { setDetailId(null); requestAnimationFrame(() => detailTrigger.current?.isConnected && detailTrigger.current.focus()); }
  const detailContract = contracts.find(c => c.id === detailId);
  const [editing, setEditing] = useState<SavingsContract | null>(null);
  const [editingRevision, setEditingRevision] = useState<string | null>(null);
  const sharing = useSavingsSharing(hub);
  const editorTrigger = useRef<HTMLElement | null>(null);
  function openEditor(contract: SavingsContract) { editorTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setEditingRevision(sharing.revisionFor(contract)); setEditing(contract); }
  function closeEditor() {
    setEditing(null);
    requestAnimationFrame(() => {
      if (editorTrigger.current?.isConnected && editorTrigger.current.getClientRects().length) editorTrigger.current.focus();
      else document.querySelector<HTMLElement>(detailContract ? '[data-savings-edit]' : reviewOpen ? '.savings-candidate button' : '.recurring-add')?.focus();
    });
  }
  const [researching, setResearching] = useState<SavingsContract | null>(null);
  const [comparisonLink] = useState(() => {
    const query = new URLSearchParams(location.search), record = query.get("record"), job = query.get("job"), offer = query.get("offer");
    return record && record.length <= 200 && job && /^[a-zA-Z0-9:_-]{1,200}$/.test(job) && offer !== null && /^\d{1,3}$/.test(offer) && Number(offer) < 100
      ? { record, job, offer: Number(offer) } : null;
  });
  const [openResult, setOpenResult] = useState<string | null>(comparisonLink?.record ?? null);
  const [resultJob, setResultJob] = useState<string>(comparisonLink?.job ?? "");
  const [resultOffer, setResultOffer] = useState<number | null>(comparisonLink?.offer ?? null);
  const resultTrigger = useRef<HTMLElement | null>(null);
  function openComparison(contract: SavingsContract, jobId = "", offerIndex: number | null = null) {
    resultTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setResultJob(jobId); setResultOffer(offerIndex); setOpenResult(contract.id);
  }
  function closeComparison() {
    setOpenResult(null); setResultOffer(null);
    requestAnimationFrame(() => {
      if (resultTrigger.current?.isConnected) resultTrigger.current.focus({ preventScroll: true });
      else if (detailId) document.querySelector<HTMLElement>('[data-savings-results]')?.focus({ preventScroll: true });
    });
  }
  useEffect(() => {
    if (!openResult || resultOffer === null) return;
    const frame = requestAnimationFrame(() => {
      const row = document.getElementById(`comparison-offer-${resultJob}-${resultOffer}`);
      row?.scrollIntoView({ block: "start" }); row?.querySelector("summary")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [openResult, resultJob, resultOffer]);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const [starting, setStarting] = useState(false), startingRef = useRef(false);
  const [filter, setFilter] = useState<SavingsCategory | "all">("all");
  const [finance, setFinance] = useState<FinanceState | null>(null), [financeError, setFinanceError] = useState("");
  const [financeLoading, setFinanceLoading] = useState(Boolean(hub.worker.Endpoint && hub.worker.ApiKey));
  const [period, setPeriod] = useState(() => { const now=new Date();return calendarPeriod(now.getFullYear(),now.getMonth()+1); });
  const [optionsOpen,setOptionsOpen]=useState(false), [reviewOpen,setReviewOpen]=useState(false), [periodOpen,setPeriodOpen]=useState(false);
  const optionsTrigger=useRef<HTMLButtonElement>(null), reviewTrigger=useRef<HTMLButtonElement>(null), periodTrigger=useRef<HTMLButtonElement>(null);
  const closeOptions=()=>{setOptionsOpen(false);requestAnimationFrame(()=>optionsTrigger.current?.focus());};
  const closeReviews=()=>{setReviewOpen(false);requestAnimationFrame(()=>reviewTrigger.current?.focus());};
  const closePeriod=()=>{setPeriodOpen(false);requestAnimationFrame(()=>periodTrigger.current?.focus());};
  // One history entry for the nested flow. Back dismisses the top panel, restoring
  // the entry while its parent remains open; switching child panels cannot race popstate.
  useFinanceDialogHistory(Boolean(optionsOpen || reviewOpen || periodOpen || detailContract || editing || researching || openResult),()=>{
    if(openResult){closeComparison();return !detailContract;}
    if(editing){closeEditor();return !(detailContract || reviewOpen);}
    if(researching){if(startingRef.current)return false;closeResearch();return !detailContract;}
    if(detailContract){closeDetails();return true;}
    if(reviewOpen){closeReviews();return true;}
    if(periodOpen){closePeriod();return true;}
    closeOptions();return true;
  });
  function closeResearch() {
    if (startingRef.current) return;
    setResearching(null);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(detailContract ? '[data-savings-research]' : '.saved-comparisons > summary')?.focus());
  }
  useEffect(() => {
    let cancelled = false;
    setFinance(null); setFinanceError(""); setFinanceLoading(Boolean(hub.worker.Endpoint && hub.worker.ApiKey));
    if (hub.worker.Endpoint && hub.worker.ApiKey) void fetchFinances(hub.worker).then(saved => {
      if (cancelled) return;
      setFinance(saved?.schema === 1 ? saved : null);
    }).catch(() => { if (!cancelled) setFinanceError("Historique bancaire indisponible. Les références contractuelles restent visibles; aucun montant payé n’est présumé."); }).finally(() => { if (!cancelled) setFinanceLoading(false); });
    return () => { cancelled = true; };
  }, [hub.worker.Endpoint, hub.worker.ApiKey]);
  const payments = reconcilePayments(contracts, finance, period.from, period.to);
  const visibleContracts = contracts.filter(c => filter === "all" || filter === c.category);
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
  const savedComparisons = visibleContracts.flatMap(contract => {
    const review = reviews.filter(r => r.job.contractId === contract.id && r.job.report).at(-1);
    return review ? [{ contract, review }] : [];
  });
  const entries = visibleContracts.flatMap(contract => {
    const review = reviews.filter(review => review.job.contractId === contract.id && Object.values(review.decisions).includes("shortlist")).at(-1);
    if (!review?.job.report || review.localKey !== baselineKey(contract)) return [];
    return review.job.report.offers.flatMap((offer, index) => review.decisions[String(index)] === "shortlist" ? [{ contract, offer, reviewed: true }] : []);
  });
  const total = shortlistTotal(entries);
  const recurring = recurringCandidates(hub.spending).filter(item => !contracts.some(contract => contract.name.toLowerCase() === item.merchant.toLowerCase())).slice(0, 5);
  const reviewCount = payments.reviews.filter(r=>r.contractIds.some(id=>visibleContracts.some(c=>c.id===id))).length + recurring.length;
  const [importing, setImporting] = useState(false);
  async function importContractFile(file: File) {
    setError(""); setMessage("");
    if (!window.confirm("Import this contract and its supporting documents onto this device? Existing FamilyHub data will be preserved.")) return;
    setImporting(true);
    try {
      const contract = await importSavingsContractBundle(file, contracts);
      hub.setSavings(previous => ({ ...previous, Contracts: [...(previous.Contracts ?? []), contract] }));
      setMessage("Contract and " + contract.documents.length + " document(s) imported on this device. Review the historical details, then choose Partager les contrats avec les appareils associés to sync to your PC.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not import contract; existing data was preserved."); }
    finally { setImporting(false); }
  }
  function save(contract: SavingsContract) {
    hub.setSavings(previous => ({ ...previous, Contracts: [...(previous.Contracts ?? []).filter(item => item.id !== contract.id), contract] }));
    closeEditor(); setMessage("Contract saved on this device."); setError("");
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
  const focusedReview = focusedContract ? resultJob ? reviews.find(review => review.job.id === resultJob && review.job.contractId === focusedContract.id) : latest(focusedContract.id) : undefined;
  const stale = focusedContract && focusedReview && focusedReview.localKey !== baselineKey(focusedContract);
  return <section className="view-stack savings-view">
    <PageHeader title="Récurrents"><button type="button" className="icon-button" ref={optionsTrigger} aria-label="Options des récurrents" aria-haspopup="dialog" aria-expanded={optionsOpen} onClick={()=>setOptionsOpen(true)}><MoreHorizontal size={22}/></button></PageHeader>
    {error && <Notice error onDismiss={() => setError("")}>{error}</Notice>}
    {message && <Notice onDismiss={() => setMessage("")}>{message}</Notice>}
    {sharing.error && <Notice error>{sharing.error}</Notice>}
    {detailId && !detailContract && !sharing.busy && <Notice onDismiss={closeDetails}>Le contrat lié n'est pas présent dans les données chargées. Actualisez les contrats partagés ou consultez la connexion à votre PC.</Notice>}
    {sharing.researchError && <Notice error>{sharing.researchError}</Notice>}
    <div className="recurring-month-navigation" aria-label="Navigation mensuelle des paiements">
      <button type="button" className="icon-button" aria-label="Mois précédent" onClick={()=>setPeriod(shiftPeriod(calendarPeriod(Number(period.from.slice(0,4)),Number(period.from.slice(5,7))),-1))}><ChevronLeft size={18}/></button>
      <button type="button" ref={periodTrigger} className="recurring-period-trigger" aria-label="Choisir la période des paiements" aria-haspopup="dialog" onClick={()=>setPeriodOpen(true)}>{rangeLabel(period)}</button>
      <button type="button" className="icon-button" aria-label="Mois suivant" onClick={()=>setPeriod(shiftPeriod(calendarPeriod(Number(period.to.slice(0,4)),Number(period.to.slice(5,7))),1))}><ChevronRight size={18}/></button>
    </div>
    <Sheet open={periodOpen} onClose={closePeriod} title="Période des paiements"><PeriodNavigator range={period} onChange={setPeriod} scope={finance?.data?.scope} label="Période des paiements"/><button type="button" className="button" onClick={closePeriod}>Voir les paiements</button></Sheet>
    {financeError && <Notice error>{financeError}</Notice>}
    {!financeLoading && !finance?.data && !financeError && <button type="button" className="recurring-source-link" onClick={()=>onNavigate("finances")}><span>Historique bancaire à importer<small>Les références contractuelles restent visibles.</small></span><ChevronRight size={18}/></button>}
    {period.from > period.to && <Notice error>La date de début doit précéder la date de fin.</Notice>}
    <SavingsPayments result={payments} contracts={visibleContracts} range={period} onMonth={setPeriod} loading={financeLoading} />
    {reviewCount>0 && <button type="button" className="recurring-review-banner" ref={reviewTrigger} aria-haspopup="dialog" onClick={()=>setReviewOpen(true)}><strong>{reviewCount} élément(s) à vérifier</strong><ChevronRight size={18}/></button>}
    <div className="savings-toolbar recurring-contract-toolbar"><h2>Contrats <span className="recurring-contract-count">{visibleContracts.length}</span></h2><label><span className="sr-only">Filtrer les contrats</span><select aria-label="Filtrer les contrats" value={filter} onChange={event=>setFilter(event.target.value as typeof filter)}><option value="all">Tous les contrats</option>{Object.entries(categories).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label></div>
    <RecurringServices contracts={visibleContracts} summaries={payments.summaries} onOpen={openDetails} />
    {savedComparisons.length > 0 && <details className="saved-comparisons" onKeyDown={e => { if (e.key === "Escape") { e.currentTarget.open = false; e.currentTarget.querySelector("summary")?.focus(); } }}>
      <summary>Comparaisons disponibles <span className="count-badge">{savedComparisons.length}</span><small>À examiner, pas une économie réalisée</small></summary>
    {reviews.some(r => visibleContracts.some(c => c.id === r.job.contractId) && Object.values(r.decisions).includes("shortlist")) && <div className="savings-summary savings-reviewed-summary"><div><small>Sélection examinée</small><strong>{currency.format(total.firstYear)}<span>/première année</span></strong><small>Estimation, non réalisée · {total.count} compatible {total.count === 1 ? "option" : "options"}</small>{total.excluded > 0 && <small>{total.excluded} shortlisted options excluded because costs, requirements or dependencies need review.</small>}</div></div>}

      <div className="saved-comparison-list">{savedComparisons.map(({ contract, review }) => <button type="button" key={contract.id} className="comparison-lead" aria-label={"Comparaison pour " + contract.name} onClick={() => openComparison(contract, review.job.id, comparisonLead(contract,review)?.offerIndex ?? null)}>
        <span><strong>{contract.name}</strong><small>{review.job.report!.offers.length} offre(s) · {new Date(review.job.completedAt ?? review.job.createdAt).toLocaleDateString("fr-CA")}</small></span><ChevronRight size={18} aria-hidden="true" />
      </button>)}</div>
    </details>}
    {!contracts.length && <div className="surface savings-empty"><TrendingDown size={30} /><h2>Ajoutez un premier contrat</h2><p>Téléphone, assurance, abonnement, frais de carte ou hypothèque. Ajoutez les détails connus ; les autres restent à confirmer.</p><div className="savings-category-picks">{Object.entries(categories).map(([key, label]) => <button className="button secondary" key={key} onClick={() => openEditor(newContract(key as SavingsCategory, crypto.randomUUID()))}>{label}</button>)}</div></div>}
    {contracts.length > 0 && !contracts.some(contract => filter === "all" || filter === contract.category) && <p className="muted">Aucun contrat dans cette catégorie. Choisissez Tous les contrats ou ajoutez-en un.</p>}
    <button type="button" className="button secondary recurring-add" disabled={sharing.busy || importing} onClick={()=>{setError("");setDetailId(null);openEditor(newContract("telecom",crypto.randomUUID()));}}><Plus size={18}/>Ajouter un contrat</button>
    <Sheet open={reviewOpen && !editing} onClose={closeReviews} title="Éléments à vérifier">
      <PaymentObservations result={payments} contracts={visibleContracts} onCategorize={()=>onNavigate("finances")}/>
    {recurring.length > 0 && <section className="surface"><h2>Depuis les dépenses importées</h2><p className="muted">Ces commerçants sont des candidats. Confirmez le cycle et le montant facturé.</p>{recurring.map(item => <div className="savings-candidate" key={item.merchant}><span><strong>{item.merchant}</strong><small>{item.count} charges · average {currency.format(item.average)}</small></span><button className="button secondary" onClick={() => openEditor({ ...newContract("other", crypto.randomUUID()), name: item.merchant, price: Number(item.average.toFixed(2)) })}>Examiner le candidat</button></div>)}</section>}
    </Sheet>
    <Sheet open={optionsOpen} onClose={closeOptions} title="Options des récurrents"><div className="view-stack savings-settings">
    <div className="savings-import-actions"><label className="button secondary file-button" title="Import an additive contract bundle without replacing existing data"><Upload size={17} aria-hidden="true" />{importing ? "Importing…" : "Importer un contrat"}<input type="file" accept=".json,application/json" disabled={importing || sharing.busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importContractFile(file); }} /></label></div>
    <button type="button" className="button secondary" onClick={()=>onNavigate("finances")}>Ouvrir Finances<ChevronRight size={16}/></button>
    <h2>Partage et recherche quotidienne</h2>
    <div className="surface view-stack"><p className="muted">{sharing.paired ? sharing.status || "Loading shared contracts from your PC…" : "Connectez votre PC dans Plus → Réglages et outils to see shared contracts on your phone."}</p>{sharing.paired && <div className="row-actions"><button className="button secondary" disabled={sharing.busy} onClick={() => void sharing.refresh()}><RefreshCw size={15} />{sharing.busy ? "Updating contracts…" : "Actualiser les contrats partagés"}</button><button className="button secondary" disabled={sharing.busy || !(hub.savings.Contracts ?? []).length} onClick={() => void sharing.share()}>Partager les contrats avec les appareils associés</button></div>}<p className="muted">Sharing copies contract details, notes and attached documents to your own paired PC. Other paired devices can then load them. Different saved versions are preserved.</p></div>
    {sharing.paired && <div className="surface view-stack"><h2>Recherche publique quotidienne</h2><p>{sharing.research?.schedule?.enabled ? `Every day at ${sharing.research.schedule.at} (${sharing.research.schedule.timeZone}). Your PC must be running with your Windows user signed in.` : "No daily schedule has been confirmed by your paired PC."}</p>{sharing.research?.daily && <p className="muted">Last attempt {sharing.research.daily.attemptedAt ? new Date(sharing.research.daily.attemptedAt).toLocaleString() : "unknown"} · {sharing.research.daily.outcome?.replaceAll("-", " ")} · {sharing.research.daily.results?.filter(result => result.outcome === "complete").length ?? 0} completed comparisons.</p>}<p className="muted">New comparisons load when you open Savings or refresh shared contracts. Public estimates still need your review. Previous decisions are retained in result history.</p></div>}
    <p className="savings-privacy muted">Contracts are saved on this device and your paired PC after sharing. Public research runs on request or through your explicitly enabled daily PC schedule. Names, notes and documents stay out of research. No provider contact or contract change occurs.</p>
    </div></Sheet>
    <Sheet open={Boolean(detailContract) && !editing && !researching && !openResult} onClose={closeDetails} title={detailContract ? "Contrat · " + detailContract.name : "Contrat"} wide>
      {detailContract && <><SavingsContractDetails contract={detailContract} paid={payments.summaries.find(s => s.contractId === detailContract.id)!} review={latest(detailContract.id)} onEdit={() => { setError(""); openEditor(detailContract); }} onResearch={() => { setError(""); setResearching(detailContract); }} onResults={() => openComparison(detailContract)} /><button className="button secondary" onClick={closeDetails}>Retour aux services</button></>}
    </Sheet>
    <Sheet open={Boolean(editing)} onClose={closeEditor} title={editing?.name ? "Edit contract" : "Add contract"} description="Save what you know. Missing details remain unknown." wide>
      {editing && <SavingsContractForm key={editing.id} initial={editing} onSave={save} onClose={closeEditor} />}
    </Sheet>
    <Sheet open={Boolean(researching)} onClose={closeResearch} title="Compare public offers" description="Review the summary sent to your paired PC and Codex for public research.">
      {researching && <div className="view-stack">{error && <Notice error>{error}</Notice>}<p>Only category, recognized provider, province, entered costs and numeric comparison requirements are sent. Names, notes, documents, raw spending and account identifiers are excluded from public research.</p><details open><summary>Summary to analyze</summary><pre className="savings-context">{JSON.stringify(publicBaseline(researching), null, 2)}</pre></details>{publicBaseline(researching).provider === "Provider not disclosed" && <p className="muted">This custom provider name stays private. Current-provider offers cannot be checked until a recognized provider is selected.</p>}<p>Public prices are estimates. No information is submitted to providers, no personalized quotes are requested and no contracts are changed.</p>{!hub.worker.Endpoint || !hub.worker.ApiKey ? <button className="button secondary" onClick={() => { setResearching(null); onNavigate("more"); }}>Connectez votre PC dans Plus → Réglages et outils</button> : <button className="button" disabled={starting} onClick={() => void startResearch()}><Search size={17} />{starting ? "Starting…" : "Start public comparison"}</button>}</div>}
    </Sheet>
    <Sheet open={Boolean(openResult)} onClose={closeComparison} title={focusedContract ? focusedContract.name + " : comparaison" : "Comparaison"} wide className="savings-comparison-dialog">
      {!focusedReview && <Notice>Cette comparaison n’est pas disponible dans les sources chargées. Actualisez les contrats ou revenez au dossier.</Notice>}
      {focusedReview && focusedContract && <div className="view-stack">
        <label>Result history<select value={focusedReview.job.id} onChange={event => { setResultJob(event.target.value); setResultOffer(null); }}>{reviews.filter(review => review.job.contractId === focusedContract.id).slice().reverse().map(review => <option key={review.job.id} value={review.job.id}>{new Date(review.job.createdAt).toLocaleString()} · {review.job.scheduledDate ? "Daily" : "Requested"} · {review.job.status}</option>)}</select></label>
        {stale && <Notice error>Your contract changed after this research. Results are excluded from totals. Run a new comparison.</Notice>}
        {(focusedReview.job.status === "queued" || focusedReview.job.status === "running") && <Notice>Public research is {focusedReview.job.status}. The job is saved on your PC; returning to Savings resumes checking its status.</Notice>}
        {focusedReview.job.status === "failed" && <Notice error>{focusedReview.job.error || "Research failed."}</Notice>}
        <p className="muted">Started {new Date(focusedReview.job.createdAt).toLocaleString()}{focusedReview.job.completedAt && " · Finished " + new Date(focusedReview.job.completedAt).toLocaleString()}</p>
        {focusedReview.job.report && <><details className="comparison-context"><summary>Résumé et limites {focusedReview.job.report.missing.length > 0 ? `· ${focusedReview.job.report.missing.length} point(s) à confirmer` : ""}</summary><div className="view-stack"><SourceText text={focusedReview.job.report.summary} />{focusedReview.job.report.missing.length > 0 && <div className="savings-checklist"><h3>Still needed</h3><ul>{focusedReview.job.report.missing.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}</div></details>
          {!focusedReview.job.report.offers.length && <p>No verified public offers were returned. This is not a personalized quote or a completed market comparison.</p>}
          <h3>{focusedReview.job.report.offers.length} offre(s) enregistrée(s)</h3>
          {focusedReview.job.report.offers.map((offer, index) => <details className="saved-offer" id={`comparison-offer-${focusedReview.job.id}-${index}`} key={focusedReview.job.id + ":" + index} open={resultOffer === index || undefined}>
            <summary><span>{offer.provider} · {offer.title}</span><strong>{offer.monthlyPrice === null ? "Tarif à confirmer" : currency.format(offer.monthlyPrice) + "/mois"}</strong></summary>
            <SavingsOfferCard contract={focusedContract} offer={offer} decision={focusedReview.decisions[String(index)] ?? "review"} stale={Boolean(stale)} onDecision={decision => hub.setSavings(previous => ({ ...previous, Reviews: (previous.Reviews ?? []).map(review => review.job.id === focusedReview.job.id ? { ...review, decisions: { ...review.decisions, [String(index)]: decision } } : review) }))} />
          </details>)}
        </>}
        <div className="row-actions"><button className="button secondary" onClick={() => { openEditor(focusedContract); setOpenResult(null); }}><Pencil size={15} />Edit details</button><button className="button secondary" disabled={focusedReview.job.status === "running" || focusedReview.job.status === "queued"} onClick={() => { setResearching(focusedContract); setOpenResult(null); }}><RefreshCw size={15} />Run new comparison</button></div>
      </div>}
    </Sheet>
  </section>;
}
