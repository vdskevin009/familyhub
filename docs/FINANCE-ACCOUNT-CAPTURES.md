# Monthly account versions (FH-FIN-026; continuation of FH-FIN-023/024 and PR #287)

## Two independently evidenced kinds of version

- Received source captures: one actual institutional linked-account response, one original collection instant, all accounts returned by those institutions, hashed source keys. The fixed scope is returned-institution-accounts; complete never asserts the absence of manual accounts or other assets outside that response. The source file SHA-256 is required for complete captures. Account coverage does not certify complete household wealth or fresh bank balances.
- Historical register versions: read-only projections from one exact hash-verified archived preparation bundle and one explicitly recorded observedOn day or genuine source timestamp, preserving its precision/timezone. collectedAt is null. No midnight, import time, collectedOn fallback, holdings total or current mutable ledger value is substituted. These signed recorded amounts have an undocumented historical sign convention; label their arithmetic total **Total enregistré**, never a certified source net balance or performance measure.

The two series never merge by name, suffix, amount, account kind or date. No cross-series return/change percentage is justified. Historical canonicalAccountId is the exact canonical account reference in the original archive, solely for existing detail links; no raw provider identifier or inferred link to a recent source account is exposed. Missing current drilldown targets stay unavailable.

## Source schema and totals

finance-account-captures-model.ts exports FinanceCaptureAccount, FinanceAccountCaptureSnapshot, FinanceAccountCapture, FinanceAccountCapturesState and validators. Source balances retain signed integer cents, ISO currency and independent nullable bank sourceAsOf. Credit statement/minimum/due dates remain separate. All nine linked source accounts may be admitted without canonical mapping; none is excluded merely because the ledger already contains an attested observation.

The explicit provider=plaid, basis=plaid-current-v1 adapter preserves raw current and applies the documented convention: credit/loan current is negated; depository/investment current is unchanged. A negative card current becomes a positive credit owed to the holder; an overdrawn deposit remains negative. Unknown providers/types or missing values yield netBalance:null. The validator checks every admitted derived amount and date/currency against its raw balance, rather than trusting an arbitrary supplied net.

Primary source: [Plaid Accounts balances.current](https://plaid.com/docs/api/accounts/). These values can be cached; collection time never proves bank freshness, and current is not withdrawable available funds. Only a single selected capture is summarized, one currency at a time. Unknown amounts or unknown currency qualify the subtotal; no known amount means null rather than zero. BigInt accumulation refuses an unsafe final integer. Never sum captures, credit statement balances, minimum payments, holdings or canonical observations into this total.

prepareFinanceAccountCapture accepts an already minimized complete FinanceSourceInventory, exact expectedSourceKeys, providerBySourceKey copied from the same response, sourceSha256 and explicit accountScope:"returned-institution-accounts". returnedManualAccountCount:null preserves an absent manual-accounts section; 0 describes an explicitly returned empty section. Neither is evidence that no manual accounts exist elsewhere. Missing/invalid counts, a different/unspecified scope or nonzero returned manual-account count block this adapter until a dedicated manual-account adapter is available. Manual assets are not accounts to add. New linked providers/types must still be retained with unknown semantics, not silently dropped. All expected keys must match; no crosswalk, alias or name matching is performed. The helper performs no reading, network or mutation.

## Paired API and durable history

Capability finance-account-captures-v1:

- GET /finance/account-captures -> {capability,state:{revision,captures}}.
- POST same path -> {capability,snapshot,expectedRevision,apply}. Explicit false preview writes nothing. Apply serializes and requires the latest revision. The result contains capture, proposedRevision and confirmed state; callers independently GET after apply and never replay an uncertain POST blindly.

Each capture has a content digest id, origin source-capture or legacy-inventory, and snapshot. Ordered account input normalizes deterministically. An identical earlier capture deduplicates even after newer captures exist. A genuine earlier timestamp can backfill history without replacing later evidence. Different source content at the same instant is rejected unless supersedesCaptureId explicitly names the current version at that instant; prior and corrected versions remain immutable and forks/cycles are rejected. A correction is not a new bank reading. UI defaults to a current source-capture rather than a later legacy batch timestamp, and selects exactly one non-superseded version.

Private finance/account-captures.json is logically append-only, atomically replaced with all prior rows unchanged, mode0600 temporary file plus fsync/rename/readback. The existing finance/source-inventory.json remains intact. GET projects its current seven-account evidence as a distinct partial legacy version, with unknown provider convention and no net amounts; it never fabricates a nine-account past capture. First source apply durably includes that legacy evidence. Every later v1 inventory replacement runs under the same capture queue: reserve capacity for incoming projection, archive the actual prior legacy snapshot, then atomically replace the inventory. Failure preserves original evidence and prevents an unreadable over-cap history. Single worker ownership is required; arbitrary external/cross-process writers are not supported.

Retention is bounded to 2,400 captures and 32 MB, whichever comes first (over six years at one daily capture when size permits). Saturation fails closed and requires an explicit non-destructive archive/product decision. Nothing is pruned automatically. Corrupt or oversized history blocks mutation; it is never reset to empty.

Capability finance-account-history-v1:

- GET /finance/account-history -> {capability,versions,unavailableArchiveCount}.
- No mutation method. Existing paired/origin protection and no-store headers apply.

Only source hashes listed in the canonical ledger import archive index are read. Filenames are constructed from strict SHA-256 values; realpath checks reject escapes/symlinked archive files or external source directories. Exact archive bytes must hash correctly. Reads are capped (20 MB per archive, 128 MB per request, 2,400 imports/versions). Account IDs and identity fingerprints must be unique. Each exact source date/timestamp forms its own version, within one bundle; complete-recorded-scope means only all accounts in that bundle share the recorded day. Plugin/partial intake is qualified partial, and balance-observations-only bundles are not historical account versions. Unknown dates are not replaced by other dates. Identical date/scope/account projections deduplicate to the first exact archive provenance, without unioning rows from archives. Missing/corrupt/hash-mismatched archives increase unavailableArchiveCount; all-unavailable history remains explicitly unavailable, not zero.

No tokens, bank exports, local source paths, raw provider IDs or real test data are committed. Endpoints reuse the existing localhost/private origin and pairing boundary. This change adds no collector, scheduler, credential, permission, canonical mapping, bank action, ledger mutation or automatic apply. The service entrypoint changes and its installed hash pin require the separate reviewed deployment process; no runtime or pin is altered by these commits.

## Validation and integration

Synthetic tests cover strict schema, all-source admission, exact signed totals including credit refunds, zero/null, currencies, legacy migration, replay, backfill, correction chains, concurrency, capacity saturation, byte limits, corrupt files, archive provenance/traversal, auth/origin/no-store/privacy and restart preservation. test:finances includes these tests; frontend owns monthly selection, independent loading/error/unsupported states and four-width browser coverage. The canonical register/observations and the previous source sections remain separate and unchanged.
