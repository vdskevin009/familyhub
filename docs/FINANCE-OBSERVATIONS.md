# Received balance observations (FH-FIN-023)

A received provider amount is a separate observation, not a rewrite of a historical bank-dated balance. The UI associates the amount with capturedAt and an explicit local timezone. sourceAsOf stays null when unknown. Historical accounts, source dates, holdings, transactions, performance, scope, coverage, pending counts, limits and decisions remain intact. All three finance tabs share the capture note with its account count; it never asserts every dataset was refreshed.

## Private paired import

Require GET /health capability finance-balance-observations-v1 before preview or apply. POST /finances/import keeps the existing pairing, origin, no-store, revision, archive and idempotence rules. No new endpoint or collection trigger is introduced.

The preparation schema remains familyhub.td.preparation.v1. An explicit importMode of balance-observations-only requires an existing ledger and unchanged copied account identity/name/type/currency/balance/source/date fields for exactly the observed accounts. Supply collection: { retrievedAt, accountIds } and balanceObservations: [{ accountId, currency, balanceCents, capturedAt, sourceAsOf, source: { file, sha256 } }]. retrievedAt and capturedAt require exact ISO timestamps with a timezone and must agree. Explicit captures more than five minutes ahead of the import clock fail before any write. sourceAsOf is null or an original source date/timestamp no later than capture. Include the original source evidence in the private archived bundle; never publish it.

Provide the existing scope and collectedOn date, with empty bankActivities, brokerageActivities, holdingsSnapshots, coverage, pendingActivities and limits. Any attempted financial dataset, account-field modification, unknown identity, currency mismatch, same-time amount contradiction or missing source digest fails closed. This mode merges only immutable observations. It never replaces global metadata, even for a newer capture. Preview reports observation count and capability. Apply/readback must contain each exact amount/currency/capture/source-date/provenance tuple before success; an uncertain POST is not automatically repeated.

## Compatibility and history

FinanceData.balanceObservations and imports[].collection are additive. Old ledgers remain readable; older clients ignore these fields. New clients refuse observation imports to workers without the capability. Missing metadata in old-worker responses renders unknown, not importedAt or data.collectedOn. The latest import can recover collection metadata from its hash-verified private source archive, using pluginEvidence.retrievedAt and its explicit account map. This is a read-only projection, not a ledger migration. Missing, invalid, mismatched or oversized evidence remains unknown. No search of older imports is passed off as the last collection.

The latest eligible capture drives the displayed received amount only until a later bank-dated value supersedes it. Received history remains accessible in either case. Future captures never win selection. Original historical amounts and source evidence remain available in the account details. Observations are never summed across currencies/dates or treated as holdings, performance, contribution room or available spending cash.

## Validation and release

Synthetic tests cover partial 2-of-9 account updates, preservation, preview, replay, restart, contradictions, timestamps, malformed input, archived hash verification, missing evidence, old-worker capability refusal and exact response verification. Browser checks cover 320/390/768/1440px, timezone presentation, all three tabs, repeated detail/back, historical visibility and honest read-only reload. Source private values are never test fixtures.

Exact CI, Pages, installed-worker capability, private two-account import/readback, and the broader unmapped-account inventory are separate acceptance gates. No live runtime or private import is changed by these files.
