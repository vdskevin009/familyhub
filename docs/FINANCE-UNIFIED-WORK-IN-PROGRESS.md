# Finances unification — local checkpoint

This is unfinished groundwork, not a release. Baseline main:
`14e2417c4732a436889c6d6656c3029a5eb30fd6`. Isolated branch:
`feat/finance-unified-navigation`. Requirement FH-FIN-031.

## Implemented independently of the visual reference

`apps/web/src/finance-register.ts` reconciles already-imported transactions with
source observations only when a caller supplies explicit reviewed account and
transaction bindings and bank facts agree. Repeated captures corroborate one ledger
transaction. Conflicting versions, invalid bindings and competing identities stay
unresolved; original ledger decisions and financial facts remain unchanged.

Every capture retains its timestamp, nullable bank timestamp, digest, native category
and original row. Explicit posted-to-pending links work across captures without
counting the pending row or losing its evidence. Category, period, account, currency,
search and review scope use the existing ledger classification and summary functions.
An absent included amount is null; a genuinely offsetting expense/refund can be zero.

No consumer is connected to this module yet. Source-only transactions remain
unreconciled and excluded from totals. This is deliberately **not** complete unified
data coverage, a complete-history claim, a fresh synchronization or a migration.

## Evidence and blockers

- The official Library transfer for approved `familyhub-finances-proposition.png`
  fails on Windows: `AttributeError: module 'os' has no attribute 'setxattr'`.
  No local image was installed. Its pixels have not been inspected. The required
  reference inspection blocks visual implementation; no alternate downloader or
  metadata bypass was used.
- The automatic approval review rejected creation of a GitHub issue twice, including
  one retry after reading the owner's implementation/deployment authorization directly.
  Exact second reason: “This again publishes a durable GitHub issue and project scope
  externally; the user authorized implementation/deployment, not creating or publishing
  an issue.” No issue was created and no further retry or alternate publication was made.
- PR #291 was read directly: closed, draft, unmerged, head
  `dfe2aa62200953e7b957db55cff483e7b4aa7b71`. It was not changed or reopened.
- Source expense keys and canonical ledger IDs use different hashes/identities.
  `/finance/source-expenses` does not expose a verified canonical crosswalk.
  Name/date/amount matching cannot safely supply it. The existing reviewed private
  preparation/import pipeline has account and transaction resolutions; an appropriate
  read-only, validated projection of those proofs still needs implementation.

## Remaining implementation

1. Restore supported Library materialization in an environment that preserves required
   metadata, then inspect the approved pixels. Comptes first overrides the reference order.
2. Supply the reviewed identity crosswalk through the paired read-only API, preserving
   private raw identifiers and existing intake pins/locks. Do not trigger collection.
3. Integrate one register with both proven identities and clearly disclosed unresolved
   observations. Reuse financial rules and existing revision-protected editing. Do not
   treat source-only display rows as editable imported ledger entries.
4. Replace mobile Récurrent with Finances; keep Récurrent in Plus. Route legacy
   Contributions links into Finances; preserve the widgets unchanged. Implement the four
   tabs and default Comptes, retaining investments/account deep links.
5. Remove expense dataset sub-tabs only when the integrated register is ready. Implement
   category panel with current filters, native dialog focus, Escape, Back and focus return.
   The separately approved Tendances A+B lot follows on a distinct branch after this
   checkpoint; it must not restore the split register or alter contribution calculations.
6. Run full finance/contribution/navigation regressions, repository aggregate CI, build,
   typechecks and .NET. Verify synthetic mobile/desktop images, repeated month/category
   changes, keyboard, Back, loading/error/empty states, and source-only data coverage.
7. Resolve the issue-publication blocker before completing required project tracking.
   Publish a reviewable PR, then merge only the exact green commit and verify actual
   Pages release/runtime health. Do not deploy this incomplete checkpoint.

No production data, installed worker, scheduled intake, pins, locks, secrets or
permissions were modified. No screenshots of household finances were produced.

## Checks actually run at this checkpoint

- Web and worker TypeScript checks passed; worker compilation and Vite production
  build passed. The first Vite command used the repository root and failed to find
  `index.html`; running from `apps/web` passed.
- 12 new reconciliation tests passed. The focused register/trends/edits/contributions
  run passed all 61 tests. The product aggregate passed all 138 tests (includes these
  12 register checks; these totals must not be added as disjoint coverage).
- Existing finance import/change/source model suites passed 32 tests. Two HTTP worker
  tests initially failed to reach their synthetic loopback servers inside the sandbox;
  rerunning those two with approved execution outside it passed 2/2. They used temporary
  test directories and random ports, not the installed worker.
- `git diff --check` passed. No lint script or local `dotnet` command was available.
  Full repository/remote CI, browser acceptance, visual review and deployed-runtime
  verification have not run; the UI is unchanged and the module is not yet integrated.
- Local dependency preparation used pnpm/Node 24 because npm is absent from PATH.
  Temporary pnpm manifests/locks are not part of the implementation commit; exact npm
  lockfile/Node 22 verification remains for normal CI.
