import { useEffect, useRef, useState } from "react";
import { CalendarDays, CircleDollarSign, Download, FileText, HeartHandshake, Home, Mail, MoreHorizontal, ChevronRight, Settings2, TrendingDown } from "lucide-react";
import { viewFromQuery } from "./domain";
import { useFamilyHubState } from "./state";
import type { AppView } from "./types";
import TodayView from "./views/TodayView";
import InboxView from "./views/InboxView";
import ReimbursementsView from "./views/ReimbursementsView";
import PlanView from "./views/PlanView";
import MoneyView from "./views/MoneyView";
import MoreView from "./views/MoreView";
import DocumentLibraryView from "./views/DocumentLibraryView";
import SavingsView from "./views/SavingsView";
import FinancesView from "./views/FinancesView";
import CoursesView from "./views/CoursesView";
import { PageHeader } from "./ui/primitives";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function runningStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

const nav: Array<{ id: AppView; label: string; icon: typeof Home }> = [
  { id: "reimbursements", label: "Claims", icon: HeartHandshake },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "savings", label: "Dépenses récurrentes", icon: TrendingDown },
  { id: "finances", label: "Finances", icon: CircleDollarSign },
  { id: "other", label: "Other", icon: MoreHorizontal }
];
const otherViews: Array<{ id: AppView; label: string; description: string; icon: typeof Home }> = [
  { id: "groceries", label: "Courses", description: "Liste habituelle, paniers comparés et tickets", icon: CalendarDays },
  { id: "today", label: "Today & Assistant", description: "Household overview and Ask", icon: Home },
  { id: "inbox", label: "Important mail", description: "Messages and document review", icon: Mail },
  { id: "plan", label: "Plan", description: "Meals, groceries and tasks", icon: CalendarDays },
  { id: "money", label: "Money", description: "Spending and planning", icon: CircleDollarSign },
  { id: "more", label: "Settings & tools", description: "Worker connection, backup and research", icon: MoreHorizontal }
];

export default function App() {
  const state = useFamilyHubState();
  const [view, setView] = useState<AppView>(viewFromQuery());
  const [commandOpen, setCommandOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => runningStandalone());

  const scrollPositions = useRef<Partial<Record<AppView, number>>>({});
  const viewRef = useRef(view); viewRef.current = view;
  const mainRef = useRef<HTMLElement>(null);
  const documentViews = [{ id: "invoices", label: "Invoices" }, { id: "desjardins", label: "Desjardins" }, { id: "blue-cross", label: "Blue Cross" }] as const;
  const documentKind = view === "documents" || view === "invoices" ? "invoices" : view === "desjardins" ? "desjardins" : view === "blue-cross" ? "blue-cross" : null;
  const navigationActive = (id: AppView) => view === id || id === "documents" && Boolean(documentKind) || id === "other" && otherViews.some(other => other.id === view);
  const pageName = nav.find(item => item.id === view)?.label || documentViews.find(item => item.id === view)?.label || otherViews.find(item => item.id === view)?.label || "FamilyHub";
  useEffect(() => {
    document.title = `${pageName} · FamilyHub`;
    const frame = requestAnimationFrame(() => window.scrollTo({ top: scrollPositions.current[view] || 0, behavior: "instant" }));
    return () => cancelAnimationFrame(frame);
  }, [view, pageName]);
  useEffect(() => {
    const onBack = () => {
      scrollPositions.current[viewRef.current] = window.scrollY;
      setView(viewFromQuery());
    };
    window.addEventListener("popstate", onBack);
    return () => window.removeEventListener("popstate", onBack);
  }, []);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      const promptEvent = event as BeforeInstallPromptEvent;
      promptEvent.preventDefault();
      setInstallPrompt(promptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
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
    if (choice.outcome === "accepted") {
      setInstalled(true);
      setInstallPrompt(null);
    }
  }

  const navigate = (next: AppView) => {
    if (next === view) { window.scrollTo({ top: 0, behavior: "instant" }); return; }
    scrollPositions.current[view] = window.scrollY;
    const url = new URL(location.href);
    if (next === "reimbursements") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    history.pushState({}, "", url);
    setView(next);
    requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: true }));
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="app-rail">
        <button type="button" className="rail-brand" onClick={() => navigate("reimbursements")} aria-label="FamilyHub home"><span className="brand-mark"><img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" /></span><span>FamilyHub<small>Your everyday assistant</small></span></button>
        <nav aria-label="Primary">
          {nav.map(item => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={navigationActive(item.id) ? "nav-item active" : "nav-item"} onClick={() => navigate(item.id)} aria-current={navigationActive(item.id) ? "page" : undefined}>
                <Icon size={21} strokeWidth={2} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        {!installed && installPrompt && <button type="button" className="header-install-button" onClick={() => void installApp()}><Download size={15} />Install app</button>}
        <button type="button" className="rail-settings" onClick={() => navigate("more")}><Settings2 size={18} />Settings & tools</button>
        <div className="rail-footnote">Saved on your device<br />Synced with your paired PC</div>
      </aside>

      <div className="app-stage">
        <main className="app-main" id="main-content" tabIndex={-1} ref={mainRef}>
          {view === "today" && <TodayView hub={state} onNavigate={navigate} commandOpen={commandOpen} onCommandOpenChange={setCommandOpen} />}
          {view === "inbox" && <InboxView hub={state} />}
          {view === "reimbursements" && <ReimbursementsView hub={state} />}
          {documentKind && <div className="view-stack"><nav className="segment-tabs document-tabs" aria-label="Document sources">
            {documentViews.map(item => <button key={item.id} className={documentKind === item.id ? "active" : ""} aria-current={documentKind === item.id ? "page" : undefined} onClick={() => navigate(item.id)}>{item.label}</button>)}
          </nav><DocumentLibraryView key={documentKind} hub={state} kind={documentKind} /></div>}
          {view === "savings" && <SavingsView hub={state} onNavigate={navigate} />}
          {view === "finances" && <FinancesView hub={state} onNavigate={navigate} />}
          {view === "groceries" && <CoursesView config={state.worker} plannerItems={state.planner.GroceryItems} />}
          {view === "other" && <section className="view-stack"><PageHeader title="Your household" subtitle="Everyday tools, in one place">{!installed && installPrompt && <button type="button" className="button secondary" onClick={() => void installApp()}><Download size={15} />Install</button>}</PageHeader><div className="other-grid">{otherViews.map(item => { const Icon = item.icon; return <button key={item.id} className="other-link" onClick={() => navigate(item.id)}><span className="other-icon"><Icon size={22} /></span><span><strong>{item.label}</strong><small>{item.description}</small></span><ChevronRight size={18} /></button>; })}</div></section>}
          {view === "plan" && <PlanView hub={state} />}
          {view === "money" && <MoneyView hub={state} />}
          {view === "more" && <MoreView hub={state} installAvailable={Boolean(installPrompt)} installed={installed} onInstall={() => void installApp()} />}
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Primary navigation">
        {nav.map(item => {
          const Icon = item.icon;
          return (
            <button key={item.id} className={navigationActive(item.id) ? "active" : ""} onClick={() => navigate(item.id)} aria-current={navigationActive(item.id) ? "page" : undefined}>
              <Icon size={21} strokeWidth={2} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
