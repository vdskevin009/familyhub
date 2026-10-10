import { useEffect, useRef, useState } from "react";
import { Sheet } from "../ui/primitives";
import { expenseCategories, natures, type ExpenseCategory, type FinanceAccount, type summarizeSpending } from "../../../worker/src/finance-model";

const money = (cents: number, currency: string) => new Intl.NumberFormat("fr-CA", { style: "currency", currency }).format(cents / 100);
type Summary = ReturnType<typeof summarizeSpending>;

export default function CategoryPayments({ category, open, summary, accounts, account, currency, from, to, onClose, onEdit }: {
    category: ExpenseCategory | null; open: boolean; summary: Summary | null;
    accounts: FinanceAccount[]; account: string; currency: string; from: string; to: string;
    onClose: () => void; onEdit: (id: string) => void;
}) {
    const [search, setSearch] = useState("");
    const content = useRef<HTMLDivElement>(null), lastRow = useRef<string | null>(null);
    useEffect(() => { setSearch(""); lastRow.current = null; }, [category]);
    useEffect(() => {
        if (!open || !lastRow.current) return;
        const frame = requestAnimationFrame(() => {
            const row = [...(content.current?.querySelectorAll<HTMLButtonElement>("[data-payment-id]") ?? [])].find(el => el.dataset.paymentId === lastRow.current);
            (row ?? content.current?.querySelector<HTMLInputElement>("input"))?.focus();
        });
        return () => cancelAnimationFrame(frame);
    }, [open]);
    const all = (summary?.rows ?? []).filter(r => r.category === category)
        .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    const visible = all.filter(r => r.description.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
    const label = category ? expenseCategories[category] : "Catégorie";
    const savings = category === "savings-investments";
    return <Sheet open={open} onClose={onClose} title={"Paiements · " + label} wide>
        <div className="view-stack finance-category-payments" ref={content}>
            <p>{from} — {to} · {account ? accounts.find(a => a.id === account)?.name : "Tous les comptes"} · {currency}</p>
            {savings ? <div className="finance-totals">
                <div><small>Sorties classées</small><strong>{money(summary?.savings.outgoingCents ?? 0, currency)}</strong></div>
                <div><small>Entrées classées</small><strong>{money(summary?.savings.incomingCents ?? 0, currency)}</strong></div>
            </div> : <p><strong>{money(summary?.categories.find(c => c.key === category)?.cents ?? 0, currency)}</strong> de dépenses, remboursements déduits.</p>}
            <p className="muted">Toutes les opérations de cette catégorie dans la période, confirmées ou suggérées. Les transferts et placements restent hors dépenses; leurs entrées et sorties ne sont pas additionnées. Vos filtres de départ restent disponibles en fermant cette liste.</p>
            <label>Rechercher dans cette catégorie<input type="search" value={search} onChange={e => setSearch(e.target.value)} /></label>
            <p aria-live="polite">{visible.length} opération(s){search ? " sur " + all.length : ""}</p>
            <div className="finance-register">{visible.map(r => <button className="finance-service" key={r.id} data-payment-id={r.id} onClick={() => { lastRow.current = r.id; onEdit(r.id); }}>
                <span><strong>{r.description}</strong><small>{r.date} · {accounts.find(a => a.id === r.accountId)?.name}</small>
                    <small>{natures[r.nature]} · {r.reviewed ? "Confirmé" : "Suggestion"}</small>
                    <small className="finance-edit-label">Modifier la catégorie</small></span>
                <strong>{money(r.outflowCents, r.currency)}</strong>
            </button>)}</div>
            {!visible.length && <p>{all.length ? "Aucune opération ne correspond à cette recherche." : "Aucune opération dans cette catégorie pour la période sélectionnée."}</p>}
            <button className="button secondary" onClick={onClose}>Fermer la catégorie</button>
        </div>
    </Sheet>;
}
