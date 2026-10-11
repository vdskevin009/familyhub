import { useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react";
import { CompactDialog } from "../ui/InfoPopover";
import { periodMode, rangeLabel, shiftPeriod, type DateRange } from "../finance-periods";
import PeriodNavigator from "./PeriodNavigator";
import type { FinanceState } from "../../../worker/src/finance-model";

export default function FinanceScope({ data, range, onPeriod, account, currency, onAccount, onCurrency }: {
    data: NonNullable<FinanceState["data"]>; range?: DateRange; onPeriod: (range: DateRange) => void;
    account: string; currency: string; onAccount: (id: string) => void; onCurrency: (currency: string) => void;
}) {
    const [open, setOpen] = useState(false), trigger = useRef<HTMLButtonElement>(null), id = useId();
    const mode = range ? periodMode(range) : null;
    const previous = range && shiftPeriod(range, -1), next = range && shiftPeriod(range, 1);
    return <div className="finance-scope">
        <div className="finance-scope-copy">
            {range && <div className="compact-period">
                {mode !== "custom" && <button type="button" className="icon-button" aria-label={mode === "year" ? "Année précédente" : "Mois précédent"} disabled={previous!.to < data.scope.from} onClick={() => onPeriod(previous!)}><ChevronLeft size={18} aria-hidden="true" /></button>}
                <strong aria-live="polite">{rangeLabel(range)}</strong>
                {mode !== "custom" && <button type="button" className="icon-button" aria-label={mode === "year" ? "Année suivante" : "Mois suivant"} disabled={next!.from > data.scope.to} onClick={() => onPeriod(next!)}><ChevronRight size={18} aria-hidden="true" /></button>}
            </div>}
            <small>{data.accounts.find(a => a.id === account)?.name ?? "Tous les comptes"} · {currency}</small>
        </div>
        <button type="button" className="button secondary compact-filter-button" ref={trigger} aria-haspopup="dialog" aria-controls={id} aria-expanded={open} onClick={() => setOpen(true)}><SlidersHorizontal size={17} aria-hidden="true" />Filtres{account && <span className="count-badge">1</span>}</button>
        <CompactDialog id={id} title="Filtres des finances" open={open} onClose={() => setOpen(false)} anchor={trigger}>
            {range && <PeriodNavigator range={range} scope={data.scope} onChange={onPeriod} />}
            <label>Compte<select aria-label="Compte" value={account} onChange={e => onAccount(e.target.value)}><option value="">Tous les comptes</option>{data.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
            <label>Devise<select aria-label="Devise" value={currency} onChange={e => onCurrency(e.target.value)}>{[...new Set(["CAD", ...data.accounts.map(a => a.currency)])].map(c => <option key={c}>{c}</option>)}</select></label>
            <button className="button" type="button" onClick={() => setOpen(false)}>Voir les résultats</button>
        </CompactDialog>
    </div>;
}
