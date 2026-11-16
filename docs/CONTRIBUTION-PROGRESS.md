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
## Inference-only projection (FH-FIN-029)

`contribution-inference.ts` reads existing source snapshots without imports. Optional private `contributions/inference-policy.json` contains schema 1 and bounded rules: planId, sourceAccountKey, canonicalAccountId, targetAccountId, reference, from, through, evidenceTransactionIds. Each rule is independently reviewed, scoped to an exact source account and exact destination token; at least two prior canonical IDs must remain explicitly verified in that plan and satisfy source/manual guards. Inferred rows cannot seed another rule. Receiving-bank confirmation always remains false.

The regular contribution config and its scheduled hash are untouched. API additions inferredCents (nullable), inferredPayments, inferenceStatus remain separate from identifiedCents and weeklyProjection. Missing policy/source means unknown, not zero. Replays collapse only identical stable source keys. Conflicting source facts are excluded. Any same-account/date/currency/amount canonical candidate conservatively suppresses a raw inference rather than guessing a cross-provider identity. Future canonicalization therefore cannot count both representations. This may undercount ambiguous legitimate repeated payments; explicit binding support is a later change, not silently guessed here.

Activation requires a reviewed private policy outside Git, scoped installed-baseline build/backup/diff, protected-state hashes, existing-supervisor restart and authenticated readback. No new endpoint, bank call, ledger mutation, scheduled pin or security setting is part of this feature. Public fixtures use fictional references only.

Activation blocker: the pinned scheduled readback currently compares the complete legacy progress response by exact JSON equality. With no inference policy, this feature preserves that response exactly. Activating a policy changes the response and must remain blocked until a separately reviewed verifier release independently validates the extension. Do not edit the pinned checkout, bypass its guard, rewrite old receipts or silently change scope pins. An alternative opt-in endpoint would require separate review of the security-pinned router. This candidate is not safe to activate or resume scheduled intake against an active inference policy yet.
