import { financeFixture } from "./finance-fixture.mjs";
/** Entirely synthetic, including the merchant, dates, accounts and notes. */
export function categoryFixture() {
    const bundle = financeFixture(), template = bundle.bankActivities[0];
    bundle.accounts.push({ ...bundle.accounts[0], accountId: "usd", alias: "USD synthetic", currency: "USD" });
    const rows = [
        ["a", "MAPLE MARKET 01", "2026-09-10", "card", 1200],
        ["b", "  maple  market 01  ", "2026-08-10", "bank", 2000],
        ["c", "MAPLE MARKET 01", "2026-07-10", "card", 3000],
        ["refund", "MAPLE MARKET 01", "2026-04-10", "card", -400],
        ["transfer", "MAPLE MARKET 01", "2026-06-10", "bank", 5000],
        ["repayment", "MAPLE MARKET 01", "2026-06-11", "card", -5000],
        ["investment", "MAPLE MARKET 01", "2026-06-12", "bank", 6000],
        ["review", "MAPLE MARKET 01", "2026-06-13", "bank", 7000],
        ["duplicate", "MAPLE MARKET 01", "2026-06-14", "bank", 8000],
        ["usd", "MAPLE MARKET 01", "2026-05-10", "usd", 9000],
        ["confirmed", "MAPLE MARKET 01", "2026-08-11", "card", 1000],
        ["number", "MAPLE MARKET 02", "2026-09-10", "card", 1100],
        ["punctuation", "MAPLE-MARKET 01", "2026-09-10", "card", 1200],
        ["accent", "MAPLE MÁRKET 01", "2026-09-10", "card", 1300],
    ];
    bundle.bankActivities = rows.map(([id, descriptionOriginal, transactionDate, accountId, cents]) => ({ ...template, id, sourceRowId: id, matchingFingerprint: id, descriptionOriginal, transactionDate, accountId, currency: accountId === "usd" ? "USD" : "CAD", signedOutflowCents: cents, debitCents: cents >= 0 ? cents : null, creditCents: cents < 0 ? -cents : null }));
    return bundle;
}
export const categoryDecisions = Object.fromEntries([
    ["c", "expense", "restaurants"], ["refund", "refund", "other"], ["transfer", "transfer", "other"], ["repayment", "repayment", "other"], ["investment", "investment", "other"], ["review", "review", "other"], ["duplicate", "duplicate", "other"], ["confirmed", "expense", "groceries"],
].map(([id, nature, category]) => [id, { nature, category, note: "Synthetic retained note " + id, updatedAt: "2026-10-01T00:00:00.000Z" }]));
