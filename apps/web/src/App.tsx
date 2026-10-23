import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Bell, CalendarDays, CircleDollarSign, Download, FileText, HeartHandshake, Home, Mail, MoreHorizontal, ChevronRight, Settings2, TrendingDown, ShoppingBasket } from "lucide-react";
import { viewFromQuery } from "./domain";
import { useFamilyHubState } from "./state";
import type { AppView } from "./types";
import TodayView from "./views/TodayView";
const InboxView = lazy(() => import("./views/InboxView"));
const ReimbursementsView = lazy(() => import("./views/ReimbursementsView"));
const PlanView = lazy(() => import("./views/PlanView"));
const MoneyView = lazy(() => import("./views/MoneyView"));
const MoreView = lazy(() => import("./views/MoreView"));
const DocumentLibraryView = lazy(() => import("./views/DocumentLibraryView"));
const SavingsView = lazy(() => import("./views/SavingsView"));
const MortgageView = lazy(() => import("./views/MortgageView"));
const FinancesView = lazy(() => import("./views/FinancesView"));
const CoursesView = lazy(() => import("./views/CoursesView"));
const NotificationsView = lazy(() => import("./views/NotificationsView"));
import { PageHeader } from "./ui/primitives";
import "./proactive.css";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function runningStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

const nav: Array<{ id: AppView; label: string; shortLabel?: string; icon: typeof Home }> = [
  { id: "today", label: "Aujourd’hui", icon: Home },
  { id: "reimbursements", label: "Remboursements", shortLabel: "Rembours.", icon: HeartHandshake },
  { id: "groceries", label: "Courses", icon: ShoppingBasket },
  { id: "savings", label: "Dépenses récurrentes", shortLabel: "Récurrent", icon: TrendingDown },
  { id: "other", label: "Plus", icon: MoreHorizontal }
];
const otherViews: Array<{ id: AppView; label: string; description: string; icon: typeof Home }> = [
  { id: "finances", label: "Finances", description: "Dépenses, comptes et abonnements détectés", icon: CircleDollarSign },
  { id: "mortgage", label: "Hypothèque", description: "Dossier, échéances et taux de référence", icon: Home },
  { id: "documents", label: "Documents", description: "Factures et décomptes des assureurs", icon: FileText },
  { id: "notifications", label: "Notifications", description: "Alertes, historique et préférences", icon: Bell },
  { id: "inbox", label: "Courrier important", description: "Messages et pièces à examiner", icon: Mail },
  { id: "plan", label: "Planifier", description: "Repas, liste de courses et tâches", icon: CalendarDays },
  { id: "money", label: "Money · outils locaux", description: "Vos imports, budgets et simulations conservés", icon: CircleDollarSign },
  { id: "more", label: "Réglages et outils", description: "Connexion au PC, sauvegardes et recherches", icon: Settings2 }
];

export default function App() {
  const state = useFamilyHubState();
  const [view, setView] = useState<AppView>(viewFromQuery());
  const [routeKey, setRouteKey] = useState(location.search);
  const [commandOpen, setCommandOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => runningStandalone());
  const scrollPositions = useRef<Partial<Record<AppView, number>>>({});
  const viewRef = useRef(view); viewRef.current = view;
  const mainRef = useRef<HTMLElement>(null);
  const documentViews = [{ id: "invoices", label: "Factures" }, { id: "desjardins", label: "Desjardins" }, { id: "blue-cross", label: "Blue Cross" }] as const;
  const documentKind = view === "documents" || view === "invoices" ? "invoices" : view === "desjardins" ? "desjardins" : view === "blue-cross" ? "blue-cross" : null;
  const navigationActive = (id: AppView) => view === id || id === "other" && (Boolean(documentKind) || otherViews.some(other => other.id === view));
  const pageName = nav.find(item => item.id === view)?.label || documentViews.find(item => item.id === view)?.label || otherViews.find(item => item.id === view)?.label || "FamilyHub";
  useEffect(() => {
    document.title = `${pageName} · FamilyHub`;
    const frame = requestAnimationFrame(() => window.scrollTo({ top: scrollPositions.current[view] || 0, behavior: "instant" }));
    return () => cancelAnimationFrame(frame);
  }, [view, pageName, routeKey]);
  useEffect(() => {
    const onBack = () => {
      scrollPositions.current[viewRef.current] = window.scrollY;
      setView(viewFromQuery());
      setRouteKey(location.search);
    };
    window.addEventListener("popstate", onBack);
    return () => window.removeEventListener("popstate", onBack);
  }, []);
  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => { setInstalled(true); setInstallPrompt(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") { setInstalled(true); setInstallPrompt(null); }
  }

  const openTarget = (href: string) => {
    const url = new URL(href, location.href);
    if (url.origin !== location.origin || url.pathname !== location.pathname) return;
    scrollPositions.current[view] = window.scrollY;
    history.pushState({}, "", url);
    setView(viewFromQuery());
    setRouteKey(url.search);
    requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: true }));
  };
  const navigate = (next: AppView) => {
    const url = new URL(location.href);
    for (const key of ["record", "notice", "queue", "sources", "tab", "from", "to", "account", "currency", "job", "offer"]) url.searchParams.delete(key);
    if (next === "today") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    if (url.search === location.search) { window.scrollTo({ top: 0, behavior: "instant" }); return; }
    openTarget(url.href);
  };

  return <div className="app-shell proactive-shell">
    <a className="skip-link" href="#main-content">Aller au contenu</a>
    <aside className="app-rail">
      <button type="button" className="rail-brand" onClick={() => navigate("today")} aria-label="FamilyHub, accueil"><span className="brand-mark"><img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" /></span><span>FamilyHub<small>Le prochain geste utile</small></span></button>
      <nav aria-label="Navigation principale">{nav.map(item => {
        const Icon = item.icon;
        return <button type="button" key={item.id} className={navigationActive(item.id) ? "nav-item active" : "nav-item"} onClick={() => navigate(item.id)} aria-current={navigationActive(item.id) ? "page" : undefined}><Icon size={21} strokeWidth={2} aria-hidden="true" /><span>{item.label}</span></button>;
      })}</nav>
      {!installed && installPrompt && <button type="button" className="header-install-button" onClick={() => void installApp()}><Download size={15} aria-hidden="true" />Installer l’app</button>}
      <button type="button" className="rail-settings" onClick={() => navigate("more")}><Settings2 size={18} aria-hidden="true" />Réglages et outils</button>
      <div className="rail-footnote">Vos données privées<br />sur votre PC associé</div>
    </aside>
    <div className="app-stage">
      <div className="shell-tools"><button type="button" className="icon-button" title="Notifications" aria-label="Ouvrir les notifications" onClick={() => navigate("notifications")}><Bell size={19} aria-hidden="true" /></button></div>
      <main className="app-main" id="main-content" tabIndex={-1} ref={mainRef}>
          <Suspense fallback={<div role="status" className="notice">Chargement de la section…</div>}>
        {view === "today" && <TodayView hub={state} onNavigate={navigate} onOpenTarget={openTarget} commandOpen={commandOpen} onCommandOpenChange={setCommandOpen} />}
        {view === "inbox" && <InboxView hub={state} />}
        {view === "notifications" && <NotificationsView hub={state} onNavigate={navigate} />}
        {view === "reimbursements" && <ReimbursementsView key={routeKey} hub={state} />}
        {documentKind && <div className="view-stack"><nav className="segment-tabs document-tabs" aria-label="Sources documentaires">{documentViews.map(item => <button type="button" key={item.id} className={documentKind === item.id ? "active" : ""} aria-current={documentKind === item.id ? "page" : undefined} onClick={() => navigate(item.id)}>{item.label}</button>)}</nav><DocumentLibraryView key={documentKind} hub={state} kind={documentKind} /></div>}
        {view === "savings" && <SavingsView key={routeKey} hub={state} onNavigate={navigate} />}
        {view === "mortgage" && <MortgageView worker={state.worker} />}
        {view === "finances" && <FinancesView key={routeKey} hub={state} onNavigate={navigate} />}
        {view === "groceries" && <CoursesView key={routeKey} config={state.worker} plannerItems={state.planner.GroceryItems} />}
        {view === "other" && <section className="view-stack more-hub"><PageHeader title="Plus" subtitle="Tous vos outils, toujours accessibles">{!installed && installPrompt && <button type="button" className="button secondary" onClick={() => void installApp()}><Download size={15} aria-hidden="true" />Installer</button>}</PageHeader><div className="other-grid">{otherViews.map(item => { const Icon = item.icon; return <button type="button" key={item.id} className="other-link" onClick={() => navigate(item.id)}><span className="other-icon"><Icon size={22} aria-hidden="true" /></span><span><strong>{item.label}</strong><small>{item.description}</small></span><ChevronRight size={18} aria-hidden="true" /></button>; })}</div></section>}
        {view === "plan" && <PlanView hub={state} />}
        {view === "money" && <MoneyView hub={state} />}
        {view === "more" && <MoreView hub={state} installAvailable={Boolean(installPrompt)} installed={installed} onInstall={() => void installApp()} />}
        </Suspense>
      </main>
    </div>
    <nav className="bottom-nav" aria-label="Navigation principale mobile">{nav.map(item => {
      const Icon = item.icon;
      return <button type="button" key={item.id} className={navigationActive(item.id) ? "active" : ""} onClick={() => navigate(item.id)} aria-label={item.label} aria-current={navigationActive(item.id) ? "page" : undefined}><Icon size={21} strokeWidth={2} aria-hidden="true" /><span>{item.shortLabel ?? item.label}</span></button>;
    })}</nav>
  </div>;
}
