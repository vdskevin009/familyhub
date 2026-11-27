import React, { useId } from "react";
import { sourceInventoryIsStale, type FinanceSourceInventory as Inventory, type SourceAvailability, type SourceDatedMoney, type SourceMoney } from "../../../worker/src/finance-source-inventory-model";

const kinds = { depository: "Bank account", credit: "Credit", investment: "Investment", loan: "Loan", other: "Other account", unknown: "Type not provided" };
const frequencies = { weekly: "Weekly", biweekly: "Every two weeks", semimonthly: "Twice a month", monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly", irregular: "Irregular", unknown: "Frequency not provided" };
const money = (value: SourceMoney) => new Intl.NumberFormat("en-CA", { style: "currency", currency: value.currency, currencyDisplay: "code" }).format(value.amountCents / 100);
function DateValue({ value }: { value: string }) {
  const dateOnly = value.length === 10;
  const formatted = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit", ...(dateOnly ? {} : { hour: "2-digit", minute: "2-digit", second: "2-digit" }) }).format(new Date(dateOnly ? value + "T12:00:00.000Z" : value));
  return <time dateTime={value}>{formatted}{dateOnly ? "" : " UTC"}</time>;
}
function MoneyEvidence({ title, value, collectedAt }: { title: string; value: SourceDatedMoney | null; collectedAt: string }) {
  return <div className="finance-source-money"><dt>{title}</dt><dd>
    <strong>{value === null ? "Amount not provided" : money(value)}</strong>
    <small>Retrieved on <DateValue value={collectedAt} /></small>
    {value !== null && <small>{value.sourceAsOf === null ? "Bank date not provided" : <>Bank date: <DateValue value={value.sourceAsOf} /></>}</small>}
  </dd></div>;
}
export function SourceAvailabilityNotice({ label, value }: { label: string; value: SourceAvailability }) {
  return <li><strong>{label}: </strong>{value.status === "unavailable" ? "unavailable, coverage not established" : value.status === "partial" ? "partial coverage" : "coverage supplied for the collected scope"}
    {value.observedCount === 0 && value.coverage === "unknown" ? ". An empty result does not establish that no data exists." : value.observedCount === null ? ". Number of rows unknown." : ` (${value.observedCount} row${ value.observedCount === 1 ? "" : "s"} returned).`}</li>;
}

/** Read-only view. Import finance-source-inventory.css in the integrating screen.
 * Snapshot must be validated at the API boundary. No ledger or navigation dependency.
 */
export default function FinanceSourceInventory({ snapshot, now = new Date(), title = "Other source data" }: { snapshot: Inventory | null; now?: Date; title?: string }) {
  const heading = useId();
  if (snapshot === null) return <section className="finance-source-inventory" aria-labelledby={heading}><h2 id={heading}>{title}</h2><p>Inventory unavailable. No balances or absence of accounts can be inferred.</p></section>;
  const stale = sourceInventoryIsStale(snapshot, now);
  return <section className="finance-source-inventory" aria-labelledby={heading}>
    <header><h2 id={heading}>{title}</h2><p>Collected on <DateValue value={snapshot.collectedAt} />{stale && <strong> · Collection older than 24 hours</strong>}</p></header>
    <p>{snapshot.accounts.length} source account{snapshot.accounts.length === 1 ? "" : "s"}. These accounts are not matched to the existing register. Amounts remain separate from spending, investment and net worth totals.</p>
    <p className="finance-source-note">The collection date shows when the amount was retrieved, not when the bank last updated it.</p>
    {snapshot.accounts.length === 0 ? <p>No accounts were returned in this inventory. This does not establish that there are no linked accounts.</p> : <ul className="finance-source-accounts">{snapshot.accounts.map(account => <li key={account.sourceKey}>
      <article><header><h3>{account.name}</h3><p>{account.institution ?? "Institution not provided"} · {kinds[account.kind]}</p><strong className="finance-source-status">Unreconciled</strong></header>
        <dl><MoneyEvidence title="Retrieved balance" value={account.balance} collectedAt={snapshot.collectedAt} /></dl>
        {account.credit !== null && <details><summary>Credit statement and payment due date</summary><dl>
          <MoneyEvidence title="Statement balance" value={account.credit.statementBalance} collectedAt={snapshot.collectedAt} />
          <MoneyEvidence title="Reported minimum payment" value={account.credit.minimumPayment} collectedAt={snapshot.collectedAt} />
          <div><dt>Reported payment due date</dt><dd>{account.credit.paymentDueOn === null ? "Date not provided" : <DateValue value={account.credit.paymentDueOn} />}</dd></div>
        </dl><p>These fields do not confirm that a payment was made or missed. Each amount retains its own bank date.</p></details>}
      </article>
    </li>)}</ul>}
    <details className="finance-source-coverage"><summary>Data availability</summary><ul>
      <SourceAvailabilityNotice label="Accounts in this inventory" value={snapshot.availability.accounts} />
      <SourceAvailabilityNotice label="Investment holdings" value={snapshot.availability.holdings} />
      <SourceAvailabilityNotice label="Investment activity" value={snapshot.availability.activity} />
      <SourceAvailabilityNotice label="Credit and due dates" value={snapshot.availability.liabilities} />
      <SourceAvailabilityNotice label="Recurring forecasts" value={snapshot.availability.recurring} />
      <li><strong>Budgets and goals: </strong>not supplied by this source. Data saved elsewhere is unchanged.</li>
    </ul></details>
    <details className="finance-source-forecasts"><summary>Recurring forecasts ({snapshot.predictions.length})</summary>
      <p>Forecasts are from the source only. They are not posted spending or confirmed bills and do not contribute to totals.</p>
      {snapshot.predictions.length === 0 ? <p>No forecasts were returned. See data availability above for coverage.</p> : <ul>{snapshot.predictions.map(prediction => <li key={prediction.sourceKey}>
        <h3>{prediction.name}</h3><p><strong>Forecast</strong> · {prediction.flow === "outflow" ? "Expected outflow" : prediction.flow === "inflow" ? "Expected inflow" : "Flow direction not provided"} · {frequencies[prediction.frequency]}</p>
        <p>{prediction.amount === null ? "Amount not provided" : money(prediction.amount)} · {prediction.predictedOn === null ? "Expected date not provided" : <>Expected date: <DateValue value={prediction.predictedOn} /></>}</p>
        {prediction.accountSourceKey !== null && <p>Source account: {snapshot.accounts.find(account => account.sourceKey === prediction.accountSourceKey)?.name}</p>}
        {prediction.predictedOn !== null && prediction.predictedOn < snapshot.collectedAt.slice(0, 10) && <p>The expected date had already passed at collection time. The transaction has not been verified.</p>}
      </li>)}</ul>}
    </details>
  </section>;
}
