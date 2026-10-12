import { useEffect, useMemo, useRef, useState } from "react";
import CategoryPayments, { type InlineEntry, type InlineResult } from "./CategoryPayments";
import { byAmountDescending, sortedExpenseCategories } from "../finance-order";
import FinanceTrends from "./FinanceTrends";
import { localToday, spendingTrend } from "../finance-trends";
import { RefreshCw, Upload } from "lucide-react";
import type { HubState } from "../state";
import type { AppView } from "../types";
import { PageHeader, Notice, Sheet } from "../ui/primitives";
import { fetchFinances, importFinances, saveFinanceChange } from "../worker";
import { applyFinanceDelta } from "../finance-edits";
import { categoryScope, financeUndoOptions } from "../../../worker/src/finance-category-match";
import {
    expenseCategories,
    decisionCategoryAllowed,
    natures,
    summarizeSpending,
    classifiedRows,
    investmentCashFlows,
    recurringObservations,
    type ExpenseCategory,
    type Nature,
    type Evidence,
    type FinanceState,
    type FinanceDecision,
} from "../../../worker/src/finance-model";
import { benchmarkMeta, benchmarkProfiles } from "../finance-benchmarks";
import { calendarPeriod, defaultPeriod } from "../finance-periods";
import PeriodNavigator from "./PeriodNavigator";
import FinanceScope from "./FinanceScope";
import InfoPopover from "../ui/InfoPopover";
import "../compact-finances.css";
import "../finance-journeys.css";
const money = (cents: number, currency = "CAD") =>
    new Intl.NumberFormat("fr-CA", { style: "currency", currency }).format(
        cents / 100,
    );
const displayDate = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s)
        ? new Date(s + "T12:00:00Z").toLocaleDateString("fr-CA")
        : s;
function Sources({ sources }: { sources: Evidence[] }) {
    return (
        <details className="finance-evidence">
            <summary>Sources et traçabilité</summary>
            {sources.map((s, i) => (
                <p key={i}>
                    <strong>{s.name}</strong>
                    {s.record ? ` · ligne ${s.record}` : ""}
                    {s.page ? ` · page ${s.page}` : ""}
                    {s.detail && <span>{s.detail}</span>}
                    {s.sha256 && <code>SHA-256 : {s.sha256}</code>}
                </p>
            ))}
        </details>
    );
}
function Bars({
    values,
    onSelect,
    currency = "CAD",
    scale,
}: {
    values: { id: string; label: string; cents: number; note?: string }[];
    onSelect?: (id: string) => void;
    currency?: string;
    scale?: number;
}) {
    const max = scale ?? Math.max(1, ...values.map((v) => Math.abs(v.cents)));
    return (
        <ul className="finance-bars">
            {values.map((v) => (
                <li key={v.id}>
                    <button
                        type="button"
                        data-finance-bar={v.id}
                        disabled={!onSelect}
                        onClick={() => onSelect?.(v.id)}
                    >
                        <span className="finance-bar-label">
                            <span>
                                {v.label}
                                {v.note && <small>{v.note}</small>}
                            </span>
                            <strong>{money(v.cents, currency)}</strong>
                        </span>
                        <span className="finance-bar-track" aria-hidden="true">
                            <span
                                className={v.cents < 0 ? "negative" : ""}
                                style={{
                                    width:
                                        (Math.abs(v.cents) / max) * 100 + "%",
                                }}
                            />
                        </span>
                    </button>
                </li>
            ))}
        </ul>
    );
}
function Benchmarks({
    state,
    from,
    to,
    account,
    currency,
}: {
    state: FinanceState;
    from: string;
    to: string;
    account: string;
    currency: string;
}) {
    const [profileId, setProfile] = useState("families");
    const profile = benchmarkProfiles.find((p) => p.id === profileId)!;
    const summary = summarizeSpending(state, from, to, account);
    const complete =
        currency === "CAD" &&
        summary.months.length > 0 &&
        summary.months.every((m) => m.full) &&
        !account &&
        summary.unreviewedCount === 0 &&
        summary.reviewCount === 0;
    return (
        <section className="surface view-stack">
            <h2>Repères de dépenses</h2>
            <label>
                Population de référence
                <select
                    value={profileId}
                    onChange={(e) => setProfile(e.target.value)}
                >
                    {benchmarkProfiles.map((p) => (
                        <option key={p.id} value={p.id}>
                            {p.label}
                        </option>
                    ))}
                </select>
            </label>
            <p>
                Moyennes annuelles {benchmarkMeta.year} divisées par 12, en
                dollars de 2023. Révision du {benchmarkMeta.released}. Ce sont
                des repères descriptifs, pas des objectifs de budget.
            </p>
            <p className="muted">
                Aucun groupe exact « deux adultes et un enfant de 15 mois à
                North/West Vancouver ». {profile.geography} ·{" "}
                {profile.population}. Aucune correction d’inflation ni
                multiplication par taille de famille.
            </p>
            <div className="finance-benchmark-head">
                <span>Catégorie</span>
                <span>Référence / mois</span>
                <span>Votre période / mois</span>
            </div>
            {profile.values.map((v) => {
                const own = summary.categories.find((c) => c.key === v.key);
                const comparable =
                    complete &&
                    own &&
                    own.count > 0 &&
                    v.annual !== null &&
                    !["health", "recreation"].includes(v.key);
                return (
                    <div className="finance-benchmark-row" key={v.key}>
                        <span>{v.label}</span>
                        <strong>
                            {v.annual === null
                                ? "Indisponible (F)"
                                : money((v.annual * 100) / 12)}
                        </strong>
                        <span>
                            {comparable
                                ? money(own.cents / summary.months.length)
                                : "Comparaison indisponible"}
                        </span>
                    </div>
                );
            })}
            {!complete && (
                <p className="muted">
                    La comparaison personnelle nécessite des mois entiers dans
                    la fenêtre observée, tous les comptes et la revue des
                    opérations. Les catégories doivent correspondre aux
                    définitions de l’enquête.
                </p>
            )}
            <details>
                <summary>Définitions, limites et sources</summary>
                <div className="view-stack">
                    <p>
                        La moyenne comprend les ménages sans dépense dans la
                        catégorie. Elle n’est ni une médiane ni un coût par
                        enfant. Les groupes ne sont jamais combinés.
                    </p>
                    <p>
                        Le logement inclut énergie, résidence principale et
                        autres hébergements. Le transport inclut achats nets de
                        véhicules et voyages. Garde d’enfants et communications
                        font déjà partie des opérations du ménage; énergie et
                        eau font déjà partie du logement. Ne pas additionner ces
                        lignes.
                    </p>
                    <p>
                        L’épicerie exclut les articles non alimentaires; les
                        restaurants excluent l’alcool. Un libellé de supermarché
                        ne prouve pas le contenu du panier. Santé et loisirs
                        nécessitent des rapprochements supplémentaires
                        (remboursements, services inclus). Les lignes F sont
                        trop peu fiables pour être publiées.
                    </p>
                    <p>
                        Vos versements hypothécaires restent entiers (capital et
                        intérêts non séparés). Impôts, placements, transferts et
                        cotisations ne constituent pas la consommation courante
                        de l’enquête. Aucun ratio global n’est calculé.
                    </p>
                    <p>
                        <a href={profile.url} target="_blank" rel="noreferrer">
                            Statistique Canada · Tableau {profile.table}
                        </a>{" "}
                        ·{" "}
                        <a
                            href={benchmarkMeta.methodology}
                            target="_blank"
                            rel="noreferrer"
                        >
                            Méthodologie
                        </a>{" "}
                        ·{" "}
                        <a
                            href={benchmarkMeta.revision}
                            target="_blank"
                            rel="noreferrer"
                        >
                            Révision
                        </a>
                    </p>
                    <ul>
                        {profile.values.map((v) => (
                            <li key={v.key}>
                                {v.sourceCategory} :{" "}
                                {v.annual === null ? "F" : `${v.annual} CAD/an`}{" "}
                                ({v.vector})
                            </li>
                        ))}
                    </ul>
                </div>
            </details>
        </section>
    );
}
export default function FinancesView({
    hub,
    onNavigate,
}: {
    hub: HubState;
    onNavigate: (view: AppView) => void;
}) {
    const [state, setState] = useState<FinanceState | null>(null),
        [tab, setTab] = useState<"expenses" | "investments" | "trends">("expenses");
    const [trendMonth, setTrendMonth] = useState("");
    const [error, setError] = useState(""),
        [message, setMessage] = useState(""),
        [busy, setBusy] = useState(false),
        [loading, setLoading] = useState(false);
    const [currency, setCurrency] = useState("CAD");
    const [operationScope, setOperationScope] = useState<"expenses" | "excluded">("expenses");
    const [from, setFrom] = useState(""),
        [to, setTo] = useState(""),
        [account, setAccount] = useState(""),
        [category, setCategory] = useState(""),
        [search, setSearch] = useState(""),
        [reviewOnly, setReviewOnly] = useState(false),
        [page, setPage] = useState(0);
    const [editing, setEditing] = useState<string | null>(null),
        [decision, setDecision] = useState<FinanceDecision>({
            nature: "expense",
            category: "other",
            note: "",
            updatedAt: "",
        });
    const [categoryPayments, setCategoryPayments] = useState<ExpenseCategory | null>(null);
    const savingDecision = useRef(false);
    const inlineAttempt = useRef<{ intent: string; requestId: string; input: object } | null>(null);
    const categoryQueue = useRef<string[] | null>(null);
    const [allSameName, setAllSameName] = useState(false), [staleDraft, setStaleDraft] = useState(false);
    const attempt = useRef<{ intent: string; requestId: string } | null>(null);
    const categoryTrigger = useRef<HTMLElement | null>(null);
    function openCategory(category: ExpenseCategory) {
        categoryTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setCategoryPayments(category);
    }
    function closeCategory() {
        setCategoryPayments(null);
        requestAnimationFrame(() => {
            // A saved category can move out of the leading five; return to it without focusing a hidden control.
            const current = tab === "expenses" ? [...document.querySelectorAll<HTMLButtonElement>(".finance-expense-charts [data-finance-bar]")].find(el => el.dataset.financeBar === categoryPayments) : null;
            if (current) {
                const disclosure = current.closest<HTMLDetailsElement>(".finance-more-categories");
                if (disclosure) disclosure.open = true;
                current.focus();
            } else if (categoryTrigger.current?.isConnected && categoryTrigger.current.getClientRects().length) categoryTrigger.current.focus();
            else (document.querySelector<HTMLElement>(tab === "trends" ? "#trends-month-title, .trend-months button.selected" : ".finance-expense-charts [data-finance-bar]") ?? document.querySelector<HTMLElement>(".finance-category-total button"))?.focus();
        });
    }
    const [bundle, setBundle] = useState<unknown>(null),
        [preview, setPreview] = useState<Awaited<
            ReturnType<typeof importFinances>
        > | null>(null),
        [investmentAccount, setInvestmentAccount] = useState("");
    const [investmentDetail, setInvestmentDetail] = useState(false);
    function openInvestment(id: string) {
        setInvestmentAccount(id); setInvestmentDetail(true);
        requestAnimationFrame(() => document.getElementById("investment-detail-title")?.focus());
    }
    function closeInvestment() {
        setInvestmentDetail(false);
        requestAnimationFrame(() => [...document.querySelectorAll<HTMLButtonElement>("[data-investment-account]")].find(el => el.dataset.investmentAccount === selected?.id)?.focus());
    }
    const paired = Boolean(hub.worker.Endpoint && hub.worker.ApiKey);
    const openedLink = useRef(false);
    const initialize = (s: FinanceState) => {
        setState(s);
        if (s.data && !trendMonth) setTrendMonth(s.data.scope.to.slice(0, 7));
        if (s.data && !from) {
            const period = defaultPeriod(s.data.scope);
            setFrom(period.from); setTo(period.to);
        }
        if (!openedLink.current && s.data) {
            openedLink.current = true;
            const query = new URLSearchParams(location.search), record = query.get("record");
            if (record) {
                const row = s.data.transactions.find(r => r.id === record);
                if (row) { const period = calendarPeriod(Number(row.date.slice(0, 4)), Number(row.date.slice(5, 7))); setFrom(period.from); setTo(period.to); setCurrency(row.currency); openDecision(record, s); }
                else setMessage("L’opération liée n’est pas présente dans les sources chargées.");
            }
            if (query.get("tab") === "investments") { setTab("investments"); setInvestmentAccount(query.get("account") ?? ""); setInvestmentDetail(Boolean(query.get("account"))); }
            const start = query.get("from"), end = query.get("to");
            if (start && end && /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && start <= end && Date.parse(end) - Date.parse(start) < 366 * 86400000) { setFrom(start); setTo(end); }
            const linkedCurrency = query.get("currency");
            if (linkedCurrency && s.data.transactions.some(row => row.currency === linkedCurrency)) setCurrency(linkedCurrency);
        }
    };
    useEffect(() => {
        let cancelled = false;
        openedLink.current = false;
        setState(null);
        setError("");
        if (!paired) return;
        setLoading(true);
        void fetchFinances(hub.worker)
            .then((s) => {
                if (!cancelled) initialize(s);
            })
            .catch((e) => {
                if (!cancelled) setError(e.message);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [hub.worker.Endpoint, hub.worker.ApiKey]);
    useEffect(
        () => setPage(0),
        [from, to, account, currency, category, search, reviewOnly, operationScope],
    );
    async function refresh() {
        setLoading(true);
        setError("");
        try {
            initialize(await fetchFinances(hub.worker));
            setMessage("Données du PC actualisées.");
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    }
    async function readImport(file?: File) {
        if (!file) return;
        setError("");
        setPreview(null);
        setBundle(null);
        if (file.size > 20_000_000) {
            setError("Fichier trop volumineux (20 Mo maximum).");
            return;
        }
        setBusy(true);
        try {
            const input = JSON.parse(await file.text());
            const result = await importFinances(
                hub.worker,
                input,
                state?.revision ?? "empty",
            );
            setBundle(input);
            setPreview(result);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    }
    async function applyImport() {
        if (!bundle || !preview) return;
        setBusy(true);
        setError("");
        try {
            const result = await importFinances(
                hub.worker,
                bundle,
                preview.revision ?? state?.revision ?? "empty",
                true,
            );
            if (result.state) initialize(result.state);
            setMessage(
                result.alreadyImported
                    ? "Ce fichier est déjà importé."
                    : `${result.added} opérations ajoutées au PC. Sources originales conservées.`,
            );
            setBundle(null);
            setPreview(null);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    }
    async function saveDecision(next = false) {
        if (!editing || !state || savingDecision.current || staleDraft) return;
        savingDecision.current = true;
        setBusy(true);
        setError("");
        let confirmed = false;
        // Preserve the original review order even if saving changes a row's category.
        const queue = categoryQueue.current;
        // Both Save and Save & Next use the same bulk decision and atomic worker write.
        // Skip the entire explicitly affected group when advancing: otherwise the category
        // drill-down could immediately reopen a row just saved by this bulk operation.
        const bulkScope = allSameName ? categoryScope(state, editing, decision, classified) : null;
        const affectedIds = new Set(bulkScope?.affected.map(row => row.id) ?? [editing]);
        const ids = queue ?? rows.map(row => row.id);
        const currentIndex = ids.indexOf(editing);
        const candidates = queue
            ? ids.slice(currentIndex + 1)
            : [...ids.slice(currentIndex + 1), ...ids.slice(0, Math.max(currentIndex, 0))];
        try {
            setMessage("");
            const input = { kind: "decision", id: editing, decision, allSameName, ...(bulkScope ? { expectedCount: bulkScope.affected.length } : {}) };
            const intent = JSON.stringify(input);
            if (attempt.current?.intent !== intent) attempt.current = { intent, requestId: crypto.randomUUID() };
            const requestId = attempt.current.requestId;
            const result = await saveFinanceChange(hub.worker, { ...input, requestId, expectedRevision: state.revision });
            if (result.operation?.id !== requestId || !result.revision || !Array.isArray(result.history)) throw new Error("Enregistrement non confirmé par le PC.");
            confirmed = true;
            const saved = result.refreshRequired ? await fetchFinances(hub.worker) : applyFinanceDelta(state, result, requestId);
            setState(saved);
            attempt.current = null;
            const present = new Set(saved.data?.transactions.map(row => row.id) ?? []);
            const following = next ? candidates.find(id => present.has(id) && !affectedIds.has(id) && (queue !== null || !saved.decisions[id])) : undefined;
            if (following) openDecision(following, saved, queue ?? undefined); else setEditing(null);
            setMessage(result.operation.count === 1 ? "Décision enregistrée sur le PC." : `${result.operation.count} décisions enregistrées sur le PC.`);
        } catch (e) {
            setError((e as Error).message);
            if (confirmed || (e as Error & { status?: number }).status === 409) setStaleDraft(true);
            if (confirmed) setMessage("Décision enregistrée; l’actualisation du PC reste nécessaire.");
        } finally {
            savingDecision.current = false;
            setBusy(false);
        }
    }
    async function saveInline(entries: InlineEntry[], sameName: boolean, progress: (done: string[]) => void): Promise<InlineResult> {
        if (!state || savingDecision.current) return { done: [], error: "Un enregistrement est déjà en cours." };
        savingDecision.current = true; setBusy(true); setError(""); setMessage("");
        let current = state, confirmed = false;
        const done = new Set<string>();
        try {
            if (sameName) {
                const categories = new Map<string, ExpenseCategory>();
                for (const entry of entries) {
                    const group = categoryScope(current, entry.id, { ...entry, note: current.decisions[entry.id]?.note ?? "", updatedAt: "" });
                    for (const row of group.affected) {
                        if (categories.has(row.id) && categories.get(row.id) !== entry.category) throw new Error("Deux sélections du même nom demandent des catégories différentes. Choisissez une catégorie commune ou désactivez l'application du même nom.");
                        categories.set(row.id, entry.category);
                    }
                }
            }
            const grouped = new Set<string>();
            for (const entry of entries) {
                if (done.has(entry.id)) continue;
                confirmed = false;
                const decision: FinanceDecision = { nature: entry.nature, category: entry.category, note: current.decisions[entry.id]?.note ?? "", updatedAt: "" };
                const group = sameName && !grouped.has(entry.id) ? categoryScope(current, entry.id, decision) : null;
                const input = { kind: "decision", id: entry.id, decision, allSameName: Boolean(group), ...(group ? { expectedCount: group.affected.length } : {}) };
                const intent = JSON.stringify({ entry, sameName, note: decision.note });
                if (inlineAttempt.current?.intent !== intent) inlineAttempt.current = { intent, requestId: crypto.randomUUID(), input };
                // Preserve the exact failed payload as well as its ID, even after an earlier
                // same-name step fulfilled peers and changed this step's derived scope.
                const requestId = inlineAttempt.current.requestId;
                const result = await saveFinanceChange(hub.worker, { ...inlineAttempt.current.input, expectedRevision: current.revision, requestId });
                if (result.operation?.id !== requestId || !result.revision || !Array.isArray(result.history)) throw new Error("Enregistrement non confirmé par le PC. Réessayez la même sélection.");
                confirmed = true;
                current = result.refreshRequired ? await fetchFinances(hub.worker) : applyFinanceDelta(current, result, requestId);
                const affected = current.decisionHistory.filter(e => e.operationId === requestId).map(e => e.id);
                if (!affected.length) throw new Error("Décision confirmée, historique à actualiser avant de continuer.");
                affected.forEach(id => {
                    grouped.add(id);
                    const requested = entries.find(e => e.id === id), saved = current.decisions[id];
                    if (!requested || (saved?.nature === requested.nature && saved.category === requested.category)) done.add(id);
                });
                setState(current); inlineAttempt.current = null; progress([...done]);
                if (result.refreshRequired) throw new Error("Des décisions plus récentes ont été conservées. Revoyez le reste du lot après actualisation; aucune ancienne décision n'a été réappliquée.");
            }
            return { done: [...done] };
        } catch (e) {
            return { done: [...done], error: (confirmed ? "Enregistrement confirmé; actualisez les décisions avant de continuer. " : "") + (e as Error).message, stale: confirmed || (e as Error & { status?: number }).status === 409 };
        } finally { savingDecision.current = false; setBusy(false); }
    }
    async function reloadInline() {
        const saved = await fetchFinances(hub.worker);
        setState(saved); inlineAttempt.current = null; attempt.current = null; setStaleDraft(false);
    }
    const data = state?.data;
    const classified = useMemo(() => state ? classifiedRows(state) : [], [state]);
    const trendToday = localToday();
    const trend = useMemo(() => tab === "trends" && state?.data && trendMonth ? spendingTrend(state, trendMonth, account, currency, trendToday) : null, [tab, state, trendMonth, account, currency, trendToday]);
    const scope = useMemo(() => state && editing ? categoryScope(state, editing, decision, classified) : null, [state, editing, decision, classified]);
    const undoOptions = useMemo(() => state ? financeUndoOptions(state) : [], [state]);
    const summary = useMemo(
        () =>
            state
                ? summarizeSpending(state, from, to, account, currency, classified)
                : null,
        [state, from, to, account, currency, classified],
    );
    const includedIds = new Set(summary?.included.map(r => r.id));
    const rows =
        ((operationScope === "expenses" ? summary?.included : summary?.rows.filter(r => !includedIds.has(r.id))) ?? [])
            .filter(
                (r) =>
                    (!category || r.category === category) &&
                    (!reviewOnly || !r.reviewed) &&
                    r.description.toLowerCase().includes(search.toLowerCase()),
            )
            .sort(byAmountDescending) ?? [];
    const editRow = classified.find((r) => r.id === editing);
    function openDecision(id: string, saved = state, queueIds?: string[]) {
        if (!saved) return;
        const row = classifiedRows(saved).find(r => r.id === id);
        if (!row) return;
        categoryQueue.current = queueIds ?? null;
        setEditing(id); setError("");
        setAllSameName(false); setStaleDraft(false); attempt.current = null;
        setDecision({ nature: row.nature, category: row.category, note: saved.decisions[id]?.note ?? "", updatedAt: "" });
    }
    async function reloadDecision() {
        if (savingDecision.current || busy) return;
        setBusy(true);
        setError("");
        try { const saved = await fetchFinances(hub.worker); setState(saved); attempt.current = null; if (editing) openDecision(editing, saved, categoryQueue.current ?? undefined); else setStaleDraft(false); setMessage("Données du PC actualisées."); }
        catch (e) { setError((e as Error).message); }
        finally { setBusy(false); }
    }
    async function undoChange(id: string, bubble = false) {
        if (!state || savingDecision.current || staleDraft) return;
        savingDecision.current = true; setBusy(true); setError("");
        setMessage("");
        let confirmed = false;
        try {
            const intent = JSON.stringify({ kind: "undo", undoOf: id });
            if (attempt.current?.intent !== intent) attempt.current = { intent, requestId: crypto.randomUUID() };
            const requestId = attempt.current.requestId;
            const result = await saveFinanceChange(hub.worker, { kind: "undo", undoOf: id, expectedRevision: state.revision, requestId });
            if (result.operation?.id !== requestId || !result.revision || !Array.isArray(result.history)) throw new Error("Annulation non confirmée par le PC.");
            confirmed = true;
            setState(result.refreshRequired ? await fetchFinances(hub.worker) : applyFinanceDelta(state, result, requestId));
            attempt.current = null; setMessage(`${result.operation.count} décisions précédentes restaurées.`);
        } catch (e) {
            setError((e as Error).message);
            if (confirmed || (e as Error & { status?: number }).status === 409) setStaleDraft(true);
            if (confirmed) setMessage("Annulation enregistrée; actualisation encore nécessaire.");
            if (bubble) throw e;
        } finally { savingDecision.current = false; setBusy(false); }
    }
    const investmentAccounts =
        data?.accounts.filter((a) => a.type !== "credit-card") ?? [];
    const selected =
        investmentAccounts.find((a) => a.id === investmentAccount) ??
        investmentAccounts.find((a) => a.type === "brokerage") ??
        investmentAccounts[0];
    const holdings =
            data?.holdings
                .filter((h) => h.accountId === selected?.id)
                .sort((a, b) => b.asOf.localeCompare(a.asOf)) ?? [],
        latest = holdings[0];
    const activities =
        data?.activities.filter(
            (a) =>
                a.accountId === selected?.id && a.date >= from && a.date <= to,
        ) ?? [];
    const flows = investmentCashFlows(activities),
        performance = data?.performance
            .filter((p) => p.accountId === selected?.id)
            .sort((a, b) => b.to.localeCompare(a.to))[0],
        gic = data?.gics
            .filter((g) => g.accountId === selected?.id)
            .sort((a, b) => b.issueDate.localeCompare(a.issueDate))[0];
    const recurring = recurringObservations(summary?.rows ?? []);
    const expenseValues = summary?.categories.filter(c => c.count).sort((a, b) => b.cents - a.cents).map(c => ({ id: c.key, label: expenseCategories[c.key], cents: c.cents })) ?? [];
    const expenseScale = Math.max(1, ...expenseValues.map(c => Math.abs(c.cents)));
    return (
        <section className="view-stack finance-view">
            <PageHeader
                title="Finances"
            >
                <button
                    className="button secondary"
                    disabled={!paired || busy || loading}
                    onClick={() => void refresh()}
                    aria-label={loading ? "Chargement" : "Actualiser"}
                >
                    <RefreshCw size={16} />
                    <span className="finance-refresh-label">{loading ? "Chargement…" : "Actualiser"}</span>
                </button>
            </PageHeader>
            <nav className="segment-tabs finance-tabs" aria-label="Finances">
                <button
                    aria-current={tab === "expenses" ? "page" : undefined}
                    className={tab === "expenses" ? "active" : ""}
                    onClick={() => setTab("expenses")}
                >
                    Dépenses
                </button>
                <button
                    aria-current={tab === "investments" ? "page" : undefined}
                    className={tab === "investments" ? "active" : ""}
                    onClick={() => setTab("investments")}
                >
                    Investissements
                </button>
                <button aria-current={tab === "trends" ? "page" : undefined} className={tab === "trends" ? "active" : ""} onClick={() => setTab("trends")}>
                    Tendances
                </button>
            </nav>
            {error && <Notice error>{error}</Notice>}
            {message && (
                <Notice onDismiss={() => setMessage("")}>{message}</Notice>
            )}
            {staleDraft && !editing && <button className="button secondary" disabled={busy} onClick={() => void reloadDecision()}>Actualiser les décisions du PC</button>}
            {!paired && (
                <div className="surface view-stack">
                    <h2>Retrouver vos finances sur le PC</h2>
                    <p>
                        Connectez le PC pour lire l’historique privé. Les
                        données financières ne sont pas stockées sur le site
                        public.
                    </p>
                    <button
                        className="button"
                        onClick={() => onNavigate("more")}
                    >
                        Ouvrir la connexion au PC
                    </button>
                </div>
            )}
            {paired && !loading && !data && !error && (
                <div className="surface">
                    <h2>Aucun historique importé</h2>
                    <p>
                        Ouvrez Sources et import privé pour prévisualiser votre
                        préparation. Aucun chiffre de démonstration ne remplace
                        vos données.
                    </p>
                </div>
            )}
            {data && state && summary && (
                <>
                    {tab === "investments" ? investmentDetail && <details className="finance-journey-controls"><summary>Période des activités : {from} au {to}</summary><PeriodNavigator range={{ from, to }} scope={data.scope} onChange={range => { setFrom(range.from); setTo(range.to); }} /></details> :
                        <FinanceScope data={data} range={tab === "expenses" ? { from, to } : undefined} onPeriod={range => { setFrom(range.from); setTo(range.to); }} account={account} currency={currency} onAccount={setAccount} onCurrency={setCurrency} />}
                    {tab !== "trends" && from > to && (
                        <Notice error>
                            La date de début doit précéder la date de fin.
                        </Notice>
                    )}
                    {tab === "trends" && trend ? <FinanceTrends state={state} trend={trend} account={account} currency={currency} onMonth={setTrendMonth} onCategory={openCategory} /> : tab === "expenses" ? (
                        <>
                            <div className="finance-chart-grid finance-expense-charts">
                                <section className="surface view-stack">
                                    <div className="finance-totals compact-finance-totals finance-category-total"><div>
                                        <span>Dépenses nettes · {currency}</span><strong>{money(summary.totalCents, currency)}</strong><InfoPopover title="Calcul des dépenses">
                                        <p className="muted">
                                Transferts, paiements de cartes, revenus et
                                placements sont exclus selon leur nature
                                proposée ou confirmée. Aucun partage
                                capital/intérêts n’est estimé. Une seule devise
                                à la fois, sans conversion. Les catégories
                                automatiques restent provisoires.
                            </p>
                                        <p>Remboursements déduits. Totaux par date d’opération. La vue annuelle conserve les mois partiels et les lacunes; elle n’extrapole pas une année complète.</p>
                                        <p>{summary.reviewCount} opérations à revoir · {summary.unreviewedCount} suggestions non confirmées.</p>
                                    </InfoPopover></div></div>
                                    <h2>Dépenses par catégorie</h2>
                                    {summary.included.length ? (
                                        <>
                                            <Bars currency={currency} values={expenseValues.slice(0, 5)} scale={expenseScale} onSelect={key => openCategory(key as ExpenseCategory)} />
                                            {expenseValues.length > 5 && <details className="finance-more-categories"><summary>Autres catégories ({expenseValues.length - 5})</summary>
                                                <Bars currency={currency} values={expenseValues.slice(5)} scale={expenseScale} onSelect={key => openCategory(key as ExpenseCategory)} />
                                            </details>}
                                        </>
                                    ) : (
                                        <p>
                                            Aucune dépense comptabilisée pour ce
                                            filtre.
                                        </p>
                                    )}
                                </section>
                                <details className="finance-journey-disclosure"><summary>Évolution mensuelle</summary>
                                <section className="surface view-stack">
                                    <div className="compact-heading"><h2>Évolution mensuelle</h2><InfoPopover title="Évolution mensuelle"><p>Un mois partiel n’est pas extrapolé. Une absence de lignes ne prouve pas une absence de dépenses.</p></InfoPopover></div>
                                    <Bars
                                        currency={currency}
                                        onSelect={(month) => { const period = calendarPeriod(Number(month.slice(0, 4)), Number(month.slice(5, 7))); setFrom(period.from); setTo(period.to); }}
                                        values={summary.months.map((m) => ({
                                            id: m.month,
                                            label: m.month,
                                            cents: m.cents,
                                            note: m.full
                                                ? "Fenêtre observée entière"
                                                : "Période partielle / couverture limitée",
                                        }))}
                                    />

                                </section>
                                </details>
                            </div>
                            <details className="finance-journey-disclosure"><summary>Épargne / Investissements classés</summary>
                            <section className="surface view-stack finance-savings-flow" aria-label="Épargne et investissements classés">
                                <h2>Épargne / Investissements</h2>
                                {summary.savings.count > 0 ? <>
                                    <div className="finance-totals">
                                        <div><small>Sorties classées · {currency}</small><strong>{money(summary.savings.outgoingCents, currency)}</strong></div>
                                        <div><small>Entrées classées · {currency}</small><strong>{money(summary.savings.incomingCents, currency)}</strong></div>
                                    </div>
                                    <p>Flux bancaires explicitement classés, hors dépenses. Les deux côtés d'un transfert ne sont pas additionnés; les activités du courtage restent séparées. Ce ne sont ni une épargne nette du foyer ni un rendement.</p>
                                    {summary.savings.months.length > 1 && <details><summary>Flux mois par mois</summary><div className="finance-chart-grid">
                                        <div><h3>Sorties classées</h3><Bars currency={currency} values={summary.savings.months.map(m => ({ id: m.month, label: m.month, cents: m.outgoingCents, note: m.full ? "Fenêtre observée entière" : "Couverture partielle" }))} onSelect={month => { const p = calendarPeriod(Number(month.slice(0, 4)), Number(month.slice(5, 7))); setFrom(p.from); setTo(p.to); }} /></div>
                                        <div><h3>Entrées classées</h3><Bars currency={currency} values={summary.savings.months.map(m => ({ id: m.month, label: m.month, cents: m.incomingCents, note: m.full ? "Fenêtre observée entière" : "Couverture partielle" }))} onSelect={month => { const p = calendarPeriod(Number(month.slice(0, 4)), Number(month.slice(5, 7))); setFrom(p.from); setTo(p.to); }} /></div>
                                    </div></details>}
                                    <button className="button secondary" onClick={() => openCategory("savings-investments")}>Voir les opérations classées</button>
                                </> : <p>Aucun mouvement d'épargne ou de placement explicitement classé dans cette période. Choisissez « Épargne / Investissements » lors de la catégorisation d'une opération; aucune affectation automatique n'est faite.</p>}
                            </section>
                            </details>
                            <details className="finance-journey-disclosure"><summary>Voir les opérations et catégories ({rows.length})</summary>
                            <section className="surface view-stack">
                                <h2>Opérations et catégories</h2>
                                {undoOptions.length > 0 && <details className="finance-edit-history">
                                    <summary>Modifications récentes</summary>
                                    <p className="muted">Les 10 dernières modifications. Une annulation restaure les décisions précédentes du groupe entier, seulement si aucune de ses opérations n’a été modifiée depuis.</p>
                                    <ul>{undoOptions.map(op => <li key={op.id}>
                                        <span>{op.count} {op.count === 1 ? "opération" : "opérations"} · {new Date(op.at).toLocaleString("fr-CA")}{!op.canUndo && <small>Déjà annulée ou modifiée depuis</small>}</span>
                                        <button className="button secondary" type="button" disabled={busy || staleDraft || !op.canUndo} onClick={() => void undoChange(op.id)} aria-label={`Annuler la modification de ${op.count} ${op.count === 1 ? "opération" : "opérations"} du ${new Date(op.at).toLocaleString("fr-CA")}`}>Annuler</button>
                                    </li>)}</ul>
                                    {busy && <p role="status">Modification en cours…</p>}
                                </details>}
                                <label>Opérations affichées<select aria-label="Opérations affichées" value={operationScope} onChange={event => { const next = event.target.value as "expenses" | "excluded"; setOperationScope(next); if (next === "expenses" && category === "savings-investments") setCategory(""); }}>
                                    <option value="expenses">Dépenses, remboursements déduits</option><option value="excluded">Hors dépenses</option>
                                </select></label>
                                {operationScope === "excluded" && <p className="muted">Paiements de carte, transferts, placements et autres opérations exclues des dépenses. Les montants restent séparés. Chaque opération conserve sa source et son classement reste modifiable.</p>}
                                <button className="button secondary" disabled={!rows.some(r => !r.reviewed)} onClick={() => { const row = rows.find(r => !r.reviewed); if (row) openDecision(row.id); }}>Catégoriser les opérations</button>
                                <div className="finance-filters">
                                    <label>
                                        Catégorie
                                        <select
                                            aria-label="Catégorie"
                                            value={category}
                                            onChange={(e) => { setCategory(e.target.value); if (e.target.value === "savings-investments") setOperationScope("excluded"); }}
                                        >
                                            <option value="">
                                                Toutes les catégories
                                            </option>
                                            {sortedExpenseCategories.map(([k, v]) => (
                                                <option key={k} value={k}>
                                                    {v}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <label>
                                        Rechercher
                                        <input
                                            type="search"
                                            value={search}
                                            onChange={(e) =>
                                                setSearch(e.target.value)
                                            }
                                        />
                                    </label>
                                </div>
                                <label className="finance-check">
                                    <input
                                        type="checkbox"
                                        checked={reviewOnly}
                                        onChange={(e) =>
                                            setReviewOnly(e.target.checked)
                                        }
                                    />
                                    Suggestions à confirmer seulement
                                </label>
                                <p className="muted">
                                    {rows.length} opération(s) {operationScope === "expenses" ? "dans les dépenses" : "hors dépenses"}, par montant décroissant. Les règles de
                                    libellé sont des suggestions; les paniers
                                    mixtes demandent une revue.
                                </p>
                                <div className="finance-register">
                                    {rows
                                        .slice(page * 20, page * 20 + 20)
                                        .map((r) => (
                                            <button
                                                className="finance-service"
                                                key={r.id}
                                                onClick={() => openDecision(r.id)}
                                            >
                                                <span>
                                                    <strong>
                                                        {r.description}
                                                    </strong>
                                                    <small>
                                                        {displayDate(r.date)} ·{" "}
                                                        {
                                                            data.accounts.find(
                                                                (a) =>
                                                                    a.id ===
                                                                    r.accountId,
                                                            )?.name
                                                        }
                                                    </small>
                                                    <small>
                                                        {
                                                            expenseCategories[
                                                                r.category
                                                            ]
                                                        }{" "}
                                                        · {natures[r.nature]} ·{" "}
                                                        {r.reviewed
                                                            ? "Confirmé"
                                                            : "Suggestion"}
                                                    </small>
                                                    <small className="finance-edit-label">{r.reviewed ? "Modifier la catégorie" : "Catégoriser"}</small>
                                                </span>
                                                <strong>
                                                    {money(
                                                        r.outflowCents,
                                                        r.currency,
                                                    )}
                                                </strong>
                                            </button>
                                        ))}
                                </div>
                                {!rows.length && (
                                    <p>
                                        Aucune opération ne correspond aux
                                        filtres.
                                    </p>
                                )}
                                <div className="row-actions">
                                    <button
                                        className="button secondary"
                                        disabled={page === 0}
                                        onClick={() => setPage(page - 1)}
                                    >
                                        Précédent
                                    </button>
                                    <span>
                                        {page + 1} /{" "}
                                        {Math.max(
                                            1,
                                            Math.ceil(rows.length / 20),
                                        )}
                                    </span>
                                    <button
                                        className="button secondary"
                                        disabled={
                                            (page + 1) * 20 >= rows.length
                                        }
                                        onClick={() => setPage(page + 1)}
                                    >
                                        Suivant
                                    </button>
                                </div>
                            </section>
                            </details>
                            <details className="finance-journey-disclosure"><summary>Repères de dépenses</summary>
                            <Benchmarks
                                state={state}
                                from={from}
                                to={to}
                                account={account}
                                currency={currency}
                            />
                            </details>
                            <details className="finance-journey-disclosure"><summary>Services et charges récurrentes</summary>
                            <section className="surface view-stack">
                                <h2>Pistes à examiner</h2>
                                <p>
                                    Charges répétées parmi les frais,
                                    abonnements et communications. Vérifiez les
                                    factures, le forfait et les services inclus
                                    avant de conclure à une hausse ou à un
                                    doublon.
                                </p>
                                {recurring.length ? (
                                    <div className="finance-register">
                                        {recurring.slice(0, 8).map((r) => (
                                            <button
                                                className="finance-service"
                                                key={r.latest.id}
                                                onClick={() => {
                                                    setCategory(
                                                        r.latest.category,
                                                    );
                                                    setSearch(
                                                        r.latest.description,
                                                    );
                                                    setAccount(
                                                        r.latest.accountId,
                                                    );
                                                }}
                                            >
                                                <span>
                                                    <strong>
                                                        {r.latest.description}
                                                    </strong>
                                                    <small>
                                                        {r.count} débits
                                                        observés ·{" "}
                                                        {
                                                            data.accounts.find(
                                                                (a) =>
                                                                    a.id ===
                                                                    r.latest
                                                                        .accountId,
                                                            )?.name
                                                        }
                                                    </small>
                                                    <small>
                                                        {r.previous.date} :{" "}
                                                        {money(
                                                            r.previous
                                                                .outflowCents,
                                                            r.previous.currency,
                                                        )}{" "}
                                                        → {r.latest.date} :{" "}
                                                        {money(
                                                            r.latest
                                                                .outflowCents,
                                                            r.latest.currency,
                                                        )}
                                                    </small>
                                                </span>
                                                <span>
                                                    <strong>
                                                        {r.changeCents > 0
                                                            ? "Hausse à vérifier"
                                                            : r.changeCents < 0
                                                              ? "Baisse observée"
                                                              : "Montant stable"}
                                                    </strong>
                                                    <small>
                                                        {money(
                                                            r.totalCents,
                                                            r.latest.currency,
                                                        )}{" "}
                                                        sur la période
                                                    </small>
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <p>
                                        Aucun libellé répété de ce type
                                        identifié dans la période. Les
                                        variations de libellé peuvent masquer
                                        des répétitions.
                                    </p>
                                )}
                                <button
                                    className="button secondary"
                                    onClick={() => onNavigate("savings")}
                                >
                                    Voir les services et contrats
                                </button>
                                <p className="muted">
                                    Une dépense historique n'est pas une
                                    économie réalisable. Aucune résiliation ou
                                    modification de contrat n'est effectuée.
                                </p>
                            </section>
                            </details>
                        </>
                    ) : (
                        <>
                            {!investmentDetail && <>
                            <section className="surface view-stack">
                                <div className="compact-heading"><h2>Comptes et valeurs observées</h2><InfoPopover title="Valeurs des comptes"><p>Chaque valeur conserve sa date et sa devise. Les instantanés de dates différentes ne constituent pas un patrimoine synchronisé; aucun rendement ou cours en direct n'est déduit.</p></InfoPopover></div>
                                <div className="finance-register">
                                    {investmentAccounts.map((a) => {
                                        const h = data.holdings
                                            .filter((h) => h.accountId === a.id)
                                            .sort((x, y) =>
                                                y.asOf.localeCompare(x.asOf),
                                            )[0];
                                        return (
                                            <button
                                                key={a.id}
                                                data-investment-account={a.id}
                                                className="finance-service"
                                                onClick={() =>
                                                    openInvestment(a.id)
                                                }
                                            >
                                                <span>
                                                    <strong>{a.name}</strong>
                                                    <small>
                                                        {a.type} ·{" "}
                                                        {h?.asOf ?? a.asOf}
                                                    </small>
                                                </span>
                                                <strong>
                                                    {h
                                                        ? money(
                                                              h.totalCents,
                                                              h.currency,
                                                          )
                                                        : a.balanceCents ===
                                                            null
                                                          ? "Valeur manquante"
                                                          : money(
                                                                a.balanceCents,
                                                                a.currency,
                                                            )}
                                                </strong>
                                            </button>
                                        );
                                    })}
                                </div>
                            </section>
                            </>}
                            {selected && investmentDetail && (
                                <section className="surface view-stack">
                                    <div className="compact-heading"><button type="button" className="button secondary" onClick={closeInvestment}>Retour aux comptes</button><InfoPopover title="Valeur observée"><p>La valeur conserve sa date source et sa devise. Les flux de la période sont distincts de la valeur du compte; aucun rendement ni droit de cotisation n'est estimé.</p></InfoPopover></div>
                                    <h2 id="investment-detail-title" tabIndex={-1}>{selected.name}</h2>
                                    <div className="finance-totals investment-summary"><div><small>Valeur observée · {latest?.asOf ?? selected.asOf}</small><strong>{latest ? money(latest.totalCents, latest.currency) : selected.balanceCents === null ? "Valeur manquante" : money(selected.balanceCents, selected.currency)}</strong></div></div>
                                    <Sources
                                        sources={[
                                            latest?.source ?? selected.source,
                                        ]}
                                    />
                                    <details className="finance-journey-disclosure"><summary>Positions et montants</summary>
                                    {latest ? (
                                        <>
                                            <h3>
                                                Répartition des positions au{" "}
                                                {latest.asOf}
                                            </h3>
                                            <Bars
                                                currency={latest.currency}
                                                values={[
                                                    ...latest.positions.map(
                                                        (p, i) => ({
                                                            id: String(i),
                                                            label: p.name,
                                                            cents: p.marketCents,
                                                            note: p.symbol,
                                                        }),
                                                    ),
                                                    {
                                                        id: "cash",
                                                        label: "Liquidités",
                                                        cents: latest.cashCents,
                                                    },
                                                ]}
                                            />
                                            <p className="muted">
                                                Valeurs observées en{" "}
                                                {latest.currency}, sans cours en
                                                direct. Répartition par titre,
                                                sans classification boursière
                                                inventée.
                                            </p>
                                            <details>
                                                <summary>
                                                    Quantités et prix source
                                                </summary>
                                                {latest.positions.map(
                                                    (p, i) => (
                                                        <p key={i}>
                                                            {p.symbol} ·{" "}
                                                            {p.quantity} unités
                                                            · prix {p.price}{" "}
                                                            {latest.currency} ·
                                                            coût comptable{" "}
                                                            {p.bookCents ===
                                                            null
                                                                ? "inconnu"
                                                                : money(
                                                                      p.bookCents,
                                                                      latest.currency,
                                                                  )}
                                                        </p>
                                                    ),
                                                )}
                                            </details>
                                        </>
                                    ) : (
                                        <p>
                                            Aucune position détaillée importée
                                            pour ce compte.
                                        </p>
                                    )}
                                    </details>
                                    {gic && (
                                        <div className="finance-maturity">
                                            <h3>
                                                Échéance du CPG :{" "}
                                                {gic.maturityDate}
                                            </h3>
                                            <p>
                                                Capital{" "}
                                                {money(
                                                    gic.principalCents,
                                                    gic.currency,
                                                )}{" "}
                                                · taux source {gic.annualRate}%
                                                · émission {gic.issueDate}.
                                                Vérifier les instructions de
                                                renouvellement avant l’échéance;
                                                aucune instruction n’est
                                                modifiée.
                                            </p>
                                            <Sources sources={[gic.source]} />
                                        </div>
                                    )}
                                    <h3>Flux de placement dans la période</h3>
                                    {activities.length ? (
                                        <>
                                            <div className="finance-totals">
                                                <div>
                                                    <small>
                                                        Cotisations identifiées
                                                        (CONT)
                                                    </small>
                                                    <strong>
                                                        {money(
                                                            flows.contributionsCents,
                                                            selected.currency,
                                                        )}
                                                    </strong>
                                                </div>
                                                <div>
                                                    <small>
                                                        Transferts identifiés
                                                    </small>
                                                    <strong>
                                                        {money(
                                                            flows.transfersCents,
                                                            selected.currency,
                                                        )}
                                                    </strong>
                                                </div>
                                                <div>
                                                    <small>
                                                        Subventions identifiées
                                                    </small>
                                                    <strong>
                                                        {money(
                                                            flows.grantsCents,
                                                            selected.currency,
                                                        )}
                                                    </strong>
                                                </div>
                                                <div>
                                                    <small>
                                                        Frais directement
                                                        prélevés
                                                    </small>
                                                    <strong>
                                                        {money(
                                                            flows.feesCents,
                                                            selected.currency,
                                                        )}
                                                    </strong>
                                                </div>
                                            </div>
                                            <InfoPopover title="Calcul des flux de placement">
                                            <p className="muted">
                                                Cotisations, transferts et
                                                subventions ne sont pas des
                                                rendements. Les achats/ventes et
                                                réinvestissements ne sont pas
                                                ajoutés aux cotisations. Frais
                                                internes des fonds non attestés;
                                                ce total n’est pas le coût
                                                global.
                                            </p>
                                            </InfoPopover>
                                            <details>
                                                <summary>
                                                    Historique des activités (
                                                    {activities.length})
                                                </summary>
                                                <div className="finance-activity-list">
                                                    {activities
                                                        .slice()
                                                        .sort((a, b) =>
                                                            b.date.localeCompare(
                                                                a.date,
                                                            ),
                                                        )
                                                        .map((a) => (
                                                            <div key={a.id}>
                                                                <strong>
                                                                    {a.date} ·{" "}
                                                                    {a.action} ·{" "}
                                                                    {money(
                                                                        a.netCashCents,
                                                                        a.currency,
                                                                    )}
                                                                </strong>
                                                                <p>
                                                                    {
                                                                        a.description
                                                                    }
                                                                </p>
                                                                <small>
                                                                    Règlement :{" "}
                                                                    {a.settleDate ||
                                                                        "inconnu"}
                                                                </small>
                                                                <Sources
                                                                    sources={
                                                                        a.sources
                                                                    }
                                                                />
                                                            </div>
                                                        ))}
                                                </div>
                                            </details>
                                        </>
                                    ) : (
                                        <p>
                                            Aucun flux de placement disponible
                                            dans la période; les cotisations et
                                            frais ne sont pas présumés nuls.
                                        </p>
                                    )}
                                    <details className="finance-journey-disclosure"><summary>Historique des valeurs</summary>
                                    <h3>Historique des valeurs</h3>
                                    {performance?.trend.length ? (
                                        <>
                                            <Bars
                                                currency={selected.currency}
                                                values={performance.trend
                                                    .filter(
                                                        (p) =>
                                                            p.date >= from &&
                                                            p.date <= to,
                                                    )
                                                    .map((p) => ({
                                                        id: p.date,
                                                        label: p.date,
                                                        cents: p.balanceCents,
                                                    }))}
                                            />
                                            <p className="muted">
                                                Valeurs affichées par le
                                                portail, contributions et
                                                retraits compris. Période source{" "}
                                                {performance.from} à{" "}
                                                {performance.to}.{" "}
                                                {performance.method}. Aucun taux
                                                de rendement recalculé.
                                            </p>
                                        </>
                                    ) : (
                                        <p>
                                            Historique de valeurs insuffisant
                                            pour mesurer la performance. Un
                                            solde actuel et des cotisations ne
                                            permettent pas de reconstituer un
                                            rendement.
                                        </p>
                                    )}
                                    </details>
                                    {data.feeReports
                                        .filter(
                                            (r) => r.accountId === selected.id,
                                        )
                                        .map((r, i) => (
                                            <details key={i}>
                                                <summary>
                                                    Rapport de frais {r.from} à{" "}
                                                    {r.to} :{" "}
                                                    {money(
                                                        r.totalCents,
                                                        r.currency,
                                                    )}
                                                </summary>
                                                <p>
                                                    {r.description}. Ce rapport
                                                    n’est pas ajouté aux débits
                                                    pour éviter un double
                                                    comptage.
                                                </p>
                                                <Sources sources={[r.source]} />
                                            </details>
                                        ))}
                                    <details className="finance-journey-disclosure"><summary>Points à vérifier</summary>
                                    <h3>Points de revue</h3>
                                    <p>
                                        {flows.feesCents > 0
                                            ? `Les frais visibles atteignent ${money(flows.feesCents, selected.currency)} sur la période. Le relevé annuel et les frais internes des fonds permettent de vérifier le coût complet avant de comparer des solutions de risque équivalent.`
                                            : "Complétez les frais et dates de valorisation avant de comparer des solutions."}{" "}
                                        Les droits de cotisation et
                                        l’admissibilité aux subventions restent
                                        à confirmer auprès des sources
                                        officielles; aucun plafond personnel
                                        n’est déduit de cet historique.
                                    </p>
                                    </details>
                                </section>
                            )}
                        </>
                    )}
                </>
            )}
            <CategoryPayments category={categoryPayments} open={Boolean(categoryPayments) && !editing} summary={tab === "trends" ? trend?.summary ?? null : summary} state={state} onSave={saveInline} onReload={reloadInline} onUndo={id => undoChange(id, true)} accounts={data?.accounts ?? []} account={account} currency={currency} from={tab === "trends" ? trend?.from ?? "" : from} to={tab === "trends" ? trend?.to ?? "" : to} onClose={closeCategory} onEdit={(id, queueIds) => openDecision(id, state, queueIds)} />
            {paired && (
                <details className="surface finance-import">
                    <summary>
                        Sources et import privé{" "}
                        {data ? `· collecte du ${data.collectedOn}` : ""}
                    </summary>
                    <div className="view-stack">
                        <p>
                            Importez une préparation TD vérifiée. L’aperçu
                            précède l’enregistrement; vos décisions restent
                            séparées des sources. Aucun accès bancaire ni
                            transfert d’argent.
                        </p>
                        <label className="button secondary file-button">
                            <Upload size={16} />
                            Choisir la préparation JSON
                            <input
                                type="file"
                                accept=".json,application/json"
                                disabled={busy || loading}
                                onChange={(e) => {
                                    void readImport(e.target.files?.[0]);
                                    e.target.value = "";
                                }}
                            />
                        </label>
                        {preview && (
                            <div role="status">
                                <p>
                                    {preview.alreadyImported
                                        ? "Fichier déjà importé."
                                        : `${preview.added} nouvelles opérations · ${preview.possibleDuplicates} doublons possibles · ${preview.from} à ${preview.to}`}
                                </p>
                                {!preview.alreadyImported && (
                                    <button
                                        className="button"
                                        disabled={busy}
                                        onClick={() => void applyImport()}
                                    >
                                        Confirmer l’import sur le PC
                                    </button>
                                )}
                            </div>
                        )}
                        {data && (
                            <>
                                <p>
                                    {data.accounts.length} comptes ·{" "}
                                    {data.transactions.length} opérations
                                    bancaires · {data.activities.length}{" "}
                                    activités de placement · {data.pendingCount}{" "}
                                    opérations en attente exclues. Import du{" "}
                                    {state?.importedAt}. Fenêtre demandée :{" "}
                                    {data.scope.from} à {data.scope.to}.
                                </p>
                                <div className="finance-register">
                                    {data.coverage.map((c) => (
                                        <div
                                            className="finance-coverage"
                                            key={c.accountId}
                                        >
                                            <strong>
                                                {
                                                    data.accounts.find(
                                                        (a) =>
                                                            a.id ===
                                                            c.accountId,
                                                    )?.name
                                                }
                                            </strong>
                                            <span>
                                                {c.earliest ??
                                                    "Aucune activité"}{" "}
                                                — {c.latest ?? "date inconnue"}
                                            </span>
                                            {c.warning && <p>{c.warning}</p>}
                                        </div>
                                    ))}
                                </div>
                                <p className="muted">
                                    Ces dates décrivent les lignes disponibles,
                                    pas une preuve d’exhaustivité. Les fichiers
                                    originaux et leurs empreintes restent
                                    archivés sur le PC.
                                </p>
                                <details>
                                    <summary>
                                        Limites consignées lors de la collecte
                                    </summary>
                                    <ul>
                                        {data.limits.map((l, i) => (
                                            <li key={i}>{l}</li>
                                        ))}
                                    </ul>
                                </details>
                            </>
                        )}
                    </div>
                </details>
            )}
            <Sheet
                open={Boolean(editing)}
                onClose={() => !busy && setEditing(null)}
                title="Vérifier l’opération"
            >
                {editRow && (
                    <form
                        className="view-stack finance-decision-form"
                        onSubmit={(e) => {
                            e.preventDefault();
                            void saveDecision();
                        }}
                    >
                        <p>
                            <strong>{editRow.description}</strong>
                            <br />
                            {editRow.date} ·{" "}
                            {money(editRow.outflowCents, editRow.currency)}
                        </p>
                        <p className="muted">
                            {editRow.reason}. Le montant et la source restent
                            inchangés.
                        </p>
                        <label>
                            Nature
                            <select
                                aria-label="Nature"
                                disabled={busy || staleDraft}
                                value={decision.nature}
                                onChange={(e) =>
                                    setDecision({
                                        ...decision,
                                        nature: e.target.value as Nature,
                                    })
                                }
                            >
                                {Object.entries(natures).map(([k, v]) => (
                                    <option
                                        key={k}
                                        value={k}
                                        disabled={
                                            !decisionCategoryAllowed(decision.category, k) ||
                                            (k === "refund" &&
                                                editRow.outflowCents >= 0) ||
                                            (k === "expense" &&
                                                editRow.outflowCents < 0)
                                        }
                                    >
                                        {v}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label>
                            Catégorie
                            <select
                                aria-label="Catégorie"
                                disabled={busy || staleDraft}
                                value={decision.category}
                                onChange={(e) =>
                                    setDecision({
                                        ...decision,
                                        category: e.target.value as ExpenseCategory,
                                        nature: decisionCategoryAllowed(e.target.value, decision.nature) ? decision.nature : "investment",
                                    })
                                }
                            >
                                {sortedExpenseCategories.map(
                                    ([k, v]) => (
                                        <option key={k} value={k}>
                                            {v}
                                        </option>
                                    ),
                                )}
                            </select>
                        </label>
                        {scope && scope.key && scope.matching > 1 && <div className="finance-bulk-choice">
                            <label><input type="checkbox" checked={allSameName} disabled={busy || staleDraft} onChange={e => setAllSameName(e.target.checked)} />Appliquer la catégorie à toutes les opérations du même nom</label>
                            <p id="finance-bulk-scope" aria-live="polite">{scope.affected.length} {scope.affected.length === 1 ? "opération" : "opérations"} {allSameName ? "à enregistrer" : "éligibles"} sur {scope.matching} du même nom, dans tout l’historique disponible, tous comptes et devises inclus. Les filtres affichés ne limitent pas cette action.</p>
                            <details><summary>Portée et protections</summary><p className="muted">Seule la catégorie est copiée aux autres opérations. Leurs natures, notes et montants restent conservés; les transferts et paiements de carte restent exclus des dépenses. Espaces et majuscules sont ignorés; chiffres, accents et ponctuation doivent correspondre. Les décisions déjà confirmées dans cette catégorie sont conservées.</p></details>
                            {scope.incompatible > 0 && <p>{scope.incompatible} {scope.incompatible === 1 ? "opération exclue" : "opérations exclues"} : cette catégorie est incompatible avec leur nature. Les autres décisions déjà confirmées dans cette catégorie sont conservées.</p>}
                        </div>}
                        {decision.category === "savings-investments" && <p className="muted">Hors dépenses. Choisissez Transfert pour un mouvement entre comptes, Placement / cotisation pour un versement, ou À vérifier en cas de doute. Les entrées et sorties restent séparées; aucun rendement n'est calculé.</p>}
                        {decision.category === "groceries" && <p className="muted">Vérifiez le ticket pour les achats mixtes (aliments et autres produits). La suggestion du commerçant ne confirme pas tout le contenu.</p>}
                        {decision.category === "pets" && <p className="muted">Nourriture, soins vétérinaires, médicaments, toilettage et assurance pour animaux. Confirmez le type d’achat à partir du justificatif; le nom du commerçant seul ne suffit pas.</p>}
                        <details className="finance-decision-note"><summary>Note et audit</summary>                        <label>
                            Note de décision
                            <textarea
                                maxLength={1000}
                                disabled={busy || staleDraft}
                                value={decision.note}
                                onChange={(e) =>
                                    setDecision({
                                        ...decision,
                                        note: e.target.value,
                                    })
                                }
                            />
                        </label></details>
                        <Sources sources={editRow.sources} />
                        <div className="finance-decision-actions">
                            <button className="button" type="submit" disabled={busy || staleDraft} aria-describedby={allSameName ? "finance-bulk-scope" : undefined}>
                                {busy
                                    ? "Enregistrement…"
                                    : allSameName ? `Enregistrer ${scope?.affected.length ?? 1} opérations` : "Enregistrer la décision"}
                            </button>
                            <button className="button secondary" type="button" disabled={busy || staleDraft} aria-describedby={allSameName ? "finance-bulk-scope" : undefined} onClick={() => void saveDecision(true)}>{allSameName ? `Enregistrer et suivante (${scope?.affected.length ?? 1} opérations)` : "Enregistrer et suivante"}</button>
                        </div>
                        {categoryPayments && <button className="button secondary" type="button" disabled={busy} onClick={() => setEditing(null)}>Retour aux paiements de la catégorie</button>}
                        {staleDraft && <button className="button secondary" type="button" disabled={busy} onClick={() => void reloadDecision()}>Recharger la décision du PC et remplacer ce brouillon</button>}
                        {busy && <p role="status">{staleDraft ? "Actualisation" : "Enregistrement"} en cours sur le PC…</p>}
                        {message && staleDraft && <Notice>{message}</Notice>}
                        {error && <Notice error>{error}</Notice>}
                    </form>
                )}
            </Sheet>
        </section>
    );
}
