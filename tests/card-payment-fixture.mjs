import { financeFixture } from "./finance-fixture.mjs";

/** Synthetic paired settlement with real spending alongside it; no private data. */
export function cardPaymentFixture() {
    const bundle = financeFixture(), base = bundle.bankActivities[0];
    bundle.bankActivities = [
        ["fixture-expense", "SYNTHETIC PURCHASE", 4000, "card"],
        ["fixture-refund", "SYNTHETIC REFUND", -1000, "card"],
        ["fixture-card-repayment", "PAYMENT-THANKYOU SYNTHETIC", -135000, "card"],
        ["fixture-bank-transfer", "TFR-TO C/C SYNTHETIC", 135000, "bank"],
    ].map(([id, descriptionOriginal, cents, accountId], index) => ({
        ...base, id, sourceRowId: id, matchingFingerprint: id, accountId,
        transactionDate: "2026-09-05", descriptionOriginal,
        debitCents: cents > 0 ? cents : null, creditCents: cents < 0 ? -cents : null,
        signedOutflowCents: cents, source: { ...base.source, record: index + 2 },
    }));
    return bundle;
}

export const cardPaymentDecisions = {
    "fixture-refund": { nature: "refund", category: "other", note: "Synthetic evidenced refund", updatedAt: "2026-10-10T12:00:00Z" },
};
