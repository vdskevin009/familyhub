# Finances full feed source contract

FH-FIN-001 / FH-FIN-003 / FH-FIN-010; presentation FH-FIN-022.

Local implementation only. `finances-full-feed.ts` prepares a private additive bundle and exposes optional `syncFinanceFeed` orchestration through the existing paired Finance API. It does not start a collector, enable a schedule, install a worker, or claim a live import.

## Retrieval and identity

1. Read Finances linked accounts. Resolve each source item/account pair to an explicitly reviewed existing FamilyHub account identity. Last-four, name, balance and similarity are never identity.
2. Build all three requests with `financeFeedQueries`: transactions (all signs, pending included, transfers included), investment holdings and investment transactions. Preserve returned category/linkage evidence in the raw archive; no category filter or positive-only spending query.
3. Retrieve every page, unchanged request except its cursor. Store the exact query and each request cursor. Coverage and terminal cursor are independent: terminal pages never certify source completeness.
4. Resolve bank transactions explicitly to a prior ledger ID or reviewed new source identity using the existing adapter. Existing description, amount, date, identity and decisions remain authoritative. Ambiguous possible duplicates stop preview/apply.
5. Call `prepareFinanceFeed`, review withheld information and paired preview, then use `syncFinanceFeed` only when the private mapping/import has been authorized. Uncertain applies get one readback and never an automatic replay.

All queries, mappings and raw responses belong only to the private import evidence archive. No real account, holding, merchant, amount, beneficiary or credential belongs in Git.

## Dates and coverage

Retrieval time is not source freshness. Bank balances update only from balance_date or a timestamp explicitly identified as source_reported, not record-update or sync metadata. Older and future-dated observations do not replace the existing balance.

The bank transaction adapter currently requires full-history, complete, ready coverage with no warnings. Partial bank history therefore fails closed rather than silently dropping older data or weakening trend coverage.

Investment holdings require complete coverage, explicit source_as_of for the position snapshot on every page, unique source security identities and explicit cash-equivalent flags. A security price date cannot date the position quantity. This source_as_of is a gate for future admissible evidence, not a claim that today's plugin returns it. Unqualified snapshots remain in the raw private evidence only, while prior holdings remain authoritative.

The investment date field is settlement and transaction_datetime is order initiation, not execution. All plugin investment activities, including original trades and cancellation links, remain together in raw private evidence without entering the legacy trade-date/action-code ledger. A separate execution-aware model or source is required before those records can drive cash-flow summaries. Prior historical activities stay intact. No trade date, zero holdings, grant, maturity, performance or contribution room is invented.

## Observed availability and acceptance

A live read during this implementation returned linked accounts and bank transactions, with transaction full_history coverage but unknown freshness. Both investment queries returned empty items without coverage metadata. Account balance source dates were unavailable. These responses establish neither zero investments nor current balances. Private values were not written into source files.

Ten synthetic adapter/orchestration tests cover query scope, cursor completion, explicit identity, preserved history, source dates, unknown investment coverage and qualifying holdings evidence, conflicting same-time balances, strict source dates and withheld cancellation pairs. Local worker typecheck also passes. Live account mapping, exhaustive retrieval, paired import/readback, installed worker activation and daily orchestration remain separate acceptance gates. Existing historical positions must remain visible with their original dates until better source evidence exists.

Run: `node --import tsx --test tests/finances-full-feed.test.mjs`.



The private CLI is scripts/Sync-FinanceFeed.mjs. Its input is finance-feed/prepared-evidence.json under an explicitly supplied private worker data directory; run with node --import tsx. Default is preview. Apply requires --apply and an exact reviewed ledger revision; there is no automatic replacement of a stale review, no provider refresh, no schedule, and no contribution-plan mutation. Sanitized output contains counts/outcome only.
