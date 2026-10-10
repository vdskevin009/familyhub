import { useEffect, useMemo, useRef, useState } from "react";
import CategoryPayments from "./CategoryPayments";
import FinanceTrends from "./FinanceTrends";
import { spendingTrend } from "../finance-trends";
import { RefreshCw, Upload } from "lucide-react";
import type { HubState } from "../state";
import type { AppView } from "../types";
import { PageHeader, Notice, Sheet } from "../ui/primitives";
import { fetchFinances, importFinances, saveFinanceDecision } from "../worker";
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
}: {
    values: { id: string; label: string; cents: number; note?: string }[];
    onSelect?: (id: string) => void;
    currency?: string;
}) {
    const max = Math.max(1, ...values.map((v) => Math.abs(v.cents)));
    return (
        <ul className="finance-bars">
            {values.map((v) => (
                <li key={v.id}>
                    <button
                        type="button"
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
    const categoryTrigger = useRef<HTMLElement | null>(null);
    function openCategory(category: ExpenseCategory) {
        categoryTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setCategoryPayments(category);
    }
    function closeCategory() {
        setCategoryPayments(null);
        requestAnimationFrame(() => {
            if (categoryTrigger.current?.isConnected) categoryTrigger.current.focus();
            else document.querySelector<HTMLElement>(tab === "trends" ? ".trend-months button.selected" : ".finance-expense-charts button")?.focus();
        });
    }
    const [bundle, setBundle] = useState<unknown>(null),
        [preview, setPreview] = useState<Awaited<
            ReturnType<typeof importFinances>
        > | null>(null),
        [investmentAccount, setInvestmentAccount] = useState("");
    const paired = Boolean(hub.worker.Endpoint && hub.worker.ApiKey);
    const initialize = (s: FinanceState) => {
        setState(s);
        if (s.data && !trendMonth) setTrendMonth(defaultPeriod(s.data.scope).from.slice(0, 7));
        if (s.data && !from) {
            const period = defaultPeriod(s.data.scope);
            setFrom(period.from); setTo(period.to);
        }
    };
    useEffect(() => {
        let cancelled = false;
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
        if (!editing || !state || savingDecision.current) return;
        savingDecision.current = true;
        setBusy(true);
        setError("");
        try {
            const saved = await saveFinanceDecision(
                    hub.worker,
                    editing,
                    state.revision,
                    decision,
                );
            setState(saved);
            const following = next ? rows.find(r => r.id !== editing && !saved.decisions[r.id]) : undefined;
            if (following) openDecision(following.id, saved); else setEditing(null);
            setMessage("Décision enregistrée sur le PC.");
        } catch (e) {
            setError((e as Error).message);
        } finally {
            savingDecision.current = false;
            setBusy(false);
        }
    }
    const data = state?.data;
    const trend = useMemo(() => state?.data && trendMonth ? spendingTrend(state, trendMonth, account, currency) : null, [state, trendMonth, account, currency]);
    const summary = useMemo(
        () =>
            state
                ? summarizeSpending(state, from, to, account, currency)
                : null,
        [state, from, to, account, currency],
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
            .sort(
                (a, b) =>
                    b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
            ) ?? [];
    const editRow = state
        ? classifiedRows(state).find((r) => r.id === editing)
        : null;
    function openDecision(id: string, saved = state) {
        if (!saved) return;
        const row = classifiedRows(saved).find(r => r.id === id);
        if (!row) return;
        setEditing(id); setError("");
        setDecision({ nature: row.nature, category: row.category, note: saved.decisions[id]?.note ?? "", updatedAt: "" });
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
    return (
        <section className="view-stack finance-view">
            <PageHeader
                title="Finances"
                subtitle="Comprendre les dépenses et les placements"
            >
                <button
                    className="button secondary"
                    disabled={!paired || busy || loading}
                    onClick={() => void refresh()}
                >
                    <RefreshCw size={16} />
                    {loading ? "Chargement…" : "Actualiser"}
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
                    {tab !== "trends" && <><PeriodNavigator range={{ from, to }} scope={data.scope} onChange={range => { setFrom(range.from); setTo(range.to); }} />
                    <p className="muted">Totaux par date d'opération. La vue annuelle conserve les mois partiels et les lacunes; elle n'extrapole pas une année complète.</p></>}
                    <div className="finance-filters">
                        {tab !== "investments" && (
                            <label>
                                Compte
                                <select
                                    aria-label="Compte"
                                    value={account}
                                    onChange={(e) => setAccount(e.target.value)}
                                >
                                    <option value="">Tous les comptes</option>
                                    {data.accounts.map((a) => (
                                        <option key={a.id} value={a.id}>
                                            {a.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        )}
                        {tab !== "investments" && (
                            <label>
                                Devise
                                <select
                                    aria-label="Devise"
                                    value={currency}
                                    onChange={(e) =>
                                        setCurrency(e.target.value)
                                    }
                                >
                                    {[
                                        ...new Set([
                                            "CAD",
                                            ...data.accounts.map(
                                                (a) => a.currency,
                                            ),
                                        ]),
                                    ].map((c) => (
                                        <option key={c}>{c}</option>
                                    ))}
                                </select>
                            </label>
                        )}
                    </div>
                    {tab !== "trends" && from > to && (
                        <Notice error>
                            La date de début doit précéder la date de fin.
                        </Notice>
                    )}
                    {tab === "trends" && trend ? <FinanceTrends state={state} trend={trend} account={account} currency={currency} onMonth={setTrendMonth} onCategory={openCategory} /> : tab === "expenses" ? (
                        <>
                            <div className="finance-totals surface">
                                <div>
                                    <small>
                                        Dépenses nettes importées · {currency}
                                    </small>
                                    <strong>
                                        {money(summary.totalCents, currency)}
                                    </strong>
                                    <small>
                                        Remboursements déduits · versements
                                        hypothécaires entiers
                                    </small>
                                </div>
                                <div>
                                    <small>Revue restante</small>
                                    <strong>{summary.reviewCount}</strong>
                                    <small>
                                        Opérations de nature/catégorie
                                        incertaine · {summary.unreviewedCount}{" "}
                                        suggestions non confirmées
                                    </small>
                                </div>
                            </div>
                            <p className="muted">
                                Transferts, paiements de cartes, revenus et
                                placements sont exclus selon leur nature
                                proposée ou confirmée. Aucun partage
                                capital/intérêts n’est estimé. Une seule devise
                                à la fois, sans conversion. Les catégories
                                automatiques restent provisoires.
                            </p>
                            <div className="finance-chart-grid finance-expense-charts">
                                <section className="surface view-stack">
                                    <h2>Dépenses par catégorie</h2>
                                    {summary.included.length ? (
                                        <Bars
                                            currency={currency}
                                            values={summary.categories
                                                .filter((c) => c.count)
                                                .sort(
                                                    (a, b) => b.cents - a.cents,
                                                )
                                                .map((c) => ({
                                                    id: c.key,
                                                    label: expenseCategories[
                                                        c.key
                                                    ],
                                                    cents: c.cents,
                                                }))}
                                            onSelect={key => openCategory(key as ExpenseCategory)}
                                        />
                                    ) : (
                                        <p>
                                            Aucune dépense comptabilisée pour ce
                                            filtre.
                                        </p>
                                    )}
                                </section>
                                <section className="surface view-stack">
                                    <h2>Évolution mensuelle</h2>
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
                                    <p className="muted">
                                        Un mois partiel n’est pas extrapolé. Une
                                        absence de lignes ne prouve pas une
                                        absence de dépenses.
                                    </p>
                                </section>
                            </div>
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
                            <section className="surface view-stack">
                                <h2>Opérations et catégories</h2>
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
                                            {Object.entries(
                                                expenseCategories,
                                            ).map(([k, v]) => (
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
                                    {rows.length} opération(s) {operationScope === "expenses" ? "dans les dépenses" : "hors dépenses"}. Les règles de
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
                            <Benchmarks
                                state={state}
                                from={from}
                                to={to}
                                account={account}
                                currency={currency}
                            />
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
                        </>
                    ) : (
                        <>
                            <section className="surface view-stack">
                                <h2>Comptes et valeurs observées</h2>
                                <p>
                                    Chaque valeur garde sa date. Les cartes de
                                    crédit ne sont pas des placements. Les
                                    instantanés de dates différentes ne forment
                                    pas un patrimoine synchronisé.
                                </p>
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
                                                className={`finance-service ${selected?.id === a.id ? "selected" : ""}`}
                                                onClick={() =>
                                                    setInvestmentAccount(a.id)
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
                            {selected && (
                                <section className="surface view-stack">
                                    <h2>{selected.name}</h2>
                                    <Sources
                                        sources={[
                                            latest?.source ?? selected.source,
                                        ]}
                                    />
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
                                </section>
                            )}
                        </>
                    )}
                </>
            )}
            <CategoryPayments category={categoryPayments} open={Boolean(categoryPayments) && !editing} summary={tab === "trends" ? trend?.summary ?? null : summary} accounts={data?.accounts ?? []} account={account} currency={currency} from={tab === "trends" ? trend?.from ?? "" : from} to={tab === "trends" ? trend?.to ?? "" : to} onClose={closeCategory} onEdit={openDecision} />
            <Sheet
                open={Boolean(editing)}
                onClose={() => !busy && setEditing(null)}
                title="Vérifier l’opération"
            >
                {editRow && (
                    <form
                        className="view-stack"
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
                                value={decision.category}
                                onChange={(e) =>
                                    setDecision({
                                        ...decision,
                                        category: e.target.value as ExpenseCategory,
                                        nature: decisionCategoryAllowed(e.target.value, decision.nature) ? decision.nature : "investment",
                                    })
                                }
                            >
                                {Object.entries(expenseCategories).map(
                                    ([k, v]) => (
                                        <option key={k} value={k}>
                                            {v}
                                        </option>
                                    ),
                                )}
                            </select>
                        </label>
                        {decision.category === "savings-investments" && <p className="muted">Hors dépenses. Choisissez Transfert pour un mouvement entre comptes, Placement / cotisation pour un versement, ou À vérifier en cas de doute. Les entrées et sorties restent séparées; aucun rendement n'est calculé.</p>}
                        {decision.category === "groceries" && <p className="muted">Vérifiez le ticket pour les achats mixtes (aliments et autres produits). La suggestion du commerçant ne confirme pas tout le contenu.</p>}
                        {decision.category === "pets" && <p className="muted">Nourriture, soins vétérinaires, médicaments, toilettage et assurance pour animaux. Confirmez le type d’achat à partir du justificatif; le nom du commerçant seul ne suffit pas.</p>}
                        <label>
                            Note de décision
                            <textarea
                                maxLength={1000}
                                value={decision.note}
                                onChange={(e) =>
                                    setDecision({
                                        ...decision,
                                        note: e.target.value,
                                    })
                                }
                            />
                        </label>
                        <Sources sources={editRow.sources} />
                        <button className="button" disabled={busy}>
                            {busy
                                ? "Enregistrement…"
                                : "Enregistrer la décision"}
                        </button>
                        {categoryPayments ? <button className="button secondary" type="button" disabled={busy} onClick={() => setEditing(null)}>Retour aux paiements de la catégorie</button> : <button className="button secondary" type="button" disabled={busy} onClick={() => void saveDecision(true)}>Enregistrer et suivante</button>}
                        {error && <Notice error>{error}</Notice>}
                    </form>
                )}
            </Sheet>
        </section>
    );
}
