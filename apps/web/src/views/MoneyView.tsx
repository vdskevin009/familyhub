import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import {
  AlertCircle, BarChart3, Check, CircleDollarSign, FileSpreadsheet, Landmark, Plus, RefreshCw,
  Sparkles, Trash2, TrendingDown, WalletCards
} from "lucide-react";
import {
  annualSubscriptionCost, buildAssistantContext, currency, currentMonthSpend, mortgage,
  parseTransactionsCsv, recurringCandidates
} from "../domain";
import type { HubState } from "../state";
import { BillingCycle } from "../types";
import { uid } from "../storage";
import { runWorkerTask } from "../worker";

type Props = { hub: HubState };
type Tab = "overview" | "spending" | "subscriptions" | "mortgage";

const cycleLabel = (cycle: BillingCycle) =>
  cycle === BillingCycle.Annual ? "year" : cycle === BillingCycle.Weekly ? "week" : "month";

export default function MoneyView({ hub }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [subName, setSubName] = useState("");
  const [subPrice, setSubPrice] = useState("");
  const [subCycle, setSubCycle] = useState(BillingCycle.Monthly);
  const [subRenewal, setSubRenewal] = useState(() => new Date().toISOString().slice(0, 10));

  const monthlySpend = currentMonthSpend(hub.spending);
  const activeSubscriptions = hub.savings.Subscriptions.filter(item => !item.Cancelled);
  const annualSubscriptions = activeSubscriptions.reduce((sum, item) => sum + annualSubscriptionCost(item.Price, item.Cycle), 0);
  const reviewSubscriptions = activeSubscriptions.filter(item => item.Review);
  const reviewAnnual = reviewSubscriptions.reduce((sum, item) => sum + annualSubscriptionCost(item.Price, item.Cycle), 0);

  const categories = useMemo(() => {
    const totals = new Map<string, number>();
    for (const tx of hub.spending.Transactions) totals.set(tx.Category, (totals.get(tx.Category) ?? 0) + tx.Amount);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [hub.spending.Transactions]);

  const recurring = useMemo(() => recurringCandidates(hub.spending), [hub.spending]);
  const currentMortgage = mortgage(
    hub.savings.Mortgage.Balance,
    hub.savings.Mortgage.BaseRate,
    hub.savings.Mortgage.Years,
    hub.savings.Mortgage.TermMonths
  );
  const offerMortgage = mortgage(
    hub.savings.Mortgage.Balance,
    hub.savings.Mortgage.OfferRate,
    hub.savings.Mortgage.Years,
    hub.savings.Mortgage.TermMonths
  );
  const mortgageNetSavings = Math.max(0, currentMortgage.interest - offerMortgage.interest - hub.savings.Mortgage.Fees);

  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setMessage("");
    try {
      const incoming = parseTransactionsCsv(await file.text(), file.name);
      hub.setSpending(previous => {
        const seen = new Set(previous.Transactions.map(tx =>
          [tx.Date.slice(0, 10), tx.Description.toLowerCase(), tx.Amount.toFixed(2)].join("|")
        ));
        const unique = incoming.filter(tx => {
          const key = [tx.Date.slice(0, 10), tx.Description.toLowerCase(), tx.Amount.toFixed(2)].join("|");
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        return {
          ...previous,
          Transactions: [...previous.Transactions, ...unique],
          LastImportAt: new Date().toISOString()
        };
      });
      setMessage(`Imported ${incoming.length} transaction rows. FamilyHub removes obvious duplicate rows when combining imports.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import that CSV.");
    }
  }

  function addSubscription(event: FormEvent) {
    event.preventDefault();
    const price = Number(subPrice);
    if (!subName.trim() || !Number.isFinite(price) || price < 0) {
      setError("Enter a subscription name and valid price.");
      return;
    }
    hub.setSavings(previous => ({
      ...previous,
      Subscriptions: [...previous.Subscriptions, {
        Id: uid(),
        Name: subName.trim(),
        Price: price,
        Cycle: subCycle,
        Renewal: new Date(`${subRenewal}T12:00:00`).toISOString(),
        Review: false,
        Cancelled: false
      }]
    }));
    setSubName("");
    setSubPrice("");
    setMessage("Subscription added.");
  }

  function addRecurringCandidate(merchant: string, average: number) {
    if (hub.savings.Subscriptions.some(item => item.Name.toLowerCase() === merchant.toLowerCase())) {
      setMessage("That recurring merchant is already in your subscription list.");
      return;
    }
    hub.setSavings(previous => ({
      ...previous,
      Subscriptions: [...previous.Subscriptions, {
        Id: uid(),
        Name: merchant,
        Price: Number(average.toFixed(2)),
        Cycle: BillingCycle.Monthly,
        Renewal: new Date(new Date().setMonth(new Date().getMonth() + 1)).toISOString(),
        Review: true,
        Cancelled: false
      }]
    }));
    setMessage(`${merchant} was added as a monthly review candidate. Confirm the amount and billing cycle before relying on it.`);
  }

  function updateMortgage(field: keyof typeof hub.savings.Mortgage, value: string | number) {
    hub.setSavings(previous => ({
      ...previous,
      Mortgage: { ...previous.Mortgage, [field]: value }
    }));
  }

  async function askWorkerForReview() {
    if (!hub.worker.Endpoint || !hub.worker.ApiKey) {
      setError("Connect the local AI worker in More first.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const context = buildAssistantContext(hub.family, hub.reimbursements, hub.savings, hub.planner, hub.spending);
      const task = await runWorkerTask(
        hub.worker,
        "financial-review",
        `Review this household finance summary for practical ways to reduce recurring costs or catch anomalies. Be conservative: do not give investment instructions, do not assume live bank access, and clearly separate observed data from suggestions.\n\n${context}`
      );
      setMessage(task.result || "Financial review completed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Financial review failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="view-stack">
      <section className="view-hero compact">
        <div>
          <span className="eyebrow">Money autopilot</span>
          <h1>See where money leaks.</h1>
          <p>Import transactions when you want a review. FamilyHub keeps the analysis local in your browser and surfaces recurring costs, subscriptions and mortgage comparisons.</p>
        </div>
        <span className="hero-icon"><CircleDollarSign size={26} /></span>
      </section>

      {error && <div className="banner error"><AlertCircle size={17} />{error}</div>}
      {message && <div className="banner info"><Check size={17} /><span>{message}</span></div>}

      <section className="metric-row">
        <article><small>Imported this month</small><strong>{currency.format(monthlySpend)}</strong><span>not a live bank balance</span></article>
        <article><small>Active subscriptions</small><strong>{currency.format(annualSubscriptions)}</strong><span>annualized</span></article>
        <article><small>Flagged for review</small><strong>{currency.format(reviewAnnual)}</strong><span>potential, not realized savings</span></article>
      </section>

      <div className="segment-tabs">
        {([
          ["overview", "Overview"],
          ["spending", "Spending"],
          ["subscriptions", "Subscriptions"],
          ["mortgage", "Mortgage"]
        ] as Array<[Tab, string]>).map(([id, label]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === "overview" && (
        <>
          <section className="two-column">
            <div className="surface">
              <div className="section-heading inline">
                <div><span className="eyebrow">Spending pulse</span><h2>Top imported categories</h2></div>
                <BarChart3 size={20} />
              </div>
              {!categories.length && <div className="empty-state"><FileSpreadsheet size={28} /><strong>No spending imported</strong><span>Export a CSV from your bank and import it in the Spending tab.</span></div>}
              <div className="category-list">
                {categories.map(([category, total]) => {
                  const max = categories[0]?.[1] || 1;
                  return (
                    <article key={category}>
                      <div><strong>{category}</strong><span>{currency.format(total)}</span></div>
                      <div className="bar-track"><span style={{ width: `${Math.max(4, Math.round(total / max * 100))}%` }} /></div>
                    </article>
                  );
                })}
              </div>
            </div>

            <div className="surface">
              <div className="section-heading"><span className="eyebrow">Opportunities</span><h2>What deserves a look</h2></div>
              <div className="opportunity-list">
                {reviewSubscriptions.map(item => (
                  <article key={item.Id}>
                    <span className="opportunity-icon"><TrendingDown size={17} /></span>
                    <div className="grow"><strong>{item.Name}</strong><small>{currency.format(annualSubscriptionCost(item.Price, item.Cycle))}/year flagged for review</small></div>
                  </article>
                ))}
                {mortgageNetSavings > 0 && (
                  <article>
                    <span className="opportunity-icon"><Landmark size={17} /></span>
                    <div className="grow"><strong>Mortgage comparison</strong><small>{currency.format(mortgageNetSavings)} estimated interest difference after entered fees</small></div>
                  </article>
                )}
                {!reviewSubscriptions.length && mortgageNetSavings <= 0 && (
                  <div className="empty-state small"><Check size={25} /><strong>No configured savings flags</strong><span>Import spending, flag subscriptions, or enter mortgage rates.</span></div>
                )}
              </div>
              <button className="button secondary wide-button" disabled={busy} onClick={askWorkerForReview}>
                <Sparkles size={17} /> {busy ? "Reviewing…" : "Ask local worker for a review"}
              </button>
            </div>
          </section>
        </>
      )}

      {tab === "spending" && (
        <section className="two-column">
          <div className="surface">
            <div className="section-heading inline">
              <div><span className="eyebrow">CSV import</span><h2>Bring your own transactions</h2></div>
              <WalletCards size={20} />
            </div>
            <p className="muted">FamilyHub reads a normal CSV export containing date, description and amount/debit columns. It does not connect directly to your bank.</p>
            <label className="file-drop">
              <FileSpreadsheet size={26} />
              <strong>Choose bank CSV</strong>
              <span>The file is parsed in this browser.</span>
              <input type="file" accept=".csv,text/csv" onChange={importCsv} />
            </label>
            <div className="row-actions">
              <span className="muted">{hub.spending.Transactions.length} saved transaction rows</span>
              {!!hub.spending.Transactions.length && (
                <button className="mini-button danger" onClick={() => {
                  if (confirm("Clear all imported transaction rows from this browser?")) {
                    hub.setSpending({ SchemaVersion: 1, Transactions: [] });
                    setMessage("Imported spending data cleared.");
                  }
                }}><Trash2 size={14} /> Clear</button>
              )}
            </div>
          </div>

          <div className="surface">
            <div className="section-heading"><span className="eyebrow">Recurring detection</span><h2>Likely repeating merchants</h2></div>
            <div className="opportunity-list">
              {recurring.map(item => (
                <article key={item.merchant}>
                  <span className="opportunity-icon"><RefreshCw size={16} /></span>
                  <div className="grow"><strong>{item.merchant || "Recurring merchant"}</strong><small>{item.count} imported charges · avg {currency.format(item.average)}</small></div>
                  <button className="mini-button" onClick={() => addRecurringCandidate(item.merchant, item.average)}><Plus size={14} /> Review</button>
                </article>
              ))}
              {!recurring.length && <div className="empty-state small"><RefreshCw size={25} /><strong>No pattern yet</strong><span>Import at least a couple of months to make recurring charges easier to spot.</span></div>}
            </div>
          </div>
        </section>
      )}

      {tab === "subscriptions" && (
        <section className="two-column">
          <div className="surface">
            <div className="section-heading"><span className="eyebrow">Subscription hunter</span><h2>{activeSubscriptions.length} active services</h2></div>
            <div className="subscription-list">
              {hub.savings.Subscriptions.map(item => (
                <article className={item.Cancelled ? "subscription-row cancelled" : "subscription-row"} key={item.Id}>
                  <div className="grow">
                    <strong>{item.Name}</strong>
                    <small>{currency.format(item.Price)}/{cycleLabel(item.Cycle)} · {currency.format(annualSubscriptionCost(item.Price, item.Cycle))}/year</small>
                  </div>
                  <label className="toggle-label"><input type="checkbox" checked={item.Review} onChange={event => hub.setSavings(previous => ({
                    ...previous,
                    Subscriptions: previous.Subscriptions.map(x => x.Id === item.Id ? { ...x, Review: event.target.checked } : x)
                  }))} /> Review</label>
                  <button className="mini-button" onClick={() => hub.setSavings(previous => ({
                    ...previous,
                    Subscriptions: previous.Subscriptions.map(x => x.Id === item.Id ? { ...x, Cancelled: !x.Cancelled } : x)
                  }))}>{item.Cancelled ? "Restore" : "Mark cancelled"}</button>
                  <button className="icon-button subtle" aria-label="Delete subscription" onClick={() => hub.setSavings(previous => ({
                    ...previous,
                    Subscriptions: previous.Subscriptions.filter(x => x.Id !== item.Id)
                  }))}><Trash2 size={15} /></button>
                </article>
              ))}
              {!hub.savings.Subscriptions.length && <div className="empty-state"><CircleDollarSign size={27} /><strong>No subscriptions yet</strong><span>Add them manually or promote recurring transaction candidates.</span></div>}
            </div>
          </div>

          <form className="surface form-surface" onSubmit={addSubscription}>
            <span className="eyebrow">Add recurring cost</span><h2>New subscription</h2>
            <label>Name<input value={subName} onChange={event => setSubName(event.target.value)} placeholder="e.g. Netflix" /></label>
            <label>Price<input inputMode="decimal" value={subPrice} onChange={event => setSubPrice(event.target.value)} placeholder="25.99" /></label>
            <label>Billing cycle
              <select value={subCycle} onChange={event => setSubCycle(Number(event.target.value) as BillingCycle)}>
                <option value={BillingCycle.Monthly}>Monthly</option>
                <option value={BillingCycle.Annual}>Annual</option>
                <option value={BillingCycle.Weekly}>Weekly</option>
              </select>
            </label>
            <label>Next renewal<input type="date" value={subRenewal} onChange={event => setSubRenewal(event.target.value)} /></label>
            <button className="button">Add subscription</button>
          </form>
        </section>
      )}

      {tab === "mortgage" && (
        <section className="two-column">
          <form className="surface form-surface" onSubmit={event => event.preventDefault()}>
            <span className="eyebrow">Renewal optimizer</span><h2>Compare entered rates</h2>
            <div className="form-grid">
              <label>Balance at renewal<input type="number" min="0" step="100" value={hub.savings.Mortgage.Balance} onChange={event => updateMortgage("Balance", Number(event.target.value))} /></label>
              <label>Amortization years<input type="number" min="1" max="40" value={hub.savings.Mortgage.Years} onChange={event => updateMortgage("Years", Number(event.target.value))} /></label>
              <label>Current/base rate %<input type="number" min="0" step="0.01" value={hub.savings.Mortgage.BaseRate} onChange={event => updateMortgage("BaseRate", Number(event.target.value))} /></label>
              <label>Comparison rate %<input type="number" min="0" step="0.01" value={hub.savings.Mortgage.OfferRate} onChange={event => updateMortgage("OfferRate", Number(event.target.value))} /></label>
              <label>Term months<input type="number" min="1" max="120" value={hub.savings.Mortgage.TermMonths} onChange={event => updateMortgage("TermMonths", Number(event.target.value))} /></label>
              <label>Switching fees<input type="number" min="0" step="10" value={hub.savings.Mortgage.Fees} onChange={event => updateMortgage("Fees", Number(event.target.value))} /></label>
              <label className="span-two">Renewal date<input type="date" value={hub.savings.Mortgage.Renewal.slice(0, 10)} onChange={event => updateMortgage("Renewal", new Date(`${event.target.value}T12:00:00`).toISOString())} /></label>
            </div>
          </form>

          <div className="surface">
            <div className="section-heading"><span className="eyebrow">Comparison</span><h2>Entered scenarios</h2></div>
            <div className="mortgage-comparison">
              <article><small>Base payment</small><strong>{currency.format(currentMortgage.payment)}</strong><span>/month</span></article>
              <article><small>Comparison payment</small><strong>{currency.format(offerMortgage.payment)}</strong><span>/month</span></article>
              <article><small>Base term interest</small><strong>{currency.format(currentMortgage.interest)}</strong><span>estimate</span></article>
              <article><small>Comparison term interest</small><strong>{currency.format(offerMortgage.interest)}</strong><span>estimate</span></article>
            </div>
            <div className="savings-callout">
              <TrendingDown size={21} />
              <div><small>Estimated net interest difference</small><strong>{currency.format(currentMortgage.interest - offerMortgage.interest - hub.savings.Mortgage.Fees)}</strong><span>after entered switching fees; not a lender quote</span></div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
