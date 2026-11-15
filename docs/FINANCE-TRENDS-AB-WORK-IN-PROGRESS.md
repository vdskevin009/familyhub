# Tendances A+B — local checkpoint

Partial groundwork only. Branch `feat/finance-trends-attribution` starts from the
stabilized local register checkpoint `798d94527d5739a42ffcb229d43cbb37767ffe9a` on
`feat/finance-unified-navigation`. Neither lot has been pushed, merged or deployed.

## Scope

The owner approved A as the month overview and B as its accessible difference panel.
C is excluded. Comptes remains the first Finances tab, Contributions retains its
widgets, and this lot must not reintroduce separate recent/historical registers.

## Implemented

`finance-trend-attribution.ts` consumes the existing `spendingTrend` result without
changing reference eligibility, comparable days, baseline means, source data or
classifications. It computes signed category differences, ranks their absolute
contributions to the headline difference, and supplies a common symmetric scale.
Every category remains in detail; the compact overview includes an explicit summed
Autres with all underlying keys. Unknown observed/reference values stay unavailable.
Inconsistent or missing category totals prevent an unsupported explanation.

Reference means can contain fractions of a cent. Raw values remain untouched. Only
the display layer distributes rounding by largest remainder with stable category-key
ties, making displayed category differences add exactly to the displayed total.
This is display rounding, not a change to financial arithmetic or a savings claim.

`trendEntryMonth` preserves the selected month or uses the current month, independently
of the latest capture date. The existing annual-first UI has not yet been changed.

## Blockers and remaining work

Official Library materialization of approved `familyhub-tendances-alternatives.png`
failed on this Windows environment with
`AttributeError: module 'os' has no attribute 'setxattr'`. No destination image exists.
Pixels were not inspected, and no unofficial transfer or metadata bypass was used.
The same failure affects the first approved Finances reference. Visual implementation
is therefore pending the supported reference transfer required by the owner.

The earlier automatic approval refusal of GitHub issue creation also remains open;
this lot did not retry it or use a different publication route. See the first lot's
checkpoint for the exact refusal and the incomplete reviewed-crosswalk integration.

After those gates: finish FH-FIN-031 and integrate these functions into monthly A;
make the existing daily curve directly visible; implement B with native-dialog focus,
Escape, Back, return focus and category operations in the same selected scope. Keep
method/coverage available through a compact information control and label collection
timestamps without asserting bank freshness. Test empty/error/loading/reference-less
states and repeated month/category/account/currency changes. Verify 320/390/768/1440
layouts and synthetic captures before exact-commit CI, PR, merge and Pages verification.

No UI, worker/API, production data, private mapping, imports, pins, locks, credentials,
permissions or installed runtime have been changed by this lot. No live acceptance,
fresh synchronization, complete data coverage or deployment is claimed.

## Checks actually run

- 9 new attribution tests and 14 unchanged historical-trend regressions: 23/23 passed.
  Coverage includes comparable partial days, signed refunds, genuine zero, missing
  reference, indicative coverage, account/currency scope, all-category reconciliation,
  stable rounding, reference-only categories and repeated month changes.
- Product aggregate: 147/147 passed, including the 12 register and 9 attribution
  tests (not disjoint totals). Web TypeScript and Vite production build passed again
  after the attribution addition. Worker TypeScript/build passed on the first lot,
  and no worker source changed in either lot. `git diff --check` passed.
- No UI was integrated, so no browser/keyboard/mobile screenshots or deployed
  acceptance are claimed. Full aggregate CI and .NET remain unrun; no local dotnet
  command exists. Local dependencies use pnpm/Node 24; normal npm lockfile/Node 22
  exact-commit CI is still required before any release.
