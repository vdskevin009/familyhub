import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { financeFixture } from "./finance-fixture.mjs";
import { parseFinancePreparation } from "../apps/worker/dist/finance-import.js";
import { FinanceLibrary } from "../apps/worker/dist/finance-library.js";
import {
    summarizeSpending,
    classifiedRows,
    investmentCashFlows,
    fullObservedMonth,
    expenseCategories,
    suggestClassification,
} from "../apps/worker/dist/finance-model.js";
import {
    newContract,
    contractMonthly,
    recurringTotals,
    publicBaseline,
    compareOffer,
} from "../apps/worker/dist/savings-model.js";
import {
    validateContract,
    contractSignature,
} from "../apps/worker/dist/savings-sharing-model.js";
const state = () => ({
    schema: 1,
    revision: "r",
    importedAt: "2026-10-09",
    data: parseFinancePreparation(financeFixture()),
    decisions: {},
    decisionHistory: [],
    imports: [],
});

test("one explicit pets category covers animal care without guessing ambiguous purchases", async () => {
    assert.equal(expenseCategories.pets, "Animaux de compagnie");
    assert.equal(Object.values(expenseCategories).filter(label => label === "Animaux de compagnie").length, 1);
    const s = state(), row = s.data.transactions[0];
    assert.notEqual(suggestClassification({ ...row, description: "BAKERY SYNTHETIC" }).category, "pets");
    const before = JSON.stringify(s.data);
    for (const [index, note] of ["pet food", "veterinary care", "medication", "grooming", "pet insurance"].entries()) {
        s.data.transactions.push({ ...row, id: "pet-" + index, description: "SYNTHETIC RECEIPT", outflowCents: 1000 });
        s.decisions["pet-" + index] = { nature: "expense", category: "pets", note, updatedAt: "2026-10-10T12:00:00Z" };
    }
    s.decisions.refund = { nature: "refund", category: "pets", note: "Synthetic receipt refund", updatedAt: "" };
    const summary = summarizeSpending(s, "2026-04-01", "2026-04-30");
    assert.equal(summary.categories.find(c => c.key === "pets").cents, 2550);
    assert.equal(summary.categories.find(c => c.key === "pets").count, 6);
    assert.equal(summary.categories.find(c => c.key === "groceries").cents, 12450);
    assert.deepEqual(s.data.transactions.slice(0, 13), JSON.parse(before).transactions);
});

test("explicit savings/investment flows stay outside consumption and never add paired sides or brokerage buys", () => {
    const s = state(), base = s.data.transactions.find(r => r.id === "transfer");
    s.data.transactions.push({ ...base, id: "saving-in", accountId: "rrsp", outflowCents: -50000 }, { ...base, id: "pending-saving", status: "pending", outflowCents: 99900 }, { ...base, id: "duplicate-saving", outflowCents: 50000 });
    const decision = { nature: "transfer", category: "savings-investments", note: "Explicit synthetic review", updatedAt: "" };
    s.decisions.transfer = decision; s.decisions["saving-in"] = decision; s.decisions["pending-saving"] = decision;
    s.decisions["duplicate-saving"] = { ...decision, nature: "duplicate" };
    const before = JSON.stringify(s), summary = summarizeSpending(s, "2026-01-01", "2026-12-31");
    assert.equal(summary.savings.outgoingCents, 50000); assert.equal(summary.savings.incomingCents, 50000);
    assert.equal(summary.savings.count, 2); assert.equal(summary.savings.months.length, 12);
    assert.equal(summary.savings.months[5].outgoingCents, 50000); assert.equal(summary.savings.months[5].incomingCents, 50000);
    assert.equal(summary.savings.months[9].full, false);
    assert.equal(summary.totalCents, 286199, "Source expenses unaffected by a paired savings transfer");
    assert.equal(summary.categories.find(c => c.key === "savings-investments").count, 0);
    assert.equal(summarizeSpending(s, "2026-07-01", "2026-07-31").savings.outgoingCents, 0);
    assert.equal(summarizeSpending(s, "2026-01-01", "2026-12-31", "bank").savings.incomingCents, 0);
    assert.equal(summarizeSpending(s, "2026-01-01", "2026-12-31", "", "USD").savings.outgoingCents, 0);
    assert.equal(JSON.stringify(s), before);
});

test("savings category decisions persist across restart/reimport, preserve earlier choices and reject consumption semantics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "finance-savings-category-"));
    try {
        const lib = new FinanceLibrary(dir), bundle = financeFixture();
        const first = (await lib.import({ bundle, apply: true, expectedRevision: "empty" })).state;
        const previous = await lib.decide({ id: "groceries", expectedRevision: first.revision, decision: { nature: "expense", category: "groceries", note: "Retain this choice" } });
        const originalFacts = JSON.stringify(previous.data);
        const saved = await lib.decide({ id: "transfer", expectedRevision: previous.revision, decision: { nature: "investment", category: "savings-investments", note: "A contribution, never a return" } });
        assert.deepEqual(saved.decisions.groceries, previous.decisions.groceries);
        assert.equal(JSON.stringify(saved.data), originalFacts);
        assert.equal(summarizeSpending(saved, "2026-06-01", "2026-06-30").savings.outgoingCents, 50000);
        assert.deepEqual(await new FinanceLibrary(dir).read(), saved);
        const repeat = await lib.import({ bundle, apply: true, expectedRevision: saved.revision });
        assert.equal(repeat.alreadyImported, true); assert.deepEqual(repeat.state.decisions, saved.decisions);
        for (const nature of ["expense", "refund", "income", "repayment"]) await assert.rejects(lib.decide({ id: "transfer", expectedRevision: saved.revision, decision: { nature, category: "savings-investments", note: "Invalid mixture" } }), /invalide/);
        assert.deepEqual(await lib.read(), saved);
    } finally { await rm(dir, { recursive: true, force: true }); }
});
test("adapter preserves signs, multiplicity, dates, fee reports and source references without exposing source paths", () => {
    const d = state().data;
    assert.equal(d.transactions.length, 13);
    assert.equal(d.activities.length, 7);
    assert.equal(d.pendingCount, 1);
    assert.equal(d.transactions[1].outflowCents, -2450);
    assert.equal(d.transactions[0].sources[0].name, "original.csv");
    assert.equal(JSON.stringify(d).includes("C:/"), false);
    assert.equal(d.activities[0].settleDate, "2026-09-17");
    assert.equal(d.feeReports[0].totalCents, 2000);
});
test("adapter rejects invalid cents, altered currency, malformed dates, conflicting IDs and unbalanced holdings", () => {
    for (const alter of [
        (p) => (p.bankActivities[0].signedOutflowCents = 1.5),
        (p) => (p.bankActivities[0].currency = "USD"),
        (p) => (p.bankActivities[0].transactionDate = "2026-02-30"),
        (p) => (p.bankActivities[1].id = p.bankActivities[0].id),
        (p) => (p.holdingsSnapshots[0].totalValueCents = 1),
    ]) {
        const p = financeFixture();
        alter(p);
        assert.throws(() => parseFinancePreparation(p));
    }
});
test("spending excludes repayments and transfers, nets merchant refunds and leaves mortgage principal unsplit", () => {
    const s = state(),
        summary = summarizeSpending(s, "2026-04-01", "2026-09-30");
    assert.equal(summary.totalCents, 285200);
    assert.equal(
        summary.categories.find((c) => c.key === "mortgage").cents,
        220000,
    );
    assert.equal(
        summary.categories.find((c) => c.key === "groceries").cents,
        10000,
    );
    assert.equal(
        summary.categories.find((c) => c.key === "restaurants").cents,
        6400,
    );
    assert.equal(
        summary.categories.find((c) => c.key === "childcare").cents,
        45000,
    );
    assert.equal(
        classifiedRows(s).find((r) => r.id === "unknown-credit").nature,
        "review",
    );
    assert.equal(
        summary.months.every((m) => m.full),
        true,
    );
    assert.equal(fullObservedMonth(s.data, "2026-03"), false);
    assert.equal(fullObservedMonth(s.data, "2026-10"), false);
    assert.equal(
        fullObservedMonth(s.data, "2026-09", "2026-09-05", "2026-09-30"),
        false,
    );
});
test("contributions, transfers, grants, purchases and directly charged fees remain separate", () => {
    assert.deepEqual(investmentCashFlows(state().data.activities), {
        contributionsCents: 100000,
        transfersCents: 200000,
        grantsCents: 20000,
        distributionsCents: 0,
        feesCents: 1050,
    });
});
test("private import previews without writing, archives source extensions and preserves reviewed decisions through repeat/restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "finance-unit-"));
    try {
        const library = new FinanceLibrary(dir),
            bundle = financeFixture();
        const preview = await library.import({ bundle });
        assert.equal(preview.added, 20);
        assert.deepEqual(await readdir(dir), []);
        const imported = await library.import({
            bundle,
            apply: true,
            expectedRevision: "empty",
        });
        const changed = await library.decide({
            id: "childcare",
            expectedRevision: imported.state.revision,
            decision: {
                nature: "expense",
                category: "children",
                note: "Manual category",
            },
        });
        const repeated = await library.import({
            bundle,
            apply: true,
            expectedRevision: "stale",
        });
        assert.equal(repeated.alreadyImported, true);
        assert.equal(repeated.state.revision, changed.revision);
        assert.equal(repeated.state.decisions.childcare.category, "children");
        assert.equal(repeated.state.decisionHistory.length, 1);
        const reread = await new FinanceLibrary(dir).read();
        assert.deepEqual(reread, changed);
        const [file] = await readdir(join(dir, "sources"));
        assert.deepEqual(
            JSON.parse(await readFile(join(dir, "sources", file), "utf8"))
                .unknownExtension,
            bundle.unknownExtension,
        );
        const original = await readFile(join(dir, "ledger.json"), "utf8");
        const bad = structuredClone(bundle);
        bad.bankActivities[0].debitCents++;
        bad.bankActivities[0].signedOutflowCents++;
        await assert.rejects(
            library.import({
                bundle: bad,
                apply: true,
                expectedRevision: changed.revision,
            }),
            /modifie/,
        );
        assert.equal(
            await readFile(join(dir, "ledger.json"), "utf8"),
            original,
        );
        await assert.rejects(
            library.decide({
                id: "refund",
                expectedRevision: changed.revision,
                decision: {
                    nature: "expense",
                    category: "groceries",
                    note: "",
                },
            }),
            /sens/,
        );
        await assert.rejects(
            library.decide({
                id: "childcare",
                expectedRevision: "stale",
                decision: { nature: "expense", category: "other", note: "" },
            }),
            /Actualisez/,
        );
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test("new source identity with matching occurrence is reviewable, not silently double counted; genuine repeats survive", async () => {
    const dir = await mkdtemp(join(tmpdir(), "finance-dedup-"));
    try {
        const lib = new FinanceLibrary(dir),
            bundle = financeFixture();
        const { state: first } = await lib.import({
            bundle,
            apply: true,
            expectedRevision: "empty",
        });
        const next = structuredClone(bundle);
        next.bankActivities.push({
            ...next.bankActivities[0],
            id: "new-source-identity",
        });
        const { state: second, possibleDuplicates } = await lib.import({
            bundle: next,
            apply: true,
            expectedRevision: first.revision,
        });
        assert.equal(possibleDuplicates, 1);
        assert.equal(
            classifiedRows(second).find((r) => r.id === "new-source-identity")
                .nature,
            "review",
        );
        assert.equal(
            summarizeSpending(second, "2026-04-01", "2026-09-30").totalCents,
            285200,
        );
        assert.equal(
            second.data.transactions.filter((r) => r.fingerprint === "same")
                .length,
            2,
        );
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test("concurrent stale edits cannot overwrite each other and corrupt nested values fail closed without rewriting", async () => {
    const dir = await mkdtemp(join(tmpdir(), "finance-conflict-"));
    try {
        const lib = new FinanceLibrary(dir);
        const { state: s } = await lib.import({
            bundle: financeFixture(),
            apply: true,
            expectedRevision: "empty",
        });
        const decisions = await Promise.allSettled(
            ["groceries", "restaurant"].map((id) =>
                lib.decide({
                    id,
                    expectedRevision: s.revision,
                    decision: {
                        nature: "expense",
                        category: "other",
                        note: "review",
                    },
                }),
            ),
        );
        assert.equal(
            decisions.filter((d) => d.status === "fulfilled").length,
            1,
        );
        const saved = await lib.read();
        saved.data.holdings[0].totalCents = "bad";
        const bytes = JSON.stringify(saved);
        await writeFile(join(dir, "ledger.json"), bytes);
        await assert.rejects(lib.read(), /Registre financier invalide/);
        assert.equal(await readFile(join(dir, "ledger.json"), "utf8"), bytes);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test("contracts normalize original periods and currencies once, and included services never become extra charges", () => {
    const c = {
        ...newContract("telecom", "synthetic"),
        name: "Synthetic package",
        updatedAt: "2026-10-09",
        price: 90,
        taxesIncluded: true,
        billing: {
            amount: 120,
            currency: "CAD",
            unit: "months",
            count: 1,
            asOf: "2026-10-01",
            source: "Synthetic bill",
        },
        services: [
            {
                id: "internet",
                name: "Internet",
                pricing: "shared",
                monthlyAmount: null,
                taxesIncluded: null,
                source: "Synthetic package",
            },
            {
                id: "tv",
                name: "Streaming",
                pricing: "included",
                monthlyAmount: null,
                taxesIncluded: null,
                source: "Synthetic package",
            },
        ],
    };
    assert.equal(contractMonthly(c), 120);
    assert.deepEqual(recurringTotals([c]), {
        CAD: { amount: 120, unknown: 0 },
    });
    assert.equal(publicBaseline(c).price, 120);
    assert.equal(
        JSON.stringify(publicBaseline(c)).includes("Synthetic bill"),
        false,
    );
    assert.equal(validateContract(c).services.length, 2);
    assert.ok(contractSignature(c).includes("Synthetic bill"));
    assert.equal(
        contractMonthly({
            ...c,
            billing: { ...c.billing, amount: 590, unit: "days", count: 59 },
        }),
        (365.25 / 12) * 10,
    );
    assert.equal(
        contractMonthly({ ...c, billing: { ...c.billing, amount: null } }),
        null,
    );
    assert.equal(
        publicBaseline({ ...c, billing: { ...c.billing, currency: "USD" } })
            .price,
        null,
    );
    assert.deepEqual(
        Object.keys(
            recurringTotals([
                c,
                { ...c, id: "usd", billing: { ...c.billing, currency: "USD" } },
            ]),
        ).sort(),
        ["CAD", "USD"],
    );
    assert.throws(() =>
        validateContract({
            ...c,
            services: [{ ...c.services[1], monthlyAmount: 10 }],
        }),
    );
    assert.throws(() =>
        validateContract({ ...c, billing: { ...c.billing, count: 0 } }),
    );
});

test("source identity conflicts stop safely; older imports preserve newer observations and retained reports", async () => {
    const dir = await mkdtemp(join(tmpdir(), "finance-source-identity-"));
    try {
        const lib = new FinanceLibrary(dir), bundle = financeFixture();
        const { state: first } = await lib.import({ bundle, apply: true, expectedRevision: "empty" });
        const changed = structuredClone(bundle);
        changed.accounts[0].identityFingerprint = "a-different-account";
        await assert.rejects(lib.import({ bundle: changed }), /Identité/);
        const older = structuredClone(bundle);
        older.collectedOn = "2026-10-08";
        older.accounts[0].observedBalanceCents = 100;
        older.financialDocumentFacts.feesReports = [];
        older.performanceSnapshots = [];
        const { state: second } = await lib.import({ bundle: older, apply: true, expectedRevision: first.revision });
        assert.equal(second.data.accounts[0].balanceCents, first.data.accounts[0].balanceCents);
        assert.equal(second.data.feeReports.length, 1);
        assert.equal(second.data.performance.length, 1);
        const duplicate = structuredClone(bundle);
        duplicate.brokerageActivities[0].matchingFingerprint = "same-source";
        duplicate.brokerageActivities[1].matchingFingerprint = "same-source";
        await assert.rejects(new FinanceLibrary(join(dir,"isolated")).import({ bundle: duplicate }), /dupliquée/);
        assert.equal((await lib.read()).revision, second.revision);
    } finally { await rm(dir, { recursive: true, force: true }); }
});
