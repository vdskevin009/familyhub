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

## Normalized source input and exact account exclusions

Before API preview, `prepareUnmappedFinanceSourceInventory(normalizedSource, {attestedMappedSourceKeys, expectedUnmappedAccountCount}, now?)` removes only exact hashed keys derived from the already-attested private crosswalk. Every excluded key must occur in the collection, and the output count must equal the explicitly verified count. Missing keys, changed scope, duplicate keys and raw IDs stop admission. Identical names, institution labels and amounts are never matches. An excluded account's forecast link becomes null rather than a canonical link; its forecast remains explicitly unconfirmed. The admitted account coverage is downgraded from complete to partial when filtering, not presented as complete linked-bank coverage. Other source availability, financial facts and dates are retained.

This helper intentionally has no access to the ledger or private crosswalk. The API only accepts an already-minimized inventory and cannot independently verify which source identities have previously been attested. The authorized ingestion caller must derive the exclusion keys from that existing evidence, use the helper, inspect the preview and verify the final count. In the synthetic nine-account example, provide the two exact attested source keys and expected count seven. Recheck the private source scope if any identity/count changes; do not choose the first two accounts, match aliases, or use account type/amount to reconstruct the exclusion set.

The normalized input uses the exact `FinanceSourceInventory` schema, before exclusion. Required fields:

- `sourceKey`: `financeSourceKey("account", originalItemId, originalAccountId)`; each prediction uses kind `"prediction"` and its original recurring-stream identity. IDs are transient inputs only, never labels, logs, API fields or saved JSON.
- Account `name`, optional `institution`, supported source `kind`, `reconciliation:"not-reconciled"`, nullable `balance:{amountCents,currency,sourceAsOf}`, nullable `credit:{statementBalance,minimumPayment,paymentDueOn}`. Convert documented decimal monetary units to exact signed cents once. Missing amount/currency is null, never zero. A generic record-update timestamp is not a bank balance/statement date.
- Predictions use `kind:"forecast"`, the original predicted date (including past dates), source frequency/flow or `"unknown"`, nullable source amount and nullable exact account key. Never derive a paid bill, realized transaction or next occurrence from the forecast.
- `collectedAt` is the real retrieval instant. Source section coverage is only what the response actually establishes. An empty holdings/activity array without coverage is `{status:"unavailable",coverage:"unknown",observedCount:0}`. Budgets/goals remain `"not-provided"` for this source. All schema fields must be present; unknown nullable fields use null. No raw response extension or credential is accepted.

Synthetic API example (all names/IDs below are fictional; endpoint deliberately cannot reach a real worker). Run TypeScript imports through the repository's existing `tsx` tooling. `normalizedNine` must already follow the model; the fixture test `finance-source-inventory-prepare.test.mjs` demonstrates nine identical-looking fictional accounts and exact exclusions.

```js
import { financeSourceKey } from "../apps/worker/src/finance-source-inventory-store.ts";
import { prepareUnmappedFinanceSourceInventory } from "../apps/worker/src/finance-source-inventory-prepare.ts";
import { fetchFinanceSourceInventory, importFinanceSourceInventory } from "../apps/web/src/worker.ts";

const excluded = [
  financeSourceKey("account", "fictional-item", "fictional-account-0"),
  financeSourceKey("account", "fictional-item", "fictional-account-1"),
]; // Example only: production keys must come from the existing attested evidence.
const snapshot = prepareUnmappedFinanceSourceInventory(normalizedNine, {
  attestedMappedSourceKeys: excluded,
  expectedUnmappedAccountCount: 7,
});
const config = { Endpoint: "https://synthetic-worker.invalid", ApiKey: "synthetic-key" };
const current = await fetchFinanceSourceInventory(config);
if (!current) throw new Error("Unsupported worker; stop before preview/apply");
const preview = await importFinanceSourceInventory(config, snapshot, current.revision, false);
if (preview.snapshot.accounts.length !== 7 || preview.applied) throw new Error("Invalid preview");
// Inspect the exact minimized preview. Apply only the authorized, unchanged snapshot.
const saved = await importFinanceSourceInventory(config, snapshot, current.revision, true);
// The helper already required an independent GET with exact snapshot/revision agreement.
if (saved.state?.revision !== preview.proposedRevision) throw new Error("Readback differs; stop");
```

For a raw HTTP caller, the POST body is `{capability:"finance-source-inventory-v1",snapshot,expectedRevision,apply:false}` for preview and the same body with `apply:true` after review. Include the existing pairing header and allowed origin, GET capability first, then independently GET `/finance/source-inventory` after apply. A timeout or response loss is not permission to replay the POST.
