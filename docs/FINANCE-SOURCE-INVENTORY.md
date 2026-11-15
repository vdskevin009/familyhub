# Private source inventory foundation (FH-FIN-022)

Prepared in isolation, not activated or published. The parent finance change owns REQUIREMENTS.md and route integration. This additive foundation extends the distinction between source collection time and bank as-of dates to accounts without an attested canonical identity, credit metadata and recurring forecasts. It does not register a route, collect sources, modify the canonical ledger or change any deployed worker.

## Contract

- `FinanceSourceInventory` in `finance-source-inventory-model.ts` is the strict minimal display input. All fields are required, with explicit null for unknown monetary/date values. Extra fields fail closed at every level. Monetary values retain signed integer cents and a three-letter currency; no sum exists.
- `financeSourceKey(kind, itemId, recordId)` creates a stable namespaced SHA-256 key. Raw provider IDs remain transient inputs to this helper and never belong in the inventory. Human display labels must be minimized upstream; this validator is not a general secret detector.
- Every inventory account is `not-reconciled`. No canonical ID, account matching, ledger row or inferred mapping is accepted. The integrating adapter must omit already-attested canonical accounts from this inventory and must not substitute names or balances for identity evidence.
- `collectedAt` is the collection timestamp, not a bank update date. Each monetary observation has an independent nullable `sourceAsOf`. Only an explicit bank balance/statement date belongs there, never a record-update date. Collection dates more than five minutes beyond import time are rejected. Observed source dates cannot be later than collection (timestamp tolerance: five minutes). Predictions and due dates can legitimately be future dates.
- Empty holdings/activity with unknown coverage remain unavailable. Completeness must come from genuine coverage evidence, not array length. Account and recurring counts describe the admitted inventory scope only. Budgets/goals are explicitly not provided; existing records elsewhere remain unchanged.
- Credit statement and minimum-payment observations carry independent dates. The due date is a separate field and never proves nonpayment. Recurring entries are always forecasts, even when their predicted date has passed. They never feed bills, spending or totals.

## Private storage and integration

Construct one worker-owned `FinanceSourceInventoryStore(existingPrivateDataDirectory)`. Its only file is `finance/source-inventory.json` under that directory, separate from all canonical data. Do not pass a repository, public assets or build directory. `read(now?)` returns `{revision, snapshot}`; a missing file is `{revision: "empty", snapshot: null}`. `save(minimalSnapshot, expectedRevision, now?)` validates, serializes writes, rejects stale/same-time contradictory snapshots, publishes atomic private bytes and verifies readback. Replays with the current revision are no-ops. Invalid existing files are retained and block replacement. No automatic retry is provided.

One store instance must own writes in the worker process; this is not a cross-process locking API. Callers must use the existing pairing/origin/no-store boundary and validate the response before rendering. The model has no network or canonical-ledger dependency. The server-side store/hash module must never be bundled into the web application.

Render `FinanceSourceInventory({snapshot, now?})` from the existing finance screen and import `finance-source-inventory.css` in that screen. It supplies no navigation, fetch or browser persistence. It shows per-amount collection timestamps, bank-date unknowns, explicit non-reconciliation, independent credit dates, availability and labeled forecasts. A collection older than 24 hours is labeled separately from unknown bank freshness. Native details keep coverage, credit facts and forecasts compact and keyboard accessible.

## Synthetic verification

No tests read private source files. With existing verified matching dependencies:

```
node --import tsx --test tests/finance-source-inventory.test.mjs
node node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json --test tests/finance-source-inventory-view.test.tsx
node node_modules/typescript/bin/tsc -p apps/worker/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit
```

Focused tests are separate from aggregate checks, authenticated API integration, live-source ingestion, browser integration, publication and production acceptance. Those gates remain with the parent task.
