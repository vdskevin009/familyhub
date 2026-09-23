import { useMemo, useState } from "react";
import {
  CalendarDays, CircleDollarSign, HeartHandshake, Home, Mail, MoreHorizontal, Search, Sparkles
} from "lucide-react";
import { viewFromQuery } from "./domain";
import { useFamilyHubState } from "./state";
import type { AppView } from "./types";
import TodayView from "./views/TodayView";
import InboxView from "./views/InboxView";
import ReimbursementsView from "./views/ReimbursementsView";
import PlanView from "./views/PlanView";
import MoneyView from "./views/MoneyView";
import MoreView from "./views/MoreView";

const nav: Array<{ id: AppView; label: string; mobileLabel?: string; icon: typeof Home }> = [
  { id: "today", label: "Today", icon: Home },
  { id: "inbox", label: "Important mail", mobileLabel: "Mail", icon: Mail },
  { id: "reimbursements", label: "Reimbursements", mobileLabel: "Claims", icon: HeartHandshake },
  { id: "plan", label: "Plan", icon: CalendarDays },
  { id: "money", label: "Money", icon: CircleDollarSign },
  { id: "more", label: "More", icon: MoreHorizontal }
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
    if (next === "today") url.searchParams.delete("view");
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
              <button key={item.id} className={view === item.id ? "nav-item active" : "nav-item"} onClick={() => navigate(item.id)}>
                <Icon size={21} strokeWidth={2} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <button className="nav-item assistant-shortcut" onClick={() => { navigate("today"); setCommandOpen(true); }}>
          <Sparkles size={21} /><span>Ask</span>
        </button>
      </aside>

      <div className="app-stage">
        <header className="app-header">
          <div>
            <div className="app-kicker">{todayLabel}</div>
            <strong>FamilyHub</strong>
          </div>
          <button className="icon-button" aria-label="Search and ask FamilyHub" onClick={() => { navigate("today"); setCommandOpen(true); }}>
            <Search size={20} />
          </button>
        </header>

        <main className="app-main">
          {view === "today" && <TodayView hub={state} onNavigate={navigate} commandOpen={commandOpen} onCommandOpenChange={setCommandOpen} />}
          {view === "inbox" && <InboxView hub={state} />}
          {view === "reimbursements" && <ReimbursementsView hub={state} />}
          {view === "plan" && <PlanView hub={state} />}
          {view === "money" && <MoneyView hub={state} />}
          {view === "more" && <MoreView hub={state} />}
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Primary navigation">
        {nav.map(item => {
          const Icon = item.icon;
          return (
            <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)}>
              <Icon size={21} strokeWidth={2} />
              <span>{item.mobileLabel || item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
