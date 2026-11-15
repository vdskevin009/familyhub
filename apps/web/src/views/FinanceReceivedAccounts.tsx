import React, { useId } from "react";
import type { FinanceAccount, FinanceData } from "../../../worker/src/finance-model";
import type { FinanceSourceInventory as Inventory } from "../../../worker/src/finance-source-inventory-model";
import { latestBalanceObservation } from "../../../worker/src/finance-observations";
import { displayFinanceCapture } from "./FinanceCollectionNote";
import FinanceSourceInventory from "./FinanceSourceInventory";

const money = (cents: number, currency: string) => new Intl.NumberFormat("fr-CA", { style: "currency", currency, currencyDisplay: "code" }).format(cents / 100);
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
            <span><strong>{account.name}</strong><small>{account.type} · Observation historique · {(holdings?.asOf ?? account.asOf) || "date source inconnue"}</small></span>
            <strong>{cents === null ? "Valeur manquante" : money(cents, holdings?.currency ?? account.currency)}</strong>
        </button>;
    };
    return <div className="finance-received-accounts view-stack">
        <section className="surface view-stack" aria-labelledby={heading}>
            <h2 id={heading}>Soldes reçus</h2>
            <p>Chaque montant garde sa date de réception réelle. Elle ne prouve pas la date de mise à jour bancaire. Les groupes ci-dessous restent séparés, sans total commun ni correspondance supposée.</p>
            {inventory.status === "ready" && Boolean(inventory.snapshot?.accounts.length) && <a href={"#" + sourceSection}>Voir les {inventory.snapshot!.accounts.length} comptes source non rapprochés</a>}
            <h3>Comptes rapprochés du registre</h3>
            <p className="muted">{received.length ? `${received.length} compte${received.length === 1 ? "" : "s"} avec un solde reçu daté.` : "Aucun solde reçu daté disponible dans ce groupe. Les valeurs du registre restent accessibles séparément."}</p>
            <div className="finance-register">{received.map(({ account, observation }) => <button key={account.id} type="button" data-investment-account={account.id} data-received-account="true" className="finance-service" onClick={() => onOpen(account.id)}>
                <span><strong>{account.name}</strong><small>Reçu le <time dateTime={observation.capturedAt}>{displayFinanceCapture(observation.capturedAt)}</time></small><small>{observation.sourceAsOf ? <>Date bancaire : <time dateTime={observation.sourceAsOf}>{observation.sourceAsOf}</time></> : "Date bancaire inconnue"}</small><small>Voir les réceptions et l'historique</small></span>
                <strong>{money(observation.balanceCents, observation.currency)}</strong>
            </button>)}</div>
        </section>
        <section id={sourceSection} tabIndex={-1} className="surface finance-received-source">
            <div role="status">{inventory.status === "loading" ? "Chargement de l'inventaire enregistré sur le PC." : inventory.status === "unsupported" ? "L'inventaire source nécessite une mise à jour du worker PC. Le registre existant reste disponible." : inventory.status === "error" ? "Inventaire source indisponible. Actualisez pour relire le PC; aucune valeur historique ne remplace les comptes source." : ""}</div>
            {inventory.status === "ready" && <FinanceSourceInventory snapshot={inventory.snapshot} title="Comptes source non rapprochés" />}
        </section>
        {historical.length > 0 && <details className="surface finance-historical-accounts" open={historicalOpen ?? !hasReceived} onToggle={event => onHistoricalOpen(event.currentTarget.open)}>
            <summary>Valeurs du registre ({historical.length})</summary>
            <p>Ces valeurs conservent leurs dates historiques. Elles ne sont pas ajoutées aux soldes reçus ci-dessus. Aucune ancienne date n'est remplacée par une date de chargement.</p>
            <div className="finance-register">{historical.map(historicalRow)}</div>
        </details>}
        <aside className="finance-observation-note"><h3>À ne pas confondre</h3><p>Cotisations : montants versés. Performance : gains et pertes. Patrimoine : actifs moins dettes.</p><p>Aucun total consolidé entre sources, dates ou devises différentes. Les positions et activités historiques restent accessibles dans chaque compte du registre.</p></aside>
    </div>;
}
