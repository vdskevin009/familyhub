# Private source inventory (FH-FIN-024; complements FH-FIN-022/023)

Locally integrated and synthetically tested, not activated or published. This additive inventory extends the distinction between source collection time and bank as-of dates to accounts without an attested canonical identity, credit metadata and recurring forecasts. It adds a paired API and read-only panel but does not collect sources, modify the canonical ledger or change any deployed worker.

## Contract

- `FinanceSourceInventory` in `finance-source-inventory-model.ts` is the strict minimal display input. All fields are required, with explicit null for unknown monetary/date values. Extra fields fail closed at every level. Monetary values retain signed integer cents and a three-letter currency; no sum exists.
- `financeSourceKey(kind, itemId, recordId)` creates a stable namespaced SHA-256 key. Raw provider IDs remain transient inputs to this helper and never belong in the inventory. Human display labels must be minimized upstream; this validator is not a general secret detector.
- Every inventory account is `not-reconciled`. No canonical ID, account matching, ledger row or inferred mapping is accepted. The integrating adapter must omit already-attested canonical accounts from this inventory and must not substitute names or balances for identity evidence.
- `collectedAt` is the collection timestamp, not a bank update date. Each monetary observation has an independent nullable `sourceAsOf`. Only an explicit bank balance/statement date belongs there, never a record-update date. Collection dates more than five minutes beyond import time are rejected. Observed source dates cannot be later than collection (timestamp tolerance: five minutes). Predictions and due dates can legitimately be future dates.
- Empty holdings/activity with unknown coverage remain unavailable. Completeness must come from genuine coverage evidence, not array length. Account and recurring counts describe the admitted inventory scope only. Budgets/goals are explicitly not provided; existing records elsewhere remain unchanged.
- Credit statement and minimum-payment observations carry independent dates. The due date is a separate field and never proves nonpayment. Recurring entries are always forecasts, even when their predicted date has passed. They never feed bills, spending or totals.

## Private storage and integration

Construct one worker-owned `FinanceSourceInventoryStore(existingPrivateDataDirectory)`. Its only file is `finance/source-inventory.json` under that directory, separate from all canonical data. Do not pass a repository, public assets or build directory. `read(now?)` returns `{revision, snapshot}`; a missing file is `{revision: "empty", snapshot: null}`. `save(minimalSnapshot, expectedRevision, now?)` validates, serializes writes, rejects stale/same-time contradictory snapshots, publishes atomic private bytes and verifies readback. Replays with the current revision are no-ops. Invalid existing files are retained and block replacement. No automatic retry is provided.

One store instance owns writes in the worker process; this is not a cross-process locking API. The model has no network or canonical-ledger dependency. The server-side store/hash module must never be bundled into the web application.

The existing Finances view renders `FinanceSourceInventory({snapshot, now?})` in a compact native disclosure and imports its scoped CSS. An independent read hook handles loading, unsupported, empty and failure states without replacing canonical data. Request generations discard superseded reads and different worker scopes cannot render an old inventory. There is no new navigation or browser persistence. Per-amount collection timestamps, bank-date unknowns, explicit non-reconciliation, independent credit dates, availability and labeled forecasts remain visible. A collection older than 24 hours is labeled separately from unknown bank freshness. Native details keep coverage, credit facts and forecasts keyboard accessible.

## Paired API and client

`GET /health` advertises `finance-source-inventory-v1`. `GET /finance/source-inventory` returns `{capability, state: {revision, snapshot}}` and never initializes files. `POST /finance/source-inventory` accepts exactly `{capability, snapshot, expectedRevision, apply}`; the capability string is mandatory and `apply` is an explicit boolean. Both methods reuse existing key, origin, security-header and no-store protection. The body limit is 1,002,000 bytes. Unexpected errors are sanitized without echoing source fields.

With `apply:false`, validation and revision checks return an immutable proposed snapshot/revision without writing. With `apply:true`, the store rechecks the revision in its write queue, publishes the isolated file and confirms durable readback. Responses include `{capability, applied, alreadyImported, expectedRevision, proposedRevision, snapshot, state}`; `state` is null for preview. Same content with the current revision is a no-op, whereas a stale revision is 409, including after an uncertain prior apply. Re-read before deciding what to do next; never blindly replay a POST.

`fetchFinanceSourceInventory(config)` checks capability and returns null for an unsupported worker, distinct from `{revision:"empty",snapshot:null}` on a supported worker. `importFinanceSourceInventory(config, snapshot, expectedRevision, apply?)` checks capability before either preview or apply, validates the full returned snapshot and independently GETs exact revision/snapshot after apply. Dropped fields, changed evidence, failed readback and uncertain responses are errors, with no POST retry. Live ingestion must first minimize genuine source data, omit attested canonical accounts, preview it and inspect the result before applying; this change does not perform that ingestion.

## Synthetic verification

No tests read private source files. With existing verified matching dependencies:

```
node --import tsx --test tests/finance-source-inventory.test.mjs tests/finance-source-inventory-client.test.mjs tests/worker-finance-source-inventory.test.mjs
node node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json --test tests/finance-source-inventory-view.test.tsx
node node_modules/typescript/bin/tsc -p apps/worker/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit
```

The new tests are included in existing `test:finances` and `test:finances:browser` commands; the CI workflow is unchanged. Synthetic model/store/client/API and rendered-component tests pass. Built-PWA acceptance passes at 320, 390, 768 and 1440 CSS pixels, covering seven fictional source accounts, genuine zero versus unknown, 29 forecasts, two independent credit statements/due dates, keyboard disclosures, unavailable sections, empty/error/old-worker fallbacks, no horizontal overflow, no browser persistence, no writes and preserved canonical observations. Worker/web typechecks and builds pass. All browser requests are mocked; this is not live financial or physical-phone acceptance.

Live-source ingestion, deployment, installed worker capability and production acceptance remain separate gates with the parent task.
