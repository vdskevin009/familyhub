import { useEffect, useRef, useState } from "react";
import { Sheet } from "../ui/primitives";
import InfoPopover from "../ui/InfoPopover";
import { byAmountDescending, sortedExpenseCategories } from "../finance-order";
import { categoryScope, financeUndoOptions } from "../../../worker/src/finance-category-match";
import { decisionCategoryAllowed, expenseCategories, natures, type ExpenseCategory, type FinanceAccount, type FinanceDecision, type FinanceState, type summarizeSpending } from "../../../worker/src/finance-model";

const money = (cents: number, currency: string) => new Intl.NumberFormat("fr-CA", { style: "currency", currency }).format(cents / 100);
type Summary = ReturnType<typeof summarizeSpending>;
export type InlineEntry = { id: string; nature: FinanceDecision["nature"]; category: ExpenseCategory };
export type InlineResult = { done: string[]; error?: string; stale?: boolean };

export default function CategoryPayments({ category, open, summary, state, accounts, account, currency, from, to, onClose, onEdit, onSave, onReload, onUndo }: {
    category: ExpenseCategory | null; open: boolean; summary: Summary | null; state: FinanceState | null;
    accounts: FinanceAccount[]; account: string; currency: string; from: string; to: string;
    onClose: () => void; onEdit: (id: string, queueIds: string[]) => void;
    onSave: (entries: InlineEntry[], sameName: boolean, progress: (done: string[]) => void) => Promise<InlineResult>;
    onReload: () => Promise<void>; onUndo: (id: string) => Promise<void>;
}) {
    const [search, setSearch] = useState(""), [excludedOpen, setExcludedOpen] = useState(false);
    const [selected, setSelected] = useState<string[]>([]), [drafts, setDrafts] = useState<Record<string, InlineEntry>>({});
    const [sameName, setSameName] = useState(false), [busy, setBusy] = useState(false), [stale, setStale] = useState(false);
    const [error, setError] = useState(""), [status, setStatus] = useState(""), [batchNature, setBatchNature] = useState(""), [batchCategory, setBatchCategory] = useState("");
    const content = useRef<HTMLDivElement>(null), lastRow = useRef<string | null>(null), saving = useRef(false);
    useEffect(() => { setSearch(""); setExcludedOpen(false); setSelected([]); setDrafts({}); setSameName(false); setStale(false); setError(""); setStatus(""); setBatchNature(""); setBatchCategory(""); lastRow.current = null; }, [category]);
    useEffect(() => {
        if (!open || !lastRow.current) return;
        const frame = requestAnimationFrame(() => {
            const row = [...(content.current?.querySelectorAll<HTMLButtonElement>("[data-payment-id]") ?? [])].find(el => el.dataset.paymentId === lastRow.current);
            (row ?? content.current?.querySelector<HTMLInputElement>("input[type=search]"))?.focus();
        });
        return () => cancelAnimationFrame(frame);
    }, [open]);
    const savings = category === "savings-investments", includedIds = new Set(summary?.included.map(r => r.id));
    const ordered = (summary?.rows ?? []).filter(r => r.category === category).sort(byAmountDescending);
    const all = savings ? ordered : ordered.filter(r => includedIds.has(r.id)), excluded = savings ? [] : ordered.filter(r => !includedIds.has(r.id));
    const matches = (r: Summary["rows"][number]) => r.description.toLocaleLowerCase().includes(search.toLocaleLowerCase());
    const visible = all.filter(matches), visibleExcluded = excluded.filter(matches);
    const queue = [...visible, ...(excludedOpen ? visibleExcluded : [])].map(r => r.id);
    useEffect(() => {
        const present = new Set(ordered.map(r => r.id));
        // A deliberate source-editor save can remove an undrafted selection from this list.
        // Keep failed/conflicted drafts; they still require explicit review or cancellation.
        setSelected(current => current.filter(id => present.has(id) || drafts[id]));
    }, [state?.revision, category]);
    const label = category ? expenseCategories[category] : "Catégorie";
    const entry = (id: string): InlineEntry | undefined => drafts[id] ?? (() => { const r = summary?.rows.find(r => r.id === id); return r && { id, nature: r.nature, category: r.category }; })();
    const entries = selected.map(entry).filter((r): r is InlineEntry => !!r);
    const scopeIds = new Set(entries.flatMap(e => sameName && state ? categoryScope(state, e.id, { ...e, note: state.decisions[e.id]?.note ?? "", updatedAt: "" }).affected.map(r => r.id) : [e.id]));
    const edit = (id: string, change: Partial<InlineEntry>) => {
        const prior = entry(id); if (!prior) return;
        const next = { ...prior, ...change };
        if (!decisionCategoryAllowed(next.category, next.nature)) next.category = next.nature === "investment" ? "savings-investments" : "other";
        setDrafts(current => ({ ...current, [id]: next })); setSelected(current => current.includes(id) ? current : [...current, id]); setError(""); setStatus("");
    };
    const cancel = () => { setSelected([]); setDrafts({}); setSameName(false); setBatchNature(""); setBatchCategory(""); setError(""); setStatus(""); };
    const close = () => { if (saving.current) return; if (Object.keys(drafts).length) { setError("Enregistrez les modifications ou annulez le brouillon avant de fermer."); return; } onClose(); };
    const focusSelection = (ids: string[]) => requestAnimationFrame(() => {
        const inputs = [...(content.current?.querySelectorAll<HTMLInputElement>("[data-payment-select]") ?? [])];
        (inputs.find(el => ids.includes(el.dataset.paymentSelect!)) ?? content.current?.querySelector<HTMLInputElement>("input[type=search]"))?.focus();
    });
    async function save(next: boolean) {
        if (saving.current || !entries.length || stale) return;
        saving.current = true; setBusy(true); setError(""); setStatus(`Enregistrement : 0 / ${entries.length} sélection(s)`);
        const original = [...selected], originalQueue = [...queue];
        try {
            const result = await onSave(entries, sameName, done => {
                setSelected(current => current.filter(id => !done.includes(id)));
                setDrafts(current => Object.fromEntries(Object.entries(current).filter(([id]) => !done.includes(id))));
                setStatus(`${original.filter(id => done.includes(id)).length} / ${original.length} sélection(s) enregistrée(s)`);
            });
            const done = new Set(result.done);
            setSelected(current => current.filter(id => !done.has(id)));
            setDrafts(current => Object.fromEntries(Object.entries(current).filter(([id]) => !done.has(id))));
            if (result.error) { setError(result.error); setStale(Boolean(result.stale)); focusSelection(original.filter(id => !done.has(id))); }
            else {
                setSameName(false); setBatchNature(""); setBatchCategory("");
                const last = Math.max(...original.map(id => originalQueue.indexOf(id)));
                const following = next ? originalQueue.slice(last + 1).filter(id => !done.has(id)).slice(0, original.length) : [];
                setSelected(following); setStatus(following.length ? `${original.length} sélection(s) enregistrée(s) · ${following.length} suivante(s) sélectionnée(s)` : "Enregistrement terminé.");
                focusSelection(following.length ? following : original.filter(id => !done.has(id)));
            }
        } catch (e) { setError((e as Error).message); }
        finally { saving.current = false; setBusy(false); }
    }
    const payment = (r: Summary["rows"][number], ids: string[]) => {
        const d = entry(r.id)!;
        return <div className="finance-inline-payment" key={r.id} data-inline-payment={r.id} role="group" aria-label={`${r.description}, ${r.date}, ${accounts.find(a => a.id === r.accountId)?.name}, ${money(r.outflowCents, r.currency)}`}>
            <label className="finance-payment-choice"><input type="checkbox" data-payment-select={r.id} aria-label={`Sélectionner ${r.description} du ${r.date}`} checked={selected.includes(r.id)} disabled={busy || stale} onChange={e => setSelected(current => e.target.checked ? [...current, r.id] : current.filter(id => id !== r.id))} /><span className="sr-only">Sélectionner</span></label>
            <button className="finance-service" data-payment-id={r.id} disabled={busy || !!Object.keys(drafts).length} onClick={() => { lastRow.current = r.id; onEdit(r.id, ids); }}>
                <span><strong>{r.description}</strong><small>{r.date} · {accounts.find(a => a.id === r.accountId)?.name}</small><small>{r.reviewed ? "Confirmé" : "Suggestion"} · Voir la source</small></span><strong>{money(r.outflowCents, r.currency)}</strong>
            </button>
            <div className="finance-payment-edit">
                <label>Nature<select aria-label="Nature" disabled={busy || stale} value={d.nature} onChange={e => edit(r.id, { nature: e.target.value as FinanceDecision["nature"] })}>{Object.entries(natures).filter(([key]) => !(key === "expense" && r.outflowCents < 0) && !(key === "refund" && r.outflowCents >= 0)).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
                <label>Catégorie<select aria-label="Catégorie" disabled={busy || stale} value={d.category} onChange={e => edit(r.id, { category: e.target.value as ExpenseCategory })}>{sortedExpenseCategories.filter(([key]) => decisionCategoryAllowed(key, d.nature)).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
            </div>
        </div>;
    };
    const undo = state ? financeUndoOptions(state).slice(0, 5) : [];
    return <Sheet open={open} onClose={close} title={"Paiements · " + label} wide footer={selected.length > 0 ? <div className="finance-inline-actions"><button type="button" className="button" disabled={busy || stale} onClick={() => void save(false)}>Enregistrer</button><button type="button" className="button secondary" disabled={busy || stale} onClick={() => void save(true)}>Enregistrer et suivante</button></div> : undefined}>
        <div className="view-stack finance-category-payments" ref={content}>
            <label>Rechercher dans cette catégorie<input type="search" value={search} disabled={busy} onChange={e => setSearch(e.target.value)} /></label>
            <div className="compact-heading"><small>{visible.length} opération(s) · Montant décroissant</small>{!savings && <strong>{money(summary?.categories.find(c => c.key === category)?.cents ?? 0, currency)}</strong>}<InfoPopover title="Période et édition"><p>{from} au {to} · {account ? accounts.find(a => a.id === account)?.name : "Tous les comptes"} · {currency}</p><p>{savings ? "Épargne et placements hors dépenses; entrées et sorties restent séparées." : "Dépenses nettes de remboursements. Les transferts et paiements de carte sont conservés sous Hors dépenses."}</p><p>Les sélections sont enregistrées dans l'ordre affiché, une opération protégée par révision à la fois. Si une erreur interrompt le lot, les lignes déjà enregistrées restent confirmées; les autres restent sélectionnées. L'action du même nom applique la catégorie à l'historique compatible; elle conserve les autres natures et notes.</p><p>Les notes et l'audit historiques sont conservés. Les filtres restent disponibles en fermant cette liste.</p></InfoPopover></div>
            {savings && <div className="finance-totals"><div><small>Sorties classées</small><strong>{money(summary?.savings.outgoingCents ?? 0, currency)}</strong></div><div><small>Entrées classées</small><strong>{money(summary?.savings.incomingCents ?? 0, currency)}</strong></div></div>}
            <fieldset className="finance-inline-toolbar" disabled={busy || stale}>
                <legend>{selected.length} sélection(s){selected.some(id => !queue.includes(id)) ? ` · ${selected.filter(id => !queue.includes(id)).length} hors liste` : ""}</legend>
                <label className="finance-select-visible"><input type="checkbox" checked={queue.length > 0 && queue.every(id => selected.includes(id))} onChange={e => setSelected(e.target.checked ? [...new Set([...selected, ...queue])] : selected.filter(id => !queue.includes(id)))} />Sélectionner les lignes affichées</label>
                {selected.length > 0 && <><div className="finance-payment-edit">
                    <label>Nature du lot<select value={batchNature} onChange={e => { setBatchNature(e.target.value); if (e.target.value) selected.forEach(id => edit(id, { nature: e.target.value as FinanceDecision["nature"] })); }}><option value="">Conserver les natures</option>{Object.entries(natures).filter(([key]) => selected.every(id => { const row = summary?.rows.find(r => r.id === id); return row && !(key === "expense" && row.outflowCents < 0) && !(key === "refund" && row.outflowCents >= 0); })).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
                    <label>Catégorie du lot<select value={batchCategory} onChange={e => { setBatchCategory(e.target.value); if (e.target.value) selected.forEach(id => edit(id, { category: e.target.value as ExpenseCategory })); }}><option value="">Conserver les catégories</option>{sortedExpenseCategories.filter(([key]) => entries.every(e => decisionCategoryAllowed(key, e.nature))).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
                </div><label className="finance-select-visible"><input type="checkbox" checked={sameName} onChange={e => setSameName(e.target.checked)} />Appliquer la catégorie à tous du même nom ({scopeIds.size}, tout l’historique)</label>
                </>}
            </fieldset>
            {(selected.length > 0 || Object.keys(drafts).length > 0) && <button className="button secondary" disabled={busy} onClick={cancel}>Annuler le brouillon</button>}
            <p role="status" className="finance-inline-status">{status}</p>
            {error && <p role="alert">{error}</p>}
            {stale && <button className="button secondary" disabled={busy} onClick={async () => { setBusy(true); try { await onReload(); setStale(false); setError(""); setStatus("Données actualisées. Revoyez la sélection avant d'enregistrer."); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>Actualiser les décisions</button>}
            <div className="finance-register" aria-label={savings ? "Opérations d'épargne et de placement" : "Opérations de dépenses"}>{visible.map(r => payment(r, visible.map(r => r.id)))}</div>
            {!visible.length && <p>{all.length ? "Aucune opération ne correspond à cette recherche." : "Aucune opération dans cette catégorie pour la période sélectionnée."}</p>}
            {excluded.length > 0 && <details className="finance-excluded-payments" open={excludedOpen} onToggle={e => setExcludedOpen(e.currentTarget.open)}><summary>Hors dépenses · {visibleExcluded.length} opération(s){search ? ` sur ${excluded.length}` : ""}</summary><div className="finance-register" aria-label="Opérations hors dépenses">{visibleExcluded.map(r => payment(r, visibleExcluded.map(r => r.id)))}</div></details>}
            {undo.length > 0 && <details className="finance-inline-undo"><summary>Historique et annulation</summary>{undo.map(op => <div className="finance-inline-undo-row" key={op.id}><span>{op.at.slice(0, 19).replace("T", " ")} · {op.count} décision(s)</span><button className="button secondary" disabled={busy || stale || !op.canUndo || !!Object.keys(drafts).length} onClick={async () => { setBusy(true); try { await onUndo(op.id); setStatus("Décisions précédentes restaurées."); } catch (e) { setError((e as Error).message); if ((e as Error & { status?: number }).status === 409) setStale(true); } finally { setBusy(false); } }}>Annuler {op.count} décision(s)</button></div>)}</details>}
            <button className="button secondary" disabled={busy} onClick={close}>Fermer la catégorie</button>
        </div>
    </Sheet>;
}
