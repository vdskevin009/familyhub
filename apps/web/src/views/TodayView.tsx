import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { ArrowRight, CheckCircle2, ChevronDown, ChevronRight, CircleDollarSign, Clock3, FileCheck2, HeartHandshake, Home, Info, MessageCircle, RefreshCw, Settings2, ShieldCheck, ShoppingBasket, TrendingDown, WifiOff } from "lucide-react";
import { Notice, PageHeader, Sheet, SkeletonList } from "../ui/primitives";
import type { HubState } from "../state";
import type { AppView } from "../types";
import { runWorkerTask } from "../worker";
import { opportunityHref, type Opportunity } from "../opportunities";
import { useOpportunities } from "../useOpportunities";

type Props = {
  hub: HubState;
  onNavigate: (view: AppView) => void;
  onOpenTarget: (href: string) => void;
  commandOpen: boolean;
  onCommandOpenChange: (open: boolean) => void;
};
const money = new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 2 });
const domainLabels: Record<Opportunity["domain"], string> = { claims: "Remboursement", insurance: "Assurance", subscriptions: "Abonnement", finances: "Finances", groceries: "Courses", mortgage: "Hypothèque", system: "Service" };
const domainIcons = { claims: HeartHandshake, insurance: ShieldCheck, subscriptions: TrendingDown, finances: CircleDollarSign, groceries: ShoppingBasket, mortgage: Home, system: Settings2 };
const periods = { once: "ponctuel", month: "/ mois", year: "/ an", "first-year": "sur 12 mois" };
function dateLabel(value: string | null | undefined, withTime = false) {
  if (!value) return "Date inconnue";
  const date = new Date(value.length === 10 ? value + "T12:00:00" : value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("fr-CA", { day: "numeric", month: "short", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } as const : {}) }).format(date) : "Date inconnue";
}
function benefitLabel(opportunity: Opportunity) {
  return opportunity.benefit.amount === null ? opportunity.benefit.label : money.format(opportunity.benefit.amount);
}
function decisionLabel(opportunity: Opportunity) {
  if (opportunity.decision === "snoozed") return "Reportée au " + dateLabel(opportunity.snoozedUntil);
  if (opportunity.decision === "dismissed") return "Masquée";
  if (opportunity.decision === "resolved") return "Traitée";
  return opportunity.freshness === "stale" ? "À actualiser" : opportunity.status === "ready" ? "À préparer" : opportunity.status === "unavailable" ? "Indisponible" : "À vérifier";
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
  const visible = showAll ? feed.opportunities : feed.opportunities.slice(0, 3);
  const managed = feed.allOpportunities.filter(item => item.decision && item.decision !== "seen");
  const selected = feed.allOpportunities.find(item => item.id === selectedId);
  const sourceErrors = feed.sources.filter(source => source.status === "error");
  const accessibleSources = feed.sources.filter(source => source.status === "ready").length;
  const numericPotential = feed.allOpportunities.filter(item => item.benefit.kind === "potential" && item.benefit.amount !== null && item.freshness === "fresh");
  const unknownPotential = feed.allOpportunities.filter(item => item.domain !== "system" && item.benefit.kind !== "recoverable" && item.benefit.kind !== "time" && item.benefit.amount === null);
  const sourceLabel = !online ? "Hors ligne" : feed.loading ? "Vérification des sources…" : !feed.configured ? "PC à connecter" : sourceErrors.length ? sourceErrors.length + " source" + (sourceErrors.length > 1 ? "s" : "") + " à revoir" : accessibleSources + " sources accessibles";
  const followLink = (event: MouseEvent<HTMLAnchorElement>, item: Opportunity) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onOpenTarget(opportunityHref(item.target));
  };
  async function decide(item: Opportunity, action: "seen" | "snooze" | "dismiss" | "resolve" | "restore") {
    setNotice("");
    const options = action === "snooze" ? { snoozedUntil: new Date(Date.now() + 7 * 86_400_000).toISOString() } : undefined;
    const saved = await feed.setAction(item, action, options);
    if (!saved) return;
    setSelectedId(null);
    setNotice(action === "snooze" ? "Piste reportée de 7 jours. Vous pouvez la reprendre ci-dessous." : action === "dismiss" ? "Piste masquée. Vous pouvez la réafficher dans les pistes gérées." : action === "restore" ? "Piste réaffichée dans vos actions." : action === "resolve" ? "Piste marquée comme traitée. Aucun gain ni aucune soumission n’est validé." : "Piste marquée comme lue.");
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
        "Tu es l’assistant privé FamilyHub. Réponds brièvement en français avec une prochaine action utile. Utilise uniquement le résumé fourni, distingue faits, inconnues, sources anciennes et montants potentiels. Aucun gain confirmé n’est établi ici. N’effectue aucune action externe et ne prétends pas en avoir effectué. Ne suppose pas qu’une connexion accessible signifie qu’une collecte est récente.\n\nRÉSUMÉ PRIVÉ\n" + context + "\n\nQUESTION\n" + prompt);
      if (generation !== askGeneration.current) return;
      if (task.status === "failed") throw new Error(task.error || "Le PC n’a pas pu terminer la réponse.");
      setAnswer(task.result || "Aucune réponse textuelle reçue. Vous pouvez réessayer.");
    } catch (error) { if (generation === askGeneration.current) setAskError(error instanceof Error ? error.message : "La demande n’a pas abouti."); }
    finally { if (generation === askGeneration.current) setAsking(false); }
  }
  function opportunityCard(item: Opportunity, rank?: number) {
    const Icon = domainIcons[item.domain];
    const isManaged = Boolean(item.decision && item.decision !== "seen");
    return <article className={`opportunity-card${rank === 0 ? " opportunity-first" : ""}${isManaged ? " opportunity-managed" : ""}`} key={item.id}>
      <div className="opportunity-top"><span className="opportunity-domain"><Icon size={18} aria-hidden="true" />{domainLabels[item.domain]}</span><span className={`opportunity-status${item.freshness === "stale" || item.status === "unavailable" ? " caution" : ""}`}>{decisionLabel(item)}</span></div>
      <h3>{item.title}</h3>
      <p className="opportunity-description">{item.description}</p>
      <div className={item.benefit.amount === null ? "opportunity-benefit unknown" : "opportunity-benefit"}><strong>{benefitLabel(item)}</strong>{item.benefit.amount !== null && <span>{item.benefit.period ? periods[item.benefit.period] : "période à confirmer"}</span>}</div>
      {item.benefit.amount !== null && <p className="opportunity-qualification">{item.benefit.label} · à confirmer</p>}
      {(item.dueDate || item.decision === "seen") && <div className="opportunity-meta">{item.dueDate && <span><Clock3 size={14} aria-hidden="true" />Échéance : {dateLabel(item.dueDate)}</span>}{item.decision === "seen" && <span>Déjà consultée</span>}</div>}
      <div className="opportunity-actions"><a className="button" href={opportunityHref(item.target)} onClick={event => followLink(event, item)}>{item.actionLabel}<ArrowRight size={17} aria-hidden="true" /></a><button type="button" className="opportunity-details" onClick={() => { setNotice(""); setSelectedId(item.id); }} aria-label={`Sources et options : ${item.title}`} aria-haspopup="dialog"><Info size={18} aria-hidden="true" /><span>Sources et options</span></button></div>
    </article>;
  }

  return <div className="view-stack today-view">
    <PageHeader title="Aujourd’hui" subtitle="Le prochain geste utile pour votre foyer" />
    <button type="button" className={`today-source-status${sourceErrors.length || !online ? " caution" : ""}`} onClick={() => setSourceOpen(true)} aria-haspopup="dialog">
      {!online ? <WifiOff size={17} aria-hidden="true" /> : <span className={feed.loading ? "source-dot loading" : "source-dot"} aria-hidden="true" />}<span>{sourceLabel}</span><ChevronRight size={16} aria-hidden="true" />
    </button>
    {!online && <div className="today-state" role="status"><WifiOff size={20} aria-hidden="true" /><div><strong>Connexion interrompue</strong><p>Les montants affichés correspondent à la dernière lecture de cette session. Reconnectez-vous puis actualisez avant de décider.</p></div></div>}
    {!feed.configured && !feed.loading && <div className="today-empty"><span className="today-empty-icon"><Home size={25} aria-hidden="true" /></span><h2>Retrouver vos priorités</h2><p>Connectez votre PC pour consulter vos dossiers et leurs prochaines actions.</p><button type="button" className="button" onClick={() => onNavigate("more")}>Ouvrir les réglages<ArrowRight size={17} aria-hidden="true" /></button></div>}
    {feed.configured && <>
      <section className="today-benefits" aria-label="Des montants distincts, sans double compte">
        <button type="button" className="benefit-tile recovery-tile" onClick={() => setSummaryOpen(true)} aria-haspopup="dialog"><span>À récupérer</span><strong>{feed.sources.find(source => source.id === "claims")?.status === "loading" ? "…" : feed.recoverable.amount === null ? "À vérifier" : money.format(feed.recoverable.amount)}</strong><small>Potentiel · ponctuel</small></button>
        <button type="button" className="benefit-tile" onClick={() => setSummaryOpen(true)} aria-haspopup="dialog"><span>Économies possibles</span><strong>{feed.loading ? "…" : numericPotential.length ? numericPotential.length + " piste" + (numericPotential.length > 1 ? "s" : "") : "À chiffrer"}</strong><small>Selon les preuves</small></button>
        <button type="button" className="benefit-tile" onClick={() => setSummaryOpen(true)} aria-haspopup="dialog"><span>Économies obtenues</span><strong>Non mesuré</strong><small>Preuve requise</small></button>
      </section>
      <section className="today-priorities" aria-labelledby="today-priorities-title" aria-busy={feed.loading}>
        <div className="today-section-heading"><div><h2 id="today-priorities-title">Vos prochaines actions</h2><p>{feed.loading ? "Lecture des dossiers sur votre PC" : feed.opportunities.length + " action" + (feed.opportunities.length > 1 ? "s" : "") + (managed.length ? " · " + managed.length + " gérée" + (managed.length > 1 ? "s" : "") : "")}</p></div><button type="button" className="icon-button" onClick={feed.refresh} disabled={feed.loading || !online} aria-label="Actualiser les priorités" title="Actualiser"><RefreshCw size={19} aria-hidden="true" /></button></div>
        {visible.length ? <div className="opportunity-list">{visible.map((item, index) => opportunityCard(item, index))}</div> : feed.loading ? <SkeletonList label="Lecture des sources de vos priorités" /> : <div className="today-empty"><CheckCircle2 size={25} aria-hidden="true" /><h3>{managed.length ? "Vos pistes sont mises de côté" : sourceErrors.length ? "Priorités encore incomplètes" : "Aucune action exploitable trouvée"}</h3><p>{sourceErrors.length ? "Certaines sources n’ont pas répondu. Consultez leur état avant de conclure que tout est à jour." : managed.length ? "Retrouvez les pistes reportées, masquées ou traitées ci-dessous." : "Ce constat porte uniquement sur les sources consultées. Aucun gain n’est supposé."}</p><button type="button" className="button secondary" onClick={() => setSourceOpen(true)}>Voir les sources</button></div>}
        {feed.opportunities.length > 3 && <button type="button" className="today-more-button" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>{showAll ? "Revenir aux 3 priorités" : "Voir les " + feed.opportunities.length + " actions"}<ChevronDown size={17} aria-hidden="true" /></button>}
      </section>
      {managed.length > 0 && <section className="today-managed"><button type="button" className="today-disclosure" onClick={() => setShowManaged(!showManaged)} aria-expanded={showManaged}><span>Pistes gérées <small>{managed.length}</small></span><ChevronDown size={18} aria-hidden="true" /></button>{showManaged && <div className="opportunity-list">{managed.map(item => opportunityCard(item))}</div>}</section>}
      {notice && <Notice onDismiss={() => setNotice("")}>{notice}</Notice>}
      {feed.actionError && <Notice error>{feed.actionError}</Notice>}
    </>}
    <section className="today-assistant">
      <button type="button" className="today-disclosure" onClick={() => onCommandOpenChange(!commandOpen)} aria-expanded={commandOpen} aria-controls="today-ask-body"><span className="today-ask-label"><MessageCircle size={20} aria-hidden="true" /><span><strong>Demander à FamilyHub</strong><small>Une réponse à partir de vos priorités</small></span></span><ChevronDown size={19} aria-hidden="true" /></button>
      {commandOpen && <div className="today-ask-body" id="today-ask-body">
        {!feed.connected || !online ? <p>Le PC doit être accessible pour répondre. <button type="button" className="text-action" onClick={() => onNavigate("more")}>Vérifier la connexion</button></p> : <form onSubmit={ask}><label htmlFor="today-question">Votre question</label><textarea id="today-question" value={question} onChange={event => setQuestion(event.target.value)} placeholder="Quelle action puis-je préparer en premier ?" rows={3} /><button className="button" disabled={asking || !question.trim()}>{asking ? "Réponse en cours…" : "Demander"}</button></form>}
        {asking && <p role="status">Votre PC prépare la réponse…</p>}{askError && <Notice error>{askError}</Notice>}{answer && <div className="today-answer" role="status">{answer}</div>}
        <p className="today-fine-print">Le résumé des cartes est transmis au PC associé. Les pièces jointes restent hors de cette demande.</p>
      </div>}
    </section>

    <Sheet open={sourceOpen} onClose={() => setSourceOpen(false)} title="État des sources" description="Une lecture réussie ne garantit pas que la collecte est récente." className="today-sheet" footer={<><button type="button" className="button secondary" onClick={() => onNavigate("more")}><Settings2 size={17} aria-hidden="true" />Réglages</button><button type="button" className="button" onClick={feed.refresh} disabled={!feed.configured || feed.loading || !online}><RefreshCw size={17} aria-hidden="true" />Actualiser</button></>}>
      <div className="today-source-list">{feed.sources.map(source => <article key={source.id}><div><h3>{source.label}</h3><span className={`opportunity-status${source.status === "error" ? " caution" : ""}`}>{source.status === "ready" ? "Accessible" : source.status === "loading" ? "Lecture…" : source.status === "unpaired" ? "Non connecté" : "À revoir"}</span></div><dl className="today-facts"><div><dt>Dernière lecture</dt><dd>{dateLabel(source.checkedAt, true)}</dd></div><div><dt>Date des données</dt><dd>{dateLabel(source.sourceDate)}</dd></div></dl>{source.error && <details><summary>Détail du problème</summary><p>{source.error}</p></details>}</article>)}</div>
      <p className="today-fine-print">Actualiser relit les données conservées sur le PC. Les collectes et recherches existantes suivent leur propre calendrier.</p>
    </Sheet>
    <Sheet open={summaryOpen} onClose={() => setSummaryOpen(false)} title="Comprendre les montants" description="Trois catégories distinctes. Aucun total ne les additionne." className="today-sheet">
      <section className="today-explanation"><HeartHandshake size={22} aria-hidden="true" /><h3>Argent potentiellement à récupérer</h3><p>{feed.recoverable.amount === null ? "Le montant ne peut pas être établi avec les preuves disponibles et leur fraîcheur." : money.format(feed.recoverable.amount) + " de reste potentiellement récupérable dans les dossiers admissibles au calcul."} Ce montant ponctuel n’est ni dû ni garanti.</p><p>{feed.recoverable.known} dossier(s) avec un montant connu · {feed.recoverable.unknown} montant(s) non établi(s). L’ordre des assureurs et les paiements reçus restent détaillés dans chaque dossier.</p></section>
      <section className="today-explanation"><TrendingDown size={22} aria-hidden="true" /><h3>Économies possibles</h3>{numericPotential.length ? <ul>{numericPotential.map(item => <li key={item.id}>{item.title} : {benefitLabel(item)} {item.benefit.period ? periods[item.benefit.period] : "période inconnue"}</li>)}</ul> : <p>Aucun gain personnalisé chiffré n’est établi dans les cartes actuelles.</p>}<p>{unknownPotential.length ? unknownPotential.length + " piste(s) nécessitent encore des données ou une comparaison équivalente. " : ""}Frais, quantités, garanties et périodes doivent être comparables avant toute décision.</p></section>
      <section className="today-explanation"><FileCheck2 size={22} aria-hidden="true" /><h3>Économies obtenues</h3><p>Non mesuré. Une carte lue, masquée ou résolue ne prouve aucune économie. Un résultat doit être relié à un paiement ou à une facture vérifiée et dédupliquée.</p></section>
    </Sheet>
    <Sheet open={Boolean(selected)} onClose={() => setSelectedId(null)} title={selected?.title || "Sources et options"} description={selected?.description} className="today-sheet" footer={selected && <a className="button" href={opportunityHref(selected.target)} onClick={event => followLink(event, selected)}>{selected.actionLabel}<ArrowRight size={17} aria-hidden="true" /></a>}>
      {selected && <>
        <div className="today-detail-benefit"><span>{domainLabels[selected.domain]}</span><strong>{benefitLabel(selected)}</strong><p>{selected.benefit.amount === null ? "Aucun montant n’est supposé." : (selected.benefit.period ? periods[selected.benefit.period] : "Période à confirmer") + " · potentiel, à confirmer"}</p></div>
        <dl className="today-facts"><div><dt>Échéance</dt><dd>{selected.dueDate ? dateLabel(selected.dueDate) : "Non connue"}</dd></div><div><dt>Date des données</dt><dd>{dateLabel(selected.sourceDate)}</dd></div><div><dt>Fraîcheur</dt><dd>{selected.freshness === "fresh" ? "Dans la période de validité" : selected.freshness === "stale" ? "À actualiser" : "Non établie"}</dd></div><div><dt>Fiabilité</dt><dd>{selected.confidence === "verified" ? "Éléments vérifiés" : selected.confidence === "conditional" ? "Sous conditions" : "À établir"}</dd></div></dl>
        <h3>Preuves et conditions</h3><ul className="today-evidence">{selected.evidence.map((evidence, index) => <li key={index}>{evidence}</li>)}</ul>
        <section className="today-card-options"><h3>Gérer cette piste</h3><p>Cette décision est conservée sur votre PC. De nouvelles preuves peuvent faire réapparaître la piste.</p>{!feed.actionsAvailable ? <p role="status">Le suivi n’est pas disponible. Vérifiez la connexion ou la version du service dans les réglages.</p> : selected.decision && selected.decision !== "seen" ? <button type="button" className="button secondary" disabled={feed.actionBusy || !online} onClick={() => void decide(selected, "restore")}>Réafficher dans mes actions</button> : <div className="today-option-buttons">{selected.decision !== "seen" && <button type="button" className="button secondary" disabled={feed.actionBusy || !online} onClick={() => void decide(selected, "seen")}>Marquer comme lue</button>}<button type="button" className="button secondary" disabled={feed.actionBusy || !online} onClick={() => void decide(selected, "snooze")}><Clock3 size={17} aria-hidden="true" />Reporter de 7 jours</button><button type="button" className="button secondary" disabled={feed.actionBusy || !online} onClick={() => void decide(selected, "dismiss")}>Masquer cette piste</button><button type="button" className="button secondary" disabled={feed.actionBusy || !online} onClick={() => void decide(selected, "resolve")}>Marquer comme traitée</button><p className="today-fine-print">Marquer comme traitée ne valide aucun gain ni aucune soumission.</p></div>}{feed.actionBusy && <p role="status">Enregistrement sur votre PC…</p>}{feed.actionError && <Notice error>{feed.actionError}</Notice>}</section>
      </>}
    </Sheet>
  </div>;
}
