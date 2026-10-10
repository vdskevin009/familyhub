import { financeFixture } from "./finance-fixture.mjs";

/** Invented source rows for comparisons; never household data or screenshot values. */
export function trendsFixture() {
    const bundle = financeFixture(), base = bundle.bankActivities[0];
    const decisions = {}, rows = [];
    const add = (id, date, cents, accountId, nature, category, status = "posted") => {
        rows.push({ ...base, id, sourceRowId: id, matchingFingerprint: id, accountId, transactionDate: date,
            descriptionOriginal: `SYNTHETIC ${id}`, signedOutflowCents: cents,
            debitCents: cents > 0 ? cents : null, creditCents: cents < 0 ? -cents : null, status,
            source: { ...base.source, record: rows.length + 2 } });
        decisions[id] = { nature, category, note: "Synthetic evidence", updatedAt: "2026-10-10T12:00:00Z" };
    };
    for (let index = 0; index < 6; index++) {
        const month = `2026-${String(index + 4).padStart(2, "0")}`;
        add(month + "-food", month + "-05", 10000 + index * 1000, "card", "expense", "groceries");
        add(month + "-refund", month + "-07", -1000, "card", "refund", "groceries");
        add(month + "-meal", month + "-20", 5000, "card", "expense", "restaurants");
        add(month + "-housing", month + "-02", 60000, "bank", "expense", "housing");
        add(month + "-card-payment", month + "-08", -135000, "card", "repayment", "other");
        add(month + "-transfer", month + "-08", 135000, "bank", "transfer", "other");
    }
    add("oct-food", "2026-10-05", 20000, "card", "expense", "groceries");
    add("oct-refund", "2026-10-07", -2000, "card", "refund", "groceries");
    add("oct-housing", "2026-10-02", 60000, "bank", "expense", "housing");
    add("oct-card-payment", "2026-10-08", -135000, "card", "repayment", "other");
    add("oct-transfer", "2026-10-08", 135000, "bank", "transfer", "other");
    bundle.bankActivities = rows;
    bundle.pendingActivities = [{ status: "pending" }, { status: "pending" }];
    return { bundle, decisions };
}
