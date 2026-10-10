import {
    expenseCategories,
    decisionCategoryAllowed,
    natures,
    type FinanceState,
} from "./finance-model.js";
/** Fail closed before serving or editing a damaged private ledger. Never repair it on read. */
export function validateFinanceState(value: unknown): FinanceState {
    const bad = (): never => {
        throw new Error(
            "Registre financier invalide. Fichier conservé; restauration requise.",
        );
    };
    const object = (v: unknown): Record<string, any> =>
        !v || typeof v !== "object" || Array.isArray(v)
            ? bad()
            : (v as Record<string, any>);
    const array = (v: unknown, max = 50000): any[] =>
        !Array.isArray(v) || v.length > max ? bad() : v;
    const txt = (v: unknown, max = 5000) =>
        typeof v !== "string" || v.length > max ? bad() : v;
    const num = (v: unknown) =>
        !Number.isSafeInteger(v) || Math.abs(v as number) > 1e13
            ? bad()
            : (v as number);
    const date = (v: unknown) => {
        const d = txt(v, 10);
        if (
            !/^\d{4}-\d{2}-\d{2}$/.test(d) ||
            !Number.isFinite(Date.parse(d)) ||
            new Date(d).toISOString().slice(0, 10) !== d
        )
            bad();
        return d;
    };
    const s = object(value),
        d = object(s.data);
    if (s.schema !== 1) bad();
    txt(s.revision, 100);
    txt(s.importedAt, 100);
    date(d.collectedOn);
    const scope = object(d.scope);
    if (date(scope.from) > date(scope.to)) bad();
    const accounts = new Map<string, string>();
    for (const a of array(d.accounts, 100)) {
        txt(a.id, 160);
        txt(a.identity, 200);
        txt(a.name, 160);
        txt(a.type, 40);
        txt(a.asOf, 100);
        if (!/^[A-Z]{3}$/.test(txt(a.currency, 3)) || accounts.has(a.id)) bad();
        accounts.set(a.id, a.currency);
        if (a.balanceCents !== null) num(a.balanceCents);
    }
    const ref = (r: any) => {
        if (accounts.get(r.accountId) !== r.currency) bad();
    };
    const ids = new Set<string>();
    for (const r of array(d.transactions)) {
        txt(r.id, 160);
        if (ids.has(r.id) || r.status !== "posted") bad();
        ids.add(r.id);
        ref(r);
        date(r.date);
        num(r.outflowCents);
        if (num(r.occurrence) < 1) bad();
        txt(r.fingerprint, 160);
        txt(r.description);
        array(r.hints, 30);
        array(r.sources, 100);
    }
    const activityIds = new Set<string>();
    for (const r of array(d.activities)) {
        txt(r.id, 160);
        if (activityIds.has(r.id)) bad();
        activityIds.add(r.id);
        ref(r);
        date(r.date);
        num(r.netCashCents);
        if (num(r.occurrence) < 1) bad();
        txt(r.fingerprint, 160);
        txt(r.description);
        txt(r.action, 40);
        array(r.sources, 100);
    }
    for (const h of array(d.holdings, 2000)) {
        ref(h);
        txt(h.asOf, 100);
        const cash = num(h.cashCents),
            total = num(h.totalCents);
        const positions = array(h.positions, 5000);
        if (
            positions.reduce((sum, p) => sum + num(p.marketCents), cash) !==
            total
        )
            bad();
    }
    for (const p of array(d.performance, 100)) {
        if (!accounts.has(p.accountId)) bad();
        date(p.from);
        date(p.to);
        for (const t of array(p.trend, 500)) {
            date(t.date);
            num(t.balanceCents);
        }
    }
    for (const g of array(d.gics, 100)) {
        ref(g);
        date(g.maturityDate);
        num(g.principalCents);
    }
    for (const r of array(d.feeReports, 1000)) {
        ref(r);
        date(r.from);
        date(r.to);
        num(r.totalCents);
    }
    for (const c of array(d.coverage, 100)) {
        if (!accounts.has(c.accountId)) bad();
        if (c.earliest !== null) date(c.earliest);
        if (c.latest !== null) date(c.latest);
    }
    num(d.pendingCount);
    array(d.limits, 100).forEach((v) => txt(v));
    for (const [id, v] of Object.entries(object(s.decisions))) {
        const r = object(v);
        if (
            !ids.has(id) ||
            !Object.hasOwn(natures, r.nature) ||
            !Object.hasOwn(expenseCategories, r.category) ||
            !decisionCategoryAllowed(r.category, r.nature)
        )
            bad();
        txt(r.note, 1000);
        txt(r.updatedAt, 100);
    }
    array(s.decisionHistory);
    array(s.imports, 10000).forEach((i) => {
        if (!/^[a-f0-9]{64}$/.test(txt(i.hash, 64))) bad();
        num(i.added);
        txt(i.at, 100);
    });
    return value as FinanceState;
}
