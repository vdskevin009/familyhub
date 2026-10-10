/** Private, deterministic finance model. Money is integer cents; source facts are never decisions. */
export const expenseCategories = {
    groceries: "Épicerie",
    restaurants: "Restaurants et livraison",
    housing: "Logement",
    mortgage: "Hypothèque (versement)",
    utilities: "Énergie et services publics",
    transport: "Transport",
    childcare: "Garde d’enfants",
    children: "Enfant et famille",
    subscriptions: "Abonnements",
    communications: "Téléphone et internet",
    health: "Santé",
    recreation: "Loisirs et sport",
    clothing: "Vêtements",
    household: "Maison et achats",
    travel: "Voyages",
    fees: "Frais financiers",
    exceptional: "Projets exceptionnels",
    "savings-investments": "Épargne / Investissements",
    other: "À catégoriser",
} as const;
export type ExpenseCategory = keyof typeof expenseCategories;
export const natures = {
    expense: "Dépense",
    refund: "Remboursement",
    income: "Revenu",
    transfer: "Transfert",
    repayment: "Paiement de carte",
    investment: "Placement / cotisation",
    duplicate: "Doublon confirmé",
    review: "À vérifier",
} as const;
export type Nature = keyof typeof natures;
export function decisionCategoryAllowed(category: string, nature: string): boolean {
    return category !== "savings-investments" || ["transfer", "investment", "review", "duplicate"].includes(nature);
}
export type Evidence = {
    name: string;
    sha256?: string;
    record?: number;
    page?: number;
    detail?: string;
};
export type FinanceAccount = {
    id: string;
    identity: string;
    name: string;
    type: string;
    currency: string;
    balanceCents: number | null;
    asOf: string;
    source: Evidence;
};
export type FinanceTransaction = {
    id: string;
    accountId: string;
    date: string;
    description: string;
    currency: string;
    outflowCents: number;
    status: string;
    occurrence: number;
    fingerprint: string;
    hints: string[];
    sources: Evidence[];
    duplicateCandidate?: boolean;
};
export type FinanceActivity = {
    id: string;
    accountId: string;
    date: string;
    settleDate: string;
    description: string;
    action: string;
    currency: string;
    netCashCents: number;
    commissionCents: number | null;
    quantity: string;
    price: string;
    occurrence: number;
    fingerprint: string;
    sources: Evidence[];
};
export type FinanceHolding = {
    accountId: string;
    asOf: string;
    currency: string;
    cashCents: number;
    totalCents: number;
    positions: {
        symbol: string;
        name: string;
        quantity: string;
        price: string;
        marketCents: number;
        bookCents: number | null;
    }[];
    source: Evidence;
};
export type FinancePerformance = {
    accountId: string;
    from: string;
    to: string;
    method: string;
    trend: { date: string; balanceCents: number }[];
};
export type FinanceGic = {
    accountId: string;
    principalCents: number;
    currency: string;
    issueDate: string;
    maturityDate: string;
    annualRate: string;
    source: Evidence;
};
export type FinanceDecision = {
    nature: Nature;
    category: ExpenseCategory;
    note: string;
    updatedAt: string;
};
export type FinanceCoverage = {
    accountId: string;
    earliest: string | null;
    latest: string | null;
    warning: string | null;
};
export type FinanceFeeReport = {
    accountId: string;
    from: string;
    to: string;
    currency: string;
    totalCents: number;
    description: string;
    source: Evidence;
};
export type FinanceData = {
    scope: { from: string; to: string };
    collectedOn: string;
    accounts: FinanceAccount[];
    transactions: FinanceTransaction[];
    activities: FinanceActivity[];
    pendingCount: number;
    holdings: FinanceHolding[];
    performance: FinancePerformance[];
    gics: FinanceGic[];
    feeReports: FinanceFeeReport[];
    coverage: FinanceCoverage[];
    limits: string[];
};
export type FinanceState = {
    schema: 1;
    revision: string;
    importedAt: string | null;
    data: FinanceData | null;
    decisions: Record<string, FinanceDecision>;
    decisionHistory: {
        id: string;
        previous: FinanceDecision | null;
        decision: FinanceDecision;
        at: string;
    }[];
    imports: { hash: string; at: string; added: number }[];
};

const categoryRules: [ExpenseCategory, RegExp][] = [
    [
        "groceries",
        /\b(SAVE[ -]?ON|SAFEWAY|THRIFTY|WHOLE FOODS|T&T SUPERMARKET|SUPERSTORE|IGA|FRESH[ -]?CO|NO FRILLS|GROCERY|GROCERIES)\b/i,
    ],
    [
        "restaurants",
        /UBER\s*EATS|DOORDASH|SKIPTHEDISHES|RESTAURANT|PIZZA|SUSHI|STARBUCKS|TIM HORTON|MCDONALD|CAFE|COFFEE|BISTRO/i,
    ],
    ["mortgage", /\bMTG\b|MORTGAGE|HYPOTH[EÈ]QUE/i],
    ["housing", /STRATA|PROPERTY TAX|RENT PAYMENT/i],
    ["utilities", /BC HYDRO|FORTIS|WATER UTILITY/i],
    [
        "communications",
        /SHAW|ROGERS|TELUS|FIDO|BELL CANADA|KOODO|FREEDOM MOBILE/i,
    ],
    [
        "subscriptions",
        /NETFLIX|SPOTIFY|DISNEY|CHATGPT|OPENAI|ANTHROPIC|MICROSOFT.*SUB|AMAZON PRIME|YOUTUBE PREMIUM/i,
    ],
    [
        "childcare",
        /DAYCARE|CHILDCARE|CHILD CARE|GARDERIE|TWIG\s*(?:\+|AND|&)\s*OWL/i,
    ],
    ["children", /BABY|BABIES|TOYS R US|CHILDREN.?S PLACE/i],
    [
        "transport",
        /ICBC|TRANSLINK|COMPASS|PARKING|PETRO|CHEVRON|SHELL|ESSO|\bUBER\b|\bLYFT\b/i,
    ],
    ["health", /PHARMACY|DENTAL|DENTIST|PHYSIO|CHIROPRACTIC|MASSAGE|OPTOMET/i],
    ["recreation", /CLASSPASS|ATHLETICS|FITNESS|\bGYM\b|RECREATION|GOLF/i],
    ["fees", /MONTHLY.*FEE|SERVICE.*FEE|ANNUAL FEE|OVERDRAFT|INTEREST CHARGE/i],
    ["travel", /AIR CANADA|WESTJET|AIRBNB|HOTEL|EXPEDIA|BOOKING.COM/i],
];
export function suggestClassification(
    row: FinanceTransaction,
    account?: FinanceAccount,
): { nature: Nature; category: ExpenseCategory; reason: string } {
    const d = row.description;
    if (row.duplicateCandidate)
        return {
            nature: "review",
            category: "other",
            reason: "Source similaire : doublon possible, décision requise",
        };
    if (
        /PAYMENT.*THANK|PAIEMENT.*MERCI|VISA.*(PAYMENT|PYMT)|PAYMENT.*VISA|CARD PAYMENT/i.test(
            d,
        ) ||
        row.hints.includes("card-payment-transfer-review")
    )
        return {
            nature: "repayment",
            category: "other",
            reason: "Paiement de carte proposé",
        };
    if (/\b(TFR|TRANSFER TO|TRANSFER FROM|XFER|TRSF)\b/i.test(d))
        return {
            nature: "transfer",
            category: "other",
            reason: "Transfert proposé, à vérifier",
        };
    if (row.hints.includes("transfer-or-investment-review"))
        return {
            nature: "review",
            category: "other",
            reason: "Transfert, cotisation ou dépense à déterminer",
        };
    const category = categoryRules.find(([, re]) => re.test(d))?.[0] ?? "other";
    if (row.outflowCents < 0) {
        if (account?.type === "credit-card" && category !== "other")
            return {
                nature: "refund",
                category,
                reason: "Crédit commerçant proposé, à vérifier",
            };
        return {
            nature: "review",
            category,
            reason: "Crédit : revenu, remboursement ou transfert à déterminer",
        };
    }
    return {
        nature: "expense",
        category,
        reason:
            category === "other"
                ? "Catégorie inconnue"
                : "Suggestion à partir du libellé, à vérifier",
    };
}
export function classifiedRows(state: FinanceState) {
    return (state.data?.transactions ?? []).map((row) => ({
        ...row,
        ...suggestClassification(
            row,
            state.data?.accounts.find((a) => a.id === row.accountId),
        ),
        ...state.decisions[row.id],
        reviewed: Boolean(state.decisions[row.id]),
    }));
}
export function monthRange(from: string, to: string): string[] {
    if (
        !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
        from > to
    )
        return [];
    const months: string[] = [];
    let cursor = from.slice(0, 7);
    while (cursor <= to.slice(0, 7) && months.length < 240) {
        months.push(cursor);
        const [y, m] = cursor.split("-").map(Number);
        cursor = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
    }
    return months;
}
export function fullObservedMonth(
    data: FinanceData,
    month: string,
    from = data.scope.from,
    to = data.scope.to,
) {
    const start = month + "-01",
        end = new Date(
            Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
        )
            .toISOString()
            .slice(0, 10);
    return (
        from <= start &&
        to >= end &&
        data.scope.from <= start &&
        data.scope.to >= end &&
        !data.coverage.some(
            (c) => c.warning && (!c.earliest || c.earliest > start),
        )
    );
}
export function summarizeSpending(
    state: FinanceState,
    from: string,
    to: string,
    accountId = "",
    currency = "CAD",
) {
    const rows = classifiedRows(state).filter(
        (r) =>
            r.date >= from &&
            r.date <= to &&
            (!accountId || r.accountId === accountId) &&
            r.currency === currency &&
            r.status === "posted",
    );
    const included = rows.filter(
        (r) => r.category !== "savings-investments" && (r.nature === "expense" || r.nature === "refund"),
    );
    // Explicit bank decisions only. Incoming transfer sides and brokerage activities
    // are never added to outgoing flows or treated as consumption/returns.
    const savingRows = rows.filter(r => r.reviewed && r.category === "savings-investments" && ["transfer", "investment"].includes(r.nature));
    const flowTotal = (selected: typeof savingRows, outgoing: boolean) => selected.reduce((sum, r) => sum + (outgoing ? Math.max(0, r.outflowCents) : Math.max(0, -r.outflowCents)), 0);
    const categories = Object.keys(expenseCategories).map((key) => ({
        key: key as ExpenseCategory,
        cents: included
            .filter((r) => r.category === key)
            .reduce((s, r) => s + r.outflowCents, 0),
        count: included.filter((r) => r.category === key).length,
    }));
    const months = monthRange(from, to).map((month) => ({
        month,
        cents: included
            .filter((r) => r.date.startsWith(month))
            .reduce((s, r) => s + r.outflowCents, 0),
        full: Boolean(
            state.data && fullObservedMonth(state.data, month, from, to),
        ),
    }));
    return {
        rows,
        included,
        categories,
        months,
        savings: {
            outgoingCents: flowTotal(savingRows, true),
            incomingCents: flowTotal(savingRows, false),
            count: savingRows.length,
            months: months.map(m => ({ ...m, outgoingCents: flowTotal(savingRows.filter(r => r.date.startsWith(m.month)), true), incomingCents: flowTotal(savingRows.filter(r => r.date.startsWith(m.month)), false) })),
        },
        totalCents: included.reduce((s, r) => s + r.outflowCents, 0),
        reviewCount: rows.filter(
            (r) =>
                r.nature === "review" ||
                (r.category === "other" && r.nature === "expense"),
        ).length,
        unreviewedCount: rows.filter((r) => !r.reviewed).length,
    };
}
export function investmentCashFlows(activities: FinanceActivity[]) {
    const sum = (actions: string[]) =>
        activities
            .filter((a) => actions.includes(a.action))
            .reduce((s, a) => s + a.netCashCents, 0);
    return {
        contributionsCents: sum(["CONT"]),
        transfersCents: sum(["TFR-IN", "TFR-OUT"]),
        grantsCents: sum(["CESG"]),
        distributionsCents: sum(["INT", "DIV"]),
        feesCents: -sum(["MGTFEE", "ACTFEE", "GST"]),
    };
}

/** Exact merchant/account groups only. Observed charges are not subscriptions or projected savings. */
export function recurringObservations(rows: ReturnType<typeof classifiedRows>) {
    const groups = new Map<string, typeof rows>();
    for (const row of rows.filter(
        (r) =>
            r.nature === "expense" &&
            ["subscriptions", "communications", "fees"].includes(r.category),
    )) {
        const key = [
            row.accountId,
            row.currency,
            row.description.trim().toUpperCase(),
        ].join(":");
        groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return [...groups.values()]
        .filter((group) => group.length >= 2)
        .map((group) => {
            const sorted = group
                .slice()
                .sort(
                    (a, b) =>
                        a.date.localeCompare(b.date) ||
                        a.id.localeCompare(b.id),
                );
            const latest = sorted.at(-1)!,
                previous = sorted.at(-2)!;
            return {
                latest,
                previous,
                count: sorted.length,
                totalCents: sorted.reduce((s, r) => s + r.outflowCents, 0),
                changeCents: latest.outflowCents - previous.outflowCents,
            };
        })
        .sort(
            (a, b) =>
                b.changeCents - a.changeCents || b.totalCents - a.totalCents,
        );
}
