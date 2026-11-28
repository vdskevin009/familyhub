import { displayFinanceError } from "../finance-error-copy";
import { useEffect, useRef, useState } from "react";
import { useFinanceDialogHistory } from "../use-finance-dialog-history";
import { Sheet } from "../ui/primitives";
import InfoPopover from "../ui/InfoPopover";
import { rangeLabel } from "../finance-periods";
import { byAmountDescending, sortedExpenseCategories } from "../finance-order";
import { categoryScope, financeUndoOptions } from "../../../worker/src/finance-category-match";
import { decisionCategoryAllowed, expenseCategories, natures, type ExpenseCategory, type FinanceAccount, type FinanceDecision, type FinanceState, type summarizeSpending } from "../../../worker/src/finance-model";

const money = (cents: number, currency: string) => new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100);
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
    const [editMode,setEditMode] = useState(false);
    useEffect(()=>setEditMode(false),[category]);
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
    const label = category ? expenseCategories[category] : "Category";
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
    const close = () => { if (saving.current) return false; if (Object.keys(drafts).length) { setError("Save the changes or discard the draft before closing."); return false; } onClose(); return true; };
    useFinanceDialogHistory(open, close);
    const focusSelection = (ids: string[]) => requestAnimationFrame(() => {
        const inputs = [...(content.current?.querySelectorAll<HTMLInputElement>("[data-payment-select]") ?? [])];
        (inputs.find(el => ids.includes(el.dataset.paymentSelect!)) ?? content.current?.querySelector<HTMLInputElement>("input[type=search]"))?.focus();
    });
    async function save(next: boolean) {
        if (saving.current || !entries.length || stale) return;
        saving.current = true; setBusy(true); setError(""); setStatus(`Saving: 0 of ${entries.length} selection(s)`);
        const original = [...selected], originalQueue = [...queue];
        try {
            const result = await onSave(entries, sameName, done => {
                setSelected(current => current.filter(id => !done.includes(id)));
                setDrafts(current => Object.fromEntries(Object.entries(current).filter(([id]) => !done.includes(id))));
                setStatus(`${original.filter(id => done.includes(id)).length} / ${original.length} selection(s) saved`);
            });
            const done = new Set(result.done);
            setSelected(current => current.filter(id => !done.has(id)));
            setDrafts(current => Object.fromEntries(Object.entries(current).filter(([id]) => !done.has(id))));
            if (result.error) { setError(result.error); setStale(Boolean(result.stale)); focusSelection(original.filter(id => !done.has(id))); }
            else {
                setSameName(false); setBatchNature(""); setBatchCategory("");
                const last = Math.max(...original.map(id => originalQueue.indexOf(id)));
                const following = next ? originalQueue.slice(last + 1).filter(id => !done.has(id)).slice(0, original.length) : [];
                setSelected(following); setStatus(following.length ? `${original.length} selection(s) saved · ${following.length} next transaction(s) selected` : "Save complete.");
                focusSelection(following.length ? following : original.filter(id => !done.has(id)));
            }
        } catch (e) { setError(displayFinanceError((e as Error).message)); }
        finally { saving.current = false; setBusy(false); }
    }
    const payment = (r: Summary["rows"][number], ids: string[]) => {
        const d = entry(r.id)!;
        return <div className="finance-inline-payment" key={r.id} data-inline-payment={r.id} role="group" aria-label={`${r.description}, ${r.date}, ${accounts.find(a => a.id === r.accountId)?.name}, ${money(r.outflowCents, r.currency)}`}>
            <label className="finance-payment-choice"><input type="checkbox" data-payment-select={r.id} aria-label={`Select ${r.description} from ${r.date}`} checked={selected.includes(r.id)} disabled={busy || stale} onChange={e => setSelected(current => e.target.checked ? [...current, r.id] : current.filter(id => id !== r.id))} /><span className="sr-only">Select</span></label>
            <button className="finance-service" data-payment-id={r.id} disabled={busy || !!Object.keys(drafts).length} onClick={() => { lastRow.current = r.id; onEdit(r.id, ids); }}>
                <span><strong>{r.description}</strong><small>{r.date} · {accounts.find(a => a.id === r.accountId)?.name}</small><small>{r.reviewed ? "Confirmed" : "Suggestion"} · View source</small></span><strong>{money(r.outflowCents, r.currency)}</strong>
            </button>
            <div className="finance-payment-edit">
                <label>Transaction type<select aria-label="Transaction type" disabled={busy || stale} value={d.nature} onChange={e => edit(r.id, { nature: e.target.value as FinanceDecision["nature"] })}>{Object.entries(natures).filter(([key]) => !(key === "expense" && r.outflowCents < 0) && !(key === "refund" && r.outflowCents >= 0)).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
                <label>Category<select aria-label="Category" disabled={busy || stale} value={d.category} onChange={e => edit(r.id, { category: e.target.value as ExpenseCategory })}>{sortedExpenseCategories.filter(([key]) => decisionCategoryAllowed(key, d.nature)).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
            </div>
        </div>;
    };
    const undo = state ? financeUndoOptions(state).slice(0, 5) : [];
    return <Sheet open={open} onClose={close} title={"Payments · " + label} wide footer={selected.length > 0 ? <div className="finance-inline-actions"><button type="button" className="button" disabled={busy || stale} onClick={() => void save(false)}>Save</button><button type="button" className="button secondary" disabled={busy || stale} onClick={() => void save(true)}>Save and next</button></div> : undefined}>
        <div className="view-stack finance-category-payments" data-editing={editMode} ref={content}>
            <div className="finance-category-overview"><p>{rangeLabel({from,to})} · {account ? accounts.find(a=>a.id===account)?.name : "All accounts"}</p>{!savings && <strong>{all.length ? money(all.reduce((sum,r)=>sum+r.outflowCents,0),currency) : "Not established"}</strong>}</div>
            <label>Search this category<input type="search" value={search} disabled={busy} onChange={e => setSearch(e.target.value)} /></label>
            <div className="compact-heading"><small>{visible.length} transaction(s) · Amount, highest first</small>{!savings && <strong>{money(summary?.categories.find(c => c.key === category)?.cents ?? 0, currency)}</strong>}<InfoPopover title="Period and editing"><p>{from} to {to} · {account ? accounts.find(a => a.id === account)?.name : "All accounts"} · {currency}</p><p>{savings ? "Savings and investments are excluded from spending. Inflows and outflows stay separate." : "Spending is net of refunds. Transfers and card payments are shown under Excluded from spending."}</p><p>Selections are saved in the order shown, one revision-checked transaction at a time. If an error interrupts the batch, saved rows stay confirmed and the others stay selected. Applying to the same name updates the category on compatible historical transactions without changing their types or notes.</p><p>Historical notes and the audit trail are retained. The filters remain available when you close this list.</p></InfoPopover></div>
            {savings && <div className="finance-totals"><div><small>Categorized outflows</small><strong>{money(summary?.savings.outgoingCents ?? 0, currency)}</strong></div><div><small>Categorized inflows</small><strong>{money(summary?.savings.incomingCents ?? 0, currency)}</strong></div></div>}
            <fieldset className="finance-inline-toolbar" disabled={busy || stale}>
                <legend>{selected.length} selection(s){selected.some(id => !queue.includes(id)) ? ` · ${selected.filter(id => !queue.includes(id)).length} outside the list` : ""}</legend>
                <label className="finance-select-visible"><input type="checkbox" checked={queue.length > 0 && queue.every(id => selected.includes(id))} onChange={e => setSelected(e.target.checked ? [...new Set([...selected, ...queue])] : selected.filter(id => !queue.includes(id)))} />Select shown transactions</label>
                {selected.length > 0 && <><div className="finance-payment-edit">
                    <label>Batch transaction type<select value={batchNature} onChange={e => { setBatchNature(e.target.value); if (e.target.value) selected.forEach(id => edit(id, { nature: e.target.value as FinanceDecision["nature"] })); }}><option value="">Keep transaction types</option>{Object.entries(natures).filter(([key]) => selected.every(id => { const row = summary?.rows.find(r => r.id === id); return row && !(key === "expense" && row.outflowCents < 0) && !(key === "refund" && row.outflowCents >= 0); })).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
                    <label>Batch category<select value={batchCategory} onChange={e => { setBatchCategory(e.target.value); if (e.target.value) selected.forEach(id => edit(id, { category: e.target.value as ExpenseCategory })); }}><option value="">Keep categories</option>{sortedExpenseCategories.filter(([key]) => entries.every(e => decisionCategoryAllowed(key, e.nature))).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
                </div><label className="finance-select-visible"><input type="checkbox" checked={sameName} onChange={e => setSameName(e.target.checked)} />Apply the category to all matching names ({scopeIds.size}, all history)</label>
                </>}
            </fieldset>
            {(selected.length > 0 || Object.keys(drafts).length > 0) && <button className="button secondary" disabled={busy} onClick={cancel}>Discard draft</button>}
            <p role="status" className="finance-inline-status">{status}</p>
            {error && <p role="alert">{error}</p>}
            {stale && <button className="button secondary" disabled={busy} onClick={async () => { setBusy(true); try { await onReload(); setStale(false); setError(""); setStatus("Data refreshed. Review the selection before saving."); } catch (e) { setError(displayFinanceError((e as Error).message)); } finally { setBusy(false); } }}>Refresh decisions</button>}
            <div className="finance-register" aria-label={savings ? "Savings and investment transactions" : "Spending transactions"}>{visible.map(r => payment(r, visible.map(r => r.id)))}</div>
            {!visible.length && <p>{all.length ? "No transactions match this search." : "No transactions in this category for the selected period."}</p>}
            {excluded.length > 0 && <details className="finance-excluded-payments" open={excludedOpen} onToggle={e => setExcludedOpen(e.currentTarget.open)}><summary>Excluded from spending · {visibleExcluded.length} transaction(s){search ? ` of ${excluded.length}` : ""}</summary><div className="finance-register" aria-label="Transactions excluded from spending">{visibleExcluded.map(r => payment(r, visibleExcluded.map(r => r.id)))}</div></details>}
            {undo.length > 0 && <details className="finance-inline-undo"><summary>History and undo</summary>{undo.map(op => <div className="finance-inline-undo-row" key={op.id}><span>{op.at.slice(0, 19).replace("T", " ")} · {op.count} decision(s)</span><button className="button secondary" disabled={busy || stale || !op.canUndo || !!Object.keys(drafts).length} onClick={async () => { setBusy(true); try { await onUndo(op.id); setStatus("Previous decisions restored."); } catch (e) { setError(displayFinanceError((e as Error).message)); if ((e as Error & { status?: number }).status === 409) setStale(true); } finally { setBusy(false); } }}>Undo {op.count} decision(s)</button></div>)}</details>}
            <button type="button" className="button secondary" aria-pressed={editMode} disabled={busy || !!Object.keys(drafts).length} onClick={()=>setEditMode(!editMode)}>{editMode ? "Finish editing" : "Edit categories"}</button>
            <button className="button secondary" disabled={busy} onClick={close}>Close category</button>
        </div>
    </Sheet>;
}
