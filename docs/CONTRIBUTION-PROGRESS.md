# Private contribution progress candidate (FH-FIN-020, #281)

This is a local, unconnected candidate. It does not collect Finances, install a schedule, change the active worker, or update the PWA.

The pure projection reads the existing FinanceState and a private plan. Exact source debit account and description matches are observations, never a heuristic based on recurrence. Explicit generic transfer descriptions remain an unassigned list. Positive posted debits with evidence enter observed progress; credit legs, brokerage purchases, unconfigured descriptions, ambiguous duplicates, incompatible saved manual decisions, pending records and other currencies do not. Repeated source occurrences remain distinct. The personal goal is not contribution room. Confirmed contributions and tax room remain null.

Ledger collection date remains distinct from evaluation date and provider source freshness. The current ledger does not certify provider source-as-of; sourceAsOf remains null, sourceFreshness stays unknown and status stays partial. Incomplete coverage, saved source limitations, unavailable accounts and stale observations remain visible. Date boundaries must be supplied explicitly, inclusive, as calendar dates, without interpreting tax deductibility. All household configuration belongs outside the repository.

ContributionReportStore saves immutable content-addressed projection files in a caller-supplied private directory. Complete temporary bytes are published with an exclusive hard link, read back exactly, then the temporary name is removed. Repeated and concurrent delivery deduplicate; older reports remain untouched. A failed/partial projection never advances an ingestion cursor. This is not yet a checkpointed ingestion runner. The caller must not supply a public directory.

## Validation

Run `node --import tsx --test tests/contribution-progress.test.mjs` after dependency installation. Fixtures are synthetic. Tests cover identity/evidence exclusions, manual preservation, boundaries, freshness, deterministic replay, exact private readback, fresh-store replay and concurrent publication.

## Remaining gates

- Verify supported Finances schema and exact stable identity/sign/status/source coverage semantics.
- Map private source accounts and references to the existing ledger, without duplicate cross-provider identities or changing historical source facts.
- Reuse FinanceLibrary preview/apply with fresh expectedRevision, exact readback and repeat-import verification; do not call its TD adapter a generic Finances adapter.
- Confirm private date boundaries and configuration; preserve source exports through the supported private file-transfer route only.
- Coordinate with the owner of PR #280 before any runtime/install changes. No active worker replacement is authorized by these tests.
- Validate every dependency from the future automation environment, offline/unavailable-PC catch-up and uncertain-delivery recovery before activating the daily task.
- Add the paired API/UI projection and run the deployed user journey separately. No live financial import, schedule or UI acceptance is claimed.
## Local validation checkpoint

13 contribution calculation/storage tests and 25 existing Finance/library/change regressions passed. Complete worker and web TypeScript checks and both builds passed using existing installed dependencies via an ignored local node_modules junction. The retained .NET regression harness was not run because dotnet is unavailable on this executor. No browser journey, real-data import or daily run was performed. No runtime, source financial data, public interface or schedule was changed.

## Finances adapter and orchestration candidate

`finances-plugin-import.ts` accepts complete materialized transaction pages only, validates the cursor chain and query coverage separately, rejects truncated export previews, pending/sign/date/currency conflicts and duplicate provider identities. IDs are provider/item/account/transaction hashes, not globally assumed provider IDs. Existing account mappings and transaction resolutions are private and revision-checked. A legacy row binding preserves its immutable description/fingerprint/manual decisions while archiving the new raw evidence. Potential cross-provider duplicate amounts/dates cannot enter as new rows without resolving the old identity. Already imported provider IDs are reused and changed facts fail closed.

`contribution-sync.ts` uses an injected authoritative paired API transport for GET, preview, apply and readback. It never writes the active ledger directly. A lost apply response causes a read-only check for the exact immutable bundle hash and row facts, never a repeated apply within that run. The final report is written only after confirmed import. Same-evidence replay is deterministic; retrieval time and source freshness remain distinct.

Eight synthetic adapter/orchestration tests cover real temporary FinanceLibrary preview/apply/readback/replay, cross-provider mapping, pagination, malformed evidence and lost-response recovery. Live source mapping is still being reconciled. The existing paired API is reachable in read-only preflight; no actual source import or active configuration change has occurred. The adapter intentionally does not accept selected CSV previews as full source material; upstream materialization must preserve complete originals and exact query/selection provenance.