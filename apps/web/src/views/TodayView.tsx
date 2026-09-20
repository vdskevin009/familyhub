import { FormEvent, useMemo, useState } from "react";
import {
  ArrowRight, CalendarCheck, CircleDollarSign, Inbox, ListChecks, MessageCircle, RefreshCw, ShoppingBasket, Sparkles
} from "lucide-react";
import { assistantInsights, buildAssistantContext } from "../domain";
import type { HubState } from "../state";
import type { AppView } from "../types";
import { runWorkerTask } from "../worker";

type Props = {
  hub: HubState;
  onNavigate: (view: AppView) => void;
  commandOpen: boolean;
  onCommandOpenChange: (open: boolean) => void;
};

export default function TodayView({ hub, onNavigate, commandOpen, onCommandOpenChange }: Props) {
  const insights = useMemo(
    () => assistantInsights(hub.family, hub.reimbursements, hub.savings, hub.planner, hub.spending),
    [hub.family, hub.reimbursements, hub.savings, hub.planner, hub.spending]
  );
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);
  const workerReady = Boolean(hub.worker.Endpoint.trim() && hub.worker.ApiKey.trim());

  async function ask(event: FormEvent) {
    event.preventDefault();
    const prompt = question.trim();
    if (!prompt) return;
    setAsking(true);
    setAnswer("");
    try {
      if (!workerReady) {
        setAnswer("The local AI worker is not connected yet. FamilyHub can still surface your local priorities, but connect the worker in More → Local AI worker for open-ended analysis.");
      } else {
        const context = buildAssistantContext(hub.family, hub.reimbursements, hub.savings, hub.planner, hub.spending);
        const task = await runWorkerTask(
          hub.worker,
          "general",
          `You are the FamilyHub household assistant. Answer the user's question concisely and practically. Do not invent live integrations or actions. Use only the supplied household summary and, when useful, public web research. Never claim an action happened unless the task explicitly reports it.\n\nHOUSEHOLD SUMMARY\n${context}\n\nUSER QUESTION\n${prompt}`
        );
        setAnswer(task.result || "The worker completed the request without a text response.");
      }
    } catch (error) {
      setAnswer(error instanceof Error ? error.message : "The worker request failed.");
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="view-stack">
      <section className="today-hero">
        <div>
          <span className="eyebrow">Your day, filtered</span>
          <h1>What deserves attention.</h1>
          <p>FamilyHub brings forward the few things most likely to save time, prevent an oversight or save money.</p>
        </div>
        <div className="hero-orb"><Sparkles size={30} /></div>
      </section>

      <section className="insight-grid" aria-label="Priority insights">
        {insights.map((insight, index) => (
          <article key={insight.id} className={`insight-card tone-${insight.tone} ${index === 0 ? "featured" : ""}`}>
            <div className="insight-top">
              <span>{insight.eyebrow}</span>
              <span className="rank">{String(index + 1).padStart(2, "0")}</span>
            </div>
            <h2>{insight.title}</h2>
            <p>{insight.detail}</p>
            {insight.action && (
              <button className="text-action" onClick={() => onNavigate(insight.action!)}>
                Review <ArrowRight size={16} />
              </button>
            )}
          </article>
        ))}
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div><span className="eyebrow">Quick moves</span><h2>Handle the week in a few taps</h2></div>
        </div>
        <div className="quick-grid">
          <button className="quick-card" onClick={() => onNavigate("inbox")}>
            <span className="quick-icon"><Inbox size={20} /></span>
            <strong>Scan inbox</strong>
            <small>Filter real documents from noise</small>
          </button>
          <button className="quick-card" onClick={() => onNavigate("plan")}>
            <span className="quick-icon"><ShoppingBasket size={20} /></span>
            <strong>Plan meals</strong>
            <small>Turn the week into one grocery list</small>
          </button>
          <button className="quick-card" onClick={() => onNavigate("money")}>
            <span className="quick-icon"><CircleDollarSign size={20} /></span>
            <strong>Review money</strong>
            <small>Subscriptions, spending and mortgage</small>
          </button>
          <button className="quick-card" onClick={() => onNavigate("more")}>
            <span className="quick-icon"><RefreshCw size={20} /></span>
            <strong>Research watches</strong>
            <small>Ask the local worker to look for opportunities</small>
          </button>
        </div>
      </section>

      <section className="pulse-card">
        <div className="pulse-item">
          <span><CalendarCheck size={18} /></span>
          <div><strong>{hub.family.Entries.filter(item => !item.Done).length}</strong><small>open plans</small></div>
        </div>
        <div className="pulse-item">
          <span><ListChecks size={18} /></span>
          <div><strong>{hub.reimbursements.Items.filter(item => item.Status < 2).length}</strong><small>inbox items to review</small></div>
        </div>
        <div className="pulse-item">
          <span><ShoppingBasket size={18} /></span>
          <div><strong>{hub.planner.GroceryItems.filter(item => !item.Checked).length}</strong><small>grocery items</small></div>
        </div>
      </section>

      <section className={commandOpen ? "assistant-card open" : "assistant-card"}>
        <button className="assistant-title" onClick={() => onCommandOpenChange(!commandOpen)}>
          <span className="assistant-avatar"><Sparkles size={19} /></span>
          <span><strong>Ask FamilyHub</strong><small>{workerReady ? "Local Codex worker connected" : "Local insights available · AI worker optional"}</small></span>
          <MessageCircle size={20} />
        </button>
        {commandOpen && (
          <div className="assistant-body">
            <form className="ask-form" onSubmit={ask}>
              <textarea
                value={question}
                onChange={event => setQuestion(event.target.value)}
                placeholder="e.g. What should I deal with first this weekend?"
                rows={3}
              />
              <button disabled={asking || !question.trim()}>{asking ? "Thinking…" : "Ask"}</button>
            </form>
            {answer && <div className="assistant-answer">{answer}</div>}
            <p className="privacy-note">FamilyHub only sends the summarized context shown by the app to your configured local worker. It does not send full Gmail message bodies.</p>
          </div>
        )}
      </section>
    </div>
  );
}
