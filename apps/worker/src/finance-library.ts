import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { parseFinancePreparation } from "./finance-import.js";
import { validateFinanceState } from "./finance-validation.js";
import {
    expenseCategories,
    natures,
    type FinanceState,
    type FinanceData,
    type FinanceDecision,
} from "./finance-model.js";
export class FinanceConflict extends Error {}
const empty = (): FinanceState => ({
    schema: 1,
    revision: "empty",
    importedAt: null,
    data: null,
    decisions: {},
    decisionHistory: [],
    imports: [],
});
const signature = (r: Record<string, unknown>) =>
    JSON.stringify(
        Object.fromEntries(
            Object.entries(r).filter(
                ([k]) => !["sources", "duplicateCandidate"].includes(k),
            ),
        ),
    );
async function atomic(path: string, value: unknown) {
    const temporary = path + "." + randomUUID() + ".tmp";
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await rename(temporary, path);
}
function mergeData(
    previous: FinanceData | null,
    incoming: FinanceData,
): { data: FinanceData; added: number; possibleDuplicates: number } {
    const base = previous ?? {
        ...incoming,
        accounts: [],
        transactions: [],
        activities: [],
        holdings: [],
        performance: [],
        gics: [],
        feeReports: [],
    };
    let added = 0,
        possibleDuplicates = 0;
    function rows<T extends { id: string; sources: unknown[] }>(
        old: T[],
        fresh: T[],
    ): T[] {
        const map = new Map(old.map((r) => [r.id, structuredClone(r)]));
        for (const row of fresh) {
            const saved = map.get(row.id);
            if (saved) {
                if (signature(saved) !== signature(row))
                    throw new FinanceConflict(
                        "Une source modifie une opération existante. Revue requise; aucune donnée remplacée.",
                    );
                saved.sources = [
                    ...new Map(
                        [...saved.sources, ...row.sources].map((s) => [
                            JSON.stringify(s),
                            s,
                        ]),
                    ).values(),
                ];
            } else {
                map.set(row.id, structuredClone(row));
                added++;
            }
        }
        return [...map.values()];
    }
    const transactions = rows(base.transactions, incoming.transactions);
    const seen = new Set<string>();
    for (const row of transactions) {
        const key = `${row.accountId}:${row.fingerprint}:${row.occurrence}`;
        if (
            row.fingerprint &&
            seen.has(key) &&
            !base.transactions.some((p) => p.id === row.id)
        ) {
            row.duplicateCandidate = true;
            possibleDuplicates++;
        }
        if (row.fingerprint) seen.add(key);
    }
    const activities = rows(base.activities, incoming.activities);
    const activityKeys = new Set<string>();
    for (const row of activities) {
        const key = `${row.accountId}:${row.fingerprint}:${row.occurrence}`;
        if (row.fingerprint && activityKeys.has(key))
            throw new FinanceConflict(
                "Activité de placement possiblement dupliquée. Rapprochez les sources avant d'importer.",
            );
        if (row.fingerprint) activityKeys.add(key);
    }
    for (const a of incoming.accounts) {
        const old = base.accounts.find((p) => p.id === a.id);
        if (
            old &&
            (old.currency !== a.currency ||
                old.type !== a.type ||
                old.identity !== a.identity)
        )
            throw new FinanceConflict(
                "Identité/type/devise du compte modifiés. Import arrêté.",
            );
    }
    // No replacement by an older collection; records outside the new window remain archived in the ledger.
    const latest = incoming.collectedOn >= base.collectedOn ? incoming : base;
    const accounts = [
        ...new Map(
            [...base.accounts, ...incoming.accounts].map((a) => [a.id, a]),
        ).values(),
    ].map((a) => latest.accounts.find((l) => l.id === a.id) ?? a);
    const holdings = [
        ...new Map(
            [...base.holdings, ...incoming.holdings].map((h) => [
                JSON.stringify(h),
                h,
            ]),
        ).values(),
    ];
    for (const h of incoming.holdings) {
        const prior = base.holdings.find(
            (p) => p.accountId === h.accountId && p.asOf === h.asOf,
        );
        if (
            prior &&
            JSON.stringify({ ...prior, source: null }) !==
                JSON.stringify({ ...h, source: null })
        )
            throw new FinanceConflict(
                "Valeurs différentes pour un même instantané de positions. Revue requise.",
            );
    }
    const feeReports = [
        ...new Map(
            [...base.feeReports, ...incoming.feeReports].map((r) => [
                JSON.stringify(r),
                r,
            ]),
        ).values(),
    ];
    const performance = [
        ...new Map(
            [...base.performance, ...incoming.performance].map((r) => [
                JSON.stringify(r),
                r,
            ]),
        ).values(),
    ];
    const gics = [
        ...new Map(
            [...base.gics, ...incoming.gics].map((r) => [JSON.stringify(r), r]),
        ).values(),
    ];
    return {
        data: {
            ...latest,
            accounts,
            transactions,
            activities,
            holdings,
            feeReports,
            performance,
            gics,
        },
        added,
        possibleDuplicates,
    };
}
export class FinanceLibrary {
    private queue: Promise<unknown> = Promise.resolve();
    constructor(private directory: string) {}
    private serialized<T>(fn: () => Promise<T>): Promise<T> {
        const p = this.queue.then(fn);
        this.queue = p.catch(() => {});
        return p;
    }
    async read(): Promise<FinanceState> {
        let value: string;
        try {
            value = await readFile(join(this.directory, "ledger.json"), "utf8");
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "ENOENT") return empty();
            throw e;
        }
        return validateFinanceState(JSON.parse(value));
    }
    import(value: {
        bundle?: unknown;
        expectedRevision?: unknown;
        apply?: unknown;
    }) {
        return this.serialized(async () => {
            const data = parseFinancePreparation(value.bundle),
                current = await this.read();
            const raw = JSON.stringify(value.bundle),
                hash = createHash("sha256").update(raw).digest("hex");
            if (current.imports.some((i) => i.hash === hash))
                return {
                    state: current,
                    added: 0,
                    possibleDuplicates: 0,
                    alreadyImported: true,
                };
            const merged = mergeData(current.data, data);
            if (value.apply !== true)
                return {
                    added: merged.added,
                    possibleDuplicates: merged.possibleDuplicates,
                    accounts: data.accounts.length,
                    from: data.scope.from,
                    to: data.scope.to,
                    revision: current.revision,
                };
            if (value.expectedRevision !== current.revision)
                throw new FinanceConflict(
                    "Les finances ont changé. Actualisez avant de confirmer l’import.",
                );
            await mkdir(join(this.directory, "sources"), { recursive: true });
            // Archive the exact complete source, including original dates, paths and extension fields; never publish it.
            try {
                await writeFile(
                    join(this.directory, "sources", hash + ".json"),
                    raw,
                    { flag: "wx", mode: 0o600 },
                );
            } catch (e) {
                if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
            }
            const at = new Date().toISOString();
            const state: FinanceState = {
                ...current,
                data: merged.data,
                revision: randomUUID(),
                importedAt: at,
                imports: [
                    ...current.imports,
                    { hash, at, added: merged.added },
                ],
            };
            if (current.data)
                await atomic(
                    join(
                        this.directory,
                        "before-" + current.revision + ".json",
                    ),
                    current,
                );
            await atomic(join(this.directory, "ledger.json"), state);
            return {
                state,
                added: merged.added,
                possibleDuplicates: merged.possibleDuplicates,
                alreadyImported: false,
            };
        });
    }
    decide(value: {
        id?: unknown;
        expectedRevision?: unknown;
        decision?: unknown;
    }) {
        return this.serialized(async () => {
            const state = await this.read();
            if (state.revision !== value.expectedRevision)
                throw new FinanceConflict(
                    "Une autre modification a été enregistrée. Actualisez avant de réessayer.",
                );
            if (
                typeof value.id !== "string" ||
                !state.data?.transactions.some((r) => r.id === value.id)
            )
                throw new Error("Opération introuvable.");
            const d = value.decision as FinanceDecision;
            if (
                !d ||
                !Object.hasOwn(natures, d.nature) ||
                !Object.hasOwn(expenseCategories, d.category) ||
                typeof d.note !== "string" ||
                d.note.length > 1000
            )
                throw new Error("Décision invalide.");
            const row = state.data.transactions.find((r) => r.id === value.id)!;
            if (
                (d.nature === "refund" && row.outflowCents >= 0) ||
                (d.nature === "expense" && row.outflowCents < 0)
            )
                throw new Error(
                    "Le sens débit/crédit de la source doit être conservé.",
                );
            const at = new Date().toISOString(),
                decision = {
                    nature: d.nature,
                    category: d.category,
                    note: d.note,
                    updatedAt: at,
                };
            const next: FinanceState = {
                ...state,
                revision: randomUUID(),
                decisions: { ...state.decisions, [value.id]: decision },
                decisionHistory: [
                    ...state.decisionHistory,
                    {
                        id: value.id,
                        previous: state.decisions[value.id] ?? null,
                        decision,
                        at,
                    },
                ],
            };
            await atomic(join(this.directory, "ledger.json"), next);
            return next;
        });
    }
}
