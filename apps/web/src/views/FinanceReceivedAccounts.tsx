import React, { useId } from "react";
import type { FinanceAccount, FinanceData } from "../../../worker/src/finance-model";
import type { FinanceSourceInventory as Inventory } from "../../../worker/src/finance-source-inventory-model";
import { latestBalanceObservation } from "../../../worker/src/finance-observations";
import { displayFinanceCapture } from "./FinanceCollectionNote";
import FinanceSourceInventory from "./FinanceSourceInventory";

const money = (cents: number, currency: string) => new Intl.NumberFormat("en-CA", { style: "currency", currency, currencyDisplay: "code" }).format(cents / 100);
type InventoryRead = { status: "loading" | "ready" | "unsupported" | "error"; snapshot: Inventory | null };
/** Two evidence groups, never an inferred identity crosswalk or a consolidated balance. */
export default function FinanceReceivedAccounts({ data, inventory, onOpen, historicalOpen, onHistoricalOpen }: {
    data: FinanceData | null; inventory: InventoryRead; onOpen: (id: string) => void;
    historicalOpen: boolean | null; onHistoricalOpen: (open: boolean) => void;
}) {
    const heading = useId(), sourceSection = useId();
    const accounts = data?.accounts ?? [];
    const received = accounts.flatMap(account => { const observation = data && latestBalanceObservation(data, account.id); return observation ? [{ account, observation }] : []; });
    const historical = accounts.filter(account => !received.some(row => row.account.id === account.id));
    const hasReceived = received.length > 0 || inventory.status === "ready" && Boolean(inventory.snapshot?.accounts.length);
    const historicalRow = (account: FinanceAccount) => {
        const holdings = data?.holdings.filter(h => h.accountId === account.id).sort((a, b) => b.asOf.localeCompare(a.asOf))[0];
        const cents = holdings?.totalCents ?? account.balanceCents;
        return <button key={account.id} type="button" data-investment-account={account.id} className="finance-service" onClick={() => onOpen(account.id)}>
            <span><strong>{account.name}</strong><small>{account.type} · Historical observation · {(holdings?.asOf ?? account.asOf) || "source date unknown"}</small></span>
            <strong>{cents === null ? "Missing value" : money(cents, holdings?.currency ?? account.currency)}</strong>
        </button>;
    };
    return <div className="finance-received-accounts view-stack">
        <section className="surface view-stack" aria-labelledby={heading}>
            <h2 id={heading}>Received balances</h2>
            <p>Each amount retains the date it was received, which does not indicate when the bank last updated it. The groups below stay separate. Their amounts are not combined and no match is assumed.</p>
            {inventory.status === "ready" && Boolean(inventory.snapshot?.accounts.length) && <a href={"#" + sourceSection}>View {inventory.snapshot!.accounts.length} unreconciled source accounts</a>}
            <h3>Accounts reconciled with the register</h3>
            <p className="muted">{received.length ? `${received.length} account${ received.length === 1 ? "" : "s"} with a dated balance.` : "No dated balances were received for this group. The register values are available separately."}</p>
            <div className="finance-register">{received.map(({ account, observation }) => <button key={account.id} type="button" data-investment-account={account.id} data-received-account="true" className="finance-service" onClick={() => onOpen(account.id)}>
                <span><strong>{account.name}</strong><small>Received on <time dateTime={observation.capturedAt}>{displayFinanceCapture(observation.capturedAt)}</time></small><small>{observation.sourceAsOf ? <>Bank date: <time dateTime={observation.sourceAsOf}>{observation.sourceAsOf}</time></> : "Bank date unknown"}</small><small>View received balances and history</small></span>
                <strong>{money(observation.balanceCents, observation.currency)}</strong>
            </button>)}</div>
        </section>
        <section id={sourceSection} tabIndex={-1} className="surface finance-received-source">
            <div role="status">{inventory.status === "loading" ? "Loading the inventory saved on your PC." : inventory.status === "unsupported" ? "Update the worker on your PC to view the source inventory. The existing register is still available." : inventory.status === "error" ? "Source inventory unavailable. Refresh to reload from your PC. Historical values do not substitute for source account data." : ""}</div>
            {inventory.status === "ready" && <FinanceSourceInventory snapshot={inventory.snapshot} title="Unreconciled source accounts" />}
        </section>
        {historical.length > 0 && <details className="surface finance-historical-accounts" open={historicalOpen ?? !hasReceived} onToggle={event => onHistoricalOpen(event.currentTarget.open)}>
            <summary>Register values ({historical.length})</summary>
            <p>These values retain their historical dates and are not added to the balances above. Reloading does not replace historical dates.</p>
            <div className="finance-register">{historical.map(historicalRow)}</div>
        </details>}
        <aside className="finance-observation-note"><h3>What these terms mean</h3><p>Contributions are amounts paid in. Performance is gains and losses. Net worth is assets minus debts.</p><p>Totals do not combine different sources, dates or currencies. Historical holdings and activity remain available in each register account.</p></aside>
    </div>;
}
