import { useMemo, useState } from "react";
import { CalendarDays, CircleDollarSign, FileText, HeartHandshake, Home, Mail, MoreHorizontal, ShieldCheck } from "lucide-react";
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

const nav: Array<{ id: AppView; label: string; icon: typeof Home }> = [
  { id: "reimbursements", label: "Claims", icon: HeartHandshake },
  { id: "invoices", label: "Invoices", icon: FileText },
  { id: "desjardins", label: "DJ", icon: ShieldCheck },
  { id: "blue-cross", label: "BC", icon: ShieldCheck },
  { id: "other", label: "Other", icon: MoreHorizontal }
];
const otherViews: Array<{ id: AppView; label: string; description: string; icon: typeof Home }> = [
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

  const todayLabel = useMemo(() => new Intl.DateTimeFormat(undefined, {
    weekday: "long", month: "long", day: "numeric"
  }).format(new Date()), []);

  const navigate = (next: AppView) => {
    setView(next);
    const url = new URL(location.href);
    if (next === "reimbursements") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    history.replaceState({}, "", url);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="app-shell">
      <aside className="app-rail">
        <div className="brand-mark" aria-label="FamilyHub"><span>F</span></div>
        <nav aria-label="Primary">
          {nav.map(item => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={view === item.id || item.id === "other" && otherViews.some(other => other.id === view) ? "nav-item active" : "nav-item"} onClick={() => navigate(item.id)} aria-current={view === item.id ? "page" : undefined}>
                <Icon size={21} strokeWidth={2} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="app-stage">
        <header className="app-header">
          <div>
            <div className="app-kicker">{todayLabel}</div>
            <strong>FamilyHub</strong>
          </div>
        </header>

        <main className="app-main">
          {view === "today" && <TodayView hub={state} onNavigate={navigate} commandOpen={commandOpen} onCommandOpenChange={setCommandOpen} />}
          {view === "inbox" && <InboxView hub={state} />}
          {view === "reimbursements" && <ReimbursementsView hub={state} />}
          {view === "invoices" && <DocumentLibraryView hub={state} kind="invoices" />}
          {view === "desjardins" && <DocumentLibraryView hub={state} kind="desjardins" />}
          {view === "blue-cross" && <DocumentLibraryView hub={state} kind="blue-cross" />}
          {view === "other" && <section className="view-stack"><div className="section-heading"><div><h1>Other</h1><p>Your household tools are still here whenever you need them.</p></div></div><div className="other-grid">{otherViews.map(item => { const Icon = item.icon; return <button key={item.id} className="other-link" onClick={() => navigate(item.id)}><Icon size={22} /><span><strong>{item.label}</strong><small>{item.description}</small></span></button>; })}</div></section>}
          {view === "plan" && <PlanView hub={state} />}
          {view === "money" && <MoneyView hub={state} />}
          {view === "more" && <MoreView hub={state} />}
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Primary navigation">
        {nav.map(item => {
          const Icon = item.icon;
          return (
            <button key={item.id} className={view === item.id || item.id === "other" && otherViews.some(other => other.id === view) ? "active" : ""} onClick={() => navigate(item.id)} aria-current={view === item.id ? "page" : undefined}>
              <Icon size={21} strokeWidth={2} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
