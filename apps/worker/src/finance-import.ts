import type {
    Evidence,
    FinanceData,
    FinanceTransaction,
} from "./finance-model.js";
type Obj = Record<string, any>;
function obj(v: unknown): Obj {
    if (!v || typeof v !== "object" || Array.isArray(v))
        throw new Error("Objet financier invalide.");
    return v as Obj;
}
function list(v: unknown, limit = 30000): any[] {
    if (!Array.isArray(v) || v.length > limit)
        throw new Error("Liste financière invalide.");
    return v;
}
function text(v: unknown, max = 2000): string {
    if (typeof v !== "string" || v.length > max)
        throw new Error("Texte financier invalide.");
    return v;
}
function cents(v: unknown): number {
    if (!Number.isSafeInteger(v) || Math.abs(v as number) > 1e13)
        throw new Error("Montant invalide : cents entiers requis.");
    return v as number;
}
function date(v: unknown): string {
    const s = text(v, 10);
    if (
        !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
        new Date(s + "T12:00:00Z").toISOString().slice(0, 10) !== s
    )
        throw new Error("Date financière invalide.");
    return s;
}
function occurrence(v: unknown): number {
    const n = cents(v ?? 1);
    if (n < 1) throw new Error("Occurrence invalide.");
    return n;
}
function currency(v: unknown): string {
    const s = text(v, 3);
    if (!/^[A-Z]{3}$/.test(s)) throw new Error("Devise invalide.");
    return s;
}
function id(v: unknown): string {
    const s = text(v, 160);
    if (!/^[a-zA-Z0-9:_-]+$/.test(s))
        throw new Error("Identité financière invalide.");
    return s;
}
function decimalCents(v: unknown): number {
    const s = text(v, 50).replaceAll(",", "");
    if (!/^-?\d+(\.\d{1,2})?$/.test(s))
        throw new Error("Valeur de position invalide.");
    const sign = s.startsWith("-") ? -1 : 1;
    const [a, b = ""] = s.replace("-", "").split(".");
    return cents(sign * (Number(a) * 100 + Number(b.padEnd(2, "0"))));
}
export function sourceEvidence(v: unknown): Evidence {
    if (typeof v === "string")
        return { name: "Observation source", detail: text(v) };
    const s = obj(v);
    return {
        name:
            typeof s.file === "string"
                ? s.file.split(/[\\/]/).at(-1)!.slice(0, 255)
                : "Observation source",
        ...(typeof s.sha256 === "string" && /^[a-f0-9]{64}$/.test(s.sha256)
            ? { sha256: s.sha256 }
            : {}),
        ...(Number.isSafeInteger(s.record) ? { record: s.record } : {}),
        ...(Number.isSafeInteger(s.page) ? { page: s.page } : {}),
    };
}
/** Adapter for the retrieved preparation format. Original bundle is archived privately by FinanceLibrary. */
export function parseFinancePreparation(value: unknown): FinanceData {
    const p = obj(value);
    if (p.schema !== "familyhub.td.preparation.v1")
        throw new Error("Format attendu : préparation financière TD v1.");
    const collectedOn = date(p.collectedOn),
        scope = { from: date(obj(p.scope).from), to: date(p.scope.to) };
    if (scope.from > scope.to) throw new Error("Période inversée.");
    const accounts = list(p.accounts, 100).map((a) => ({
        id: id(a.accountId),
        identity: text(a.identityFingerprint ?? a.accountId, 200),
        name: text(a.alias, 160),
        type: text(a.type, 40),
        currency: currency(a.currency),
        balanceCents:
            a.observedBalanceCents == null
                ? null
                : cents(a.observedBalanceCents),
        asOf: text(a.observedOn ?? collectedOn, 100),
        source: sourceEvidence(
            a.identityEvidence ?? "Registre de comptes de la collecte",
        ),
    }));
    const accountIds = new Set(accounts.map((a) => a.id));
    if (accounts.length !== accountIds.size)
        throw new Error("Comptes dupliqués.");
    const account = (v: unknown) => {
        const key = id(v);
        if (!accountIds.has(key))
            throw new Error("Compte source absent du registre.");
        return key;
    };
    const transactions: FinanceTransaction[] = list(p.bankActivities).map(
        (r) => {
            const outflowCents = cents(r.signedOutflowCents);
            if (
                cents(r.debitCents ?? 0) - cents(r.creditCents ?? 0) !==
                    outflowCents ||
                (r.debitCents ?? 0) < 0 ||
                (r.creditCents ?? 0) < 0
            )
                throw new Error("Débit/crédit incohérent.");
            if (r.status !== "posted")
                throw new Error(
                    "Seules les opérations comptabilisées entrent dans le registre.",
                );
            return {
                id: id(r.id),
                accountId: account(r.accountId),
                date: date(r.transactionDate),
                description: text(r.descriptionOriginal),
                currency: currency(r.currency),
                outflowCents,
                status: "posted",
                occurrence: occurrence(r.occurrence),
                fingerprint: text(r.matchingFingerprint ?? "", 160),
                hints: list(r.reviewHints ?? [], 30).map((h) => text(h, 200)),
                sources: [sourceEvidence(r.source)],
            };
        },
    );
    const activities = list(p.brokerageActivities).map((r) => ({
        id: id(r.id),
        accountId: account(r.accountId),
        date: date(r.tradeDate),
        settleDate: r.settleDate ? date(r.settleDate) : "",
        description: text(r.descriptionOriginal),
        action: text(r.actionOriginal, 40),
        currency: currency(r.currency),
        netCashCents: cents(r.netCashCents),
        commissionCents:
            r.commissionCents == null ? null : cents(r.commissionCents),
        occurrence: occurrence(r.occurrence),
        fingerprint: text(r.matchingFingerprint ?? "", 160),
        quantity: text(r.quantityDecimal ?? "", 80),
        price: text(r.priceDecimal ?? "", 80),
        sources: [sourceEvidence(r.source)],
    }));
    const holdings = list(p.holdingsSnapshots, 1000).map((h) => {
        const cashCents = cents(h.cashCents),
            totalCents = cents(h.totalValueCents);
        const positions = list(h.positions, 5000).map((q) => ({
            symbol: text(q.Symbol ?? "", 80),
            name: text(q.Description),
            quantity: text(q.Quantity ?? "", 80),
            price: text(q.Price ?? "", 80),
            marketCents: decimalCents(q["Market Value"]),
            bookCents: q["Book Cost"] ? decimalCents(q["Book Cost"]) : null,
        }));
        if (
            positions.reduce((s, r) => s + r.marketCents, cashCents) !==
            totalCents
        )
            throw new Error("Positions et total ne concordent pas.");
        return {
            accountId: account(h.accountId),
            asOf: text(h.bankAsOf, 100),
            currency: currency(h.currency),
            cashCents,
            totalCents,
            positions,
            source: sourceEvidence(h.source),
        };
    });
    const performance = list(p.performanceSnapshots ?? [], 100).map((q) => ({
        accountId: account(q.accountId),
        from: date(q.actualStart),
        to: date(q.actualEnd),
        method: text(q.status ?? "Méthode non documentée"),
        trend: list(q.trend, 500).map((t) => ({
            date: date(t.date),
            balanceCents: cents(t.endingBalanceCents),
        })),
    }));
    const g = p.gicDetails;
    const gics = g
        ? [
              {
                  accountId: account(g.accountId),
                  principalCents: cents(g.principalCents),
                  currency: currency(g.currency),
                  issueDate: date(g.issueDate),
                  maturityDate: date(g.maturityDate),
                  annualRate: text(g.annualRatePercentDecimal, 30),
                  source: sourceEvidence(g.evidence),
              },
          ]
        : [];
    const coverage = list(p.coverage, 100).map((c) => ({
        accountId: account(c.accountId),
        earliest: c.earliest ? date(c.earliest) : null,
        latest: c.latest ? date(c.latest) : null,
        warning: c.coverageWarning ? text(c.coverageWarning) : null,
    }));
    const feeReports = list(
        p.financialDocumentFacts?.feesReports ?? [],
        1000,
    ).map((r) => ({
        accountId: account(r.accountId),
        from: date(r.from),
        to: date(r.to),
        currency: currency(r.currency),
        totalCents: cents(r.totalPaidCents),
        description: text(r.status ?? "Rapport annuel de frais"),
        source: sourceEvidence(r.source),
    }));
    for (const row of [
        ...transactions,
        ...activities,
        ...holdings,
        ...gics,
        ...feeReports,
    ])
        if (
            row.currency !==
            accounts.find((a) => a.id === row.accountId)?.currency
        )
            throw new Error(
                "Devise du compte et de l’opération incohérente; conversion non autorisée.",
            );
    for (const rows of [transactions, activities]) {
        if (new Set(rows.map((r) => r.id)).size !== rows.length)
            throw new Error(
                "Identités de transactions dupliquées dans le fichier.",
            );
    }
    return {
        collectedOn,
        scope,
        accounts,
        transactions,
        activities,
        holdings,
        performance,
        gics,
        feeReports,
        coverage,
        pendingCount: list(p.pendingActivities ?? []).length,
        limits: list(p.limits ?? [], 100).map((x) => text(x)),
    };
}
