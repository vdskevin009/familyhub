import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Bell, CalendarDays, CircleDollarSign, Download, FileText, HeartHandshake, Home, Mail, MoreHorizontal, ChevronRight, Settings2, TrendingDown, ShoppingBasket } from "lucide-react";
import { viewFromQuery } from "./domain";
import { primaryDestination } from "./navigation";
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
const ProjectsView = lazy(() => import("./views/ProjectsView"));
const VehicleProjectView = lazy(() => import("./views/VehicleProjectView"));
const PropertyProjectView = lazy(() => import("./views/PropertyProjectView"));
const MortgageView = lazy(() => import("./views/MortgageView"));
const FinancesView = lazy(() => import("./views/FinancesView"));
const CoursesView = lazy(() => import("./views/CoursesView"));
const NotificationsView = lazy(() => import("./views/NotificationsView"));
import { noteSheetActivation, PageHeader } from "./ui/primitives";
import SectionBoundary from "./ui/SectionBoundary";
import "./notifications.css";
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
  { id: "today", label: "Today", icon: Home },
  { id: "reimbursements", label: "Reimbursements", shortLabel: "Claims", icon: HeartHandshake },
  { id: "finances", label: "Finances", icon: CircleDollarSign },
  { id: "projects", label: "Projects", icon: Home },
  { id: "other", label: "More", icon: MoreHorizontal }
];
const otherViews: Array<{ id: AppView; label: string; description: string; icon: typeof Home }> = [
  { id: "savings", label: "Recurring expenses", description: "Services, contracts and subscriptions", icon: TrendingDown },
  { id: "mortgage", label: "Mortgage", description: "Your mortgage, deadlines and reference rates", icon: Home },
  { id: "documents", label: "Documents", description: "Invoices and insurer statements", icon: FileText },
  { id: "notifications", label: "Notifications", description: "Alerts, history and preferences", icon: Bell },
  { id: "inbox", label: "Important mail", description: "Messages and attachments to review", icon: Mail },
  { id: "plan", label: "Planner", description: "Meals, shopping list and tasks", icon: CalendarDays },
  { id: "money", label: "Money · local tools", description: "Saved imports, budgets and simulations", icon: CircleDollarSign },
  { id: "more", label: "Settings and tools", description: "PC connection, backups and research", icon: Settings2 }
];

export default function App() {
  const state = useFamilyHubState();
  const projectContextKey = useMemo(() => crypto.randomUUID(), [state.worker.Endpoint, state.worker.ApiKey]);
  const [view, setView] = useState<AppView>(viewFromQuery());
  const [routeKey, setRouteKey] = useState(location.search);
  const [animateMobileNav, setAnimateMobileNav] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => runningStandalone());
  const scrollPositions = useRef<Partial<Record<AppView, number>>>({});
  const viewRef = useRef(view); viewRef.current = view;
  const mainRef = useRef<HTMLElement>(null);
  const documentViews = [{ id: "invoices", label: "Invoices" }, { id: "desjardins", label: "Desjardins" }, { id: "blue-cross", label: "Blue Cross" }] as const;
  const documentKind = view === "documents" || view === "invoices" ? "invoices" : view === "desjardins" ? "desjardins" : view === "blue-cross" ? "blue-cross" : null;
  const navigationActive = (id: AppView) => primaryDestination(view) === id;
  const mobileNavIndex = nav.findIndex(item => navigationActive(item.id));
  const pageName = view === "vehicle" ? "Vehicles" : view === "property" ? "Property search" : view === "contributions" ? "Finances — Contributions" : nav.find(item => item.id === view)?.label || documentViews.find(item => item.id === view)?.label || otherViews.find(item => item.id === view)?.label || "FamilyHub";
  useEffect(() => {
    document.title = `${pageName} · FamilyHub`;
    const frame = requestAnimationFrame(() => window.scrollTo({ top: scrollPositions.current[view] || 0, behavior: "instant" }));
    return () => cancelAnimationFrame(frame);
  }, [view, pageName, routeKey]);
  useEffect(() => {
    const onBack = () => {
      // Purchase info owns a same-URL history entry; its Back closes the modal only.
      const purchase = document.querySelector<HTMLElement>(".grocery-purchases[data-purchase-dialog-url]");
      if (purchase?.dataset.purchaseDialogUrl === location.href && purchase.querySelector("dialog[open]")) return;
      scrollPositions.current[viewRef.current] = window.scrollY;
      setAnimateMobileNav(false);
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

  const openTarget = (href: string, animateNav = false) => {
    const url = new URL(href, location.href);
    if (url.origin !== location.origin || url.pathname !== location.pathname) return;
    scrollPositions.current[view] = window.scrollY;
    setAnimateMobileNav(animateNav);
    history.pushState({}, "", url);
    setView(viewFromQuery());
    setRouteKey(url.search);
    requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: true }));
  };
  const navigate = (next: AppView, animateNav = false) => {
    const url = new URL(location.href);
    for (const key of ["record", "notice", "queue", "sources", "tab", "from", "to", "account", "currency", "job", "offer"]) url.searchParams.delete(key);
    if (next === "today") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    if (url.search === location.search) { window.scrollTo({ top: 0, behavior: "instant" }); return; }
    openTarget(url.href, animateNav);
  };

  return <div className="app-shell proactive-shell" onClickCapture={event => noteSheetActivation(event.nativeEvent)}
    onKeyDownCapture={() => noteSheetActivation()}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="app-rail">
      <button type="button" className="rail-brand" onClick={() => navigate("today")} aria-label="FamilyHub home"><span className="brand-mark"><img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" /></span><span>FamilyHub<small>Your next useful action</small></span></button>
      <nav aria-label="Main navigation">{nav.map(item => {
        const Icon = item.icon;
        return <button type="button" key={item.id} className={navigationActive(item.id) ? "nav-item active" : "nav-item"} onClick={() => navigate(item.id)} aria-current={navigationActive(item.id) ? "page" : undefined}><Icon size={21} strokeWidth={2} aria-hidden="true" /><span>{item.label}</span></button>;
      })}</nav>
      {!installed && installPrompt && <button type="button" className="header-install-button" onClick={() => void installApp()}><Download size={15} aria-hidden="true" />Install app</button>}
      <button type="button" className="rail-settings" onClick={() => navigate("more")}><Settings2 size={18} aria-hidden="true" />Settings and tools</button>
      <div className="rail-footnote">Your private data<br />on your paired PC</div>
    </aside>
    <div className="app-stage">
      <div className="shell-tools"><button type="button" className="icon-button" title="Notifications" aria-label="Open notifications" onClick={() => navigate("notifications")}><Bell size={19} aria-hidden="true" /></button></div>
      <main className="app-main" id="main-content" tabIndex={-1} ref={mainRef}>
        <SectionBoundary key={view} label={pageName} onHome={() => navigate("today")}>
        <Suspense fallback={<div role="status" className="notice">Loading section…</div>}>
        {view === "today" && <TodayView hub={state} onNavigate={navigate} onOpenTarget={openTarget} commandOpen={commandOpen} onCommandOpenChange={setCommandOpen} />}
        {view === "inbox" && <InboxView hub={state} />}
        {view === "notifications" && <NotificationsView hub={state} onNavigate={navigate} />}
        {view === "reimbursements" && <ReimbursementsView key={routeKey} hub={state} />}
        {documentKind && <div className="view-stack"><nav className="segment-tabs document-tabs" aria-label="Document sources">{documentViews.map(item => <button type="button" key={item.id} className={documentKind === item.id ? "active" : ""} aria-current={documentKind === item.id ? "page" : undefined} onClick={() => navigate(item.id)}>{item.label}</button>)}</nav><DocumentLibraryView key={documentKind} hub={state} kind={documentKind} /></div>}
        {view === "savings" && <SavingsView key={routeKey} hub={state} onNavigate={navigate} />}
        {view === "projects" && <ProjectsView onNavigate={navigate} />}
        {view === "vehicle" && <VehicleProjectView key={`${projectContextKey}:${routeKey}`} initialListingId={new URLSearchParams(routeKey).get("record") ?? undefined} config={state.worker} onBack={() => navigate("projects")} />}
        {view === "property" && <PropertyProjectView key={`${projectContextKey}:${routeKey}`} initialListingId={new URLSearchParams(routeKey).get("record") ?? undefined} config={state.worker} onBack={() => navigate("projects")} />}
        {view === "mortgage" && <MortgageView worker={state.worker} />}
        {(view === "finances" || view === "contributions") && <FinancesView key={routeKey} hub={state} onNavigate={navigate} initialTab={view === "contributions" ? "contributions" : undefined} />}
        {view === "groceries" && <CoursesView key={routeKey} config={state.worker} plannerItems={state.planner.GroceryItems} />}
        {view === "other" && <section className="view-stack more-hub"><PageHeader title="More" subtitle="All your tools in one place">{!installed && installPrompt && <button type="button" className="button secondary" onClick={() => void installApp()}><Download size={15} aria-hidden="true" />Install</button>}</PageHeader><div className="other-grid">{otherViews.map(item => { const Icon = item.icon; return <button type="button" key={item.id} className="other-link" onClick={() => navigate(item.id)}><span className="other-icon"><Icon size={22} aria-hidden="true" /></span><span><strong>{item.label}</strong><small>{item.description}</small></span><ChevronRight size={18} aria-hidden="true" /></button>; })}</div></section>}
        {view === "plan" && <PlanView hub={state} />}
        {view === "money" && <MoneyView hub={state} />}
        {view === "more" && <MoreView hub={state} installAvailable={Boolean(installPrompt)} installed={installed} onInstall={() => void installApp()} />}
        </Suspense>
        </SectionBoundary>
      </main>
    </div>
    <nav className="bottom-nav" aria-label="Mobile navigation" data-animate={animateMobileNav ? "pointer" : undefined}
      style={{ "--nav-slot": mobileNavIndex } as CSSProperties}>{nav.map(item => {
      const Icon = item.icon;
      return <button type="button" key={item.id} className={navigationActive(item.id) ? "active" : ""} onClick={event => navigate(item.id, event.detail > 0)} aria-label={item.label} aria-current={navigationActive(item.id) ? "page" : undefined}><Icon size={21} strokeWidth={2} aria-hidden="true" /><span>{item.shortLabel ?? item.label}</span></button>;
    })}</nav>
  </div>;
}
