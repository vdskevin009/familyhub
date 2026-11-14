# FH-GROCERY-015: Purchase-only Courses and monthly PC Express history

Status: Testing. Source implementation and synthetic validation are separate from deployment and complete Gmail history acceptance. Tracks #155.

Courses now opens only Achats. Catalogue and Moins cher navigation are removed; old tab bookmarks converge on Achats. Existing shared planning data, source records, review controls, and per-purchase comparisons remain unchanged.

The monthly chart aggregates all available saved PC Express records, including archives. Reviewed final receipts contribute to verified paid amounts. Confirmation totals form a separate estimated series, never added to the paid series or called bank spending. Receipt/confirmation source date assigns the month, rather than ingestion or delivery date. Currency/year selectors never mix units; no-data months mean unknown, not zero spend.

Deduplicate an explicit PC Express order reference across accounts, preferring a reviewed final receipt over its confirmation. Contradictory same-kind amounts/dates/currencies are excluded visibly rather than selecting one. Unknown source type, unreviewed final receipt, missing amount/date/currency and marked duplicates cannot inflate totals. Equal prices/dates/names alone never establish identity.

Data coverage is explicit: earliest/latest usable source dates are not full-mailbox completeness. Current records cannot certify exhaustive Kevin/Jasmine history, cancellations or refunds. Card authorizations, inferred charges and fabricated refunds are never summed. The view is read-only and preserves all source records.

Implementation: grocery-monthly-spending.ts, GroceryMonthlySpending.tsx, CoursesView.tsx. Validation: tests/grocery-monthly-spending.test.ts and apps/web/tests/grocery-monthly-spending-browser.mjs. Deployment, real imported-history completeness and phone acceptance remain separate gates.
