# Tendances A+B — local checkpoint

Local implementation on `feat/finance-trends-monthly-ui`, based on the tested
Finances lot `2387c97e054fc413d246570832416ab7d47c0867`. Neither lot is
merged or deployed at this checkpoint. Draft PR #294 is now published on top of
Finances #293. Récurrents is a separate implementation-only lot.

## Implemented and reviewed

The original approved PNG was transferred to this machine, SHA-256 verified
(`15773c81790d18593d2604ad9cc9bfffa3aa5264be71665529666e222e0ff3d6`) and its pixels
inspected before visual implementation. Synthetic browser screenshots are compared
with A (overview) and B (signed explanation). C is excluded.

Tendances opens the current or already-selected month directly, with a compact
month strip, date picker and existing account/currency filters. The observed net
amount, signed comparison and cumulative daily curve are visible immediately.
Leading category differences open the current category operations. Touching the
headline difference opens a native dialog with all category differences on the
same symmetric scale, observed amounts and access to operations. Keyboard, Escape,
browser Back and focus restoration preserve the current scope. Method/coverage
details are in an information dialog; collection is not presented as bank freshness.

`finance-trend-attribution.ts` consumes `spendingTrend` without changing its
eligibility, comparable days, means, exclusions, decisions or source facts. Missing
observations/reference stay unavailable. Reference means can contain fractional
cents: presentation-only largest-remainder rounding with stable category-key ties
makes every displayed category difference sum exactly to the displayed headline.
All categories remain in B; A supplies an explicit reconciled remainder if needed.
An advantageous difference is not represented as guaranteed savings.

No separate recent/historical selector remains. Unverified source identities remain
visible in Dépenses and excluded from calculated subtotals; a scoped count is retained
in Tendances coverage. This UI does not invent identity bindings or complete coverage.
No imports, private-data changes, permissions, secrets, locks or runtime changes.

## Checks actually run

- Attribution/regression tests: 9 new + 14 unchanged historical-trend tests passed.
  Refunds/negative amounts, true zero, absent/partial reference, account/currency
  filters, reference-only categories, rounding and repeated changes are covered.
- Product aggregate: 147/147 passed (overlapping with the above tests).
- Web TypeScript and Vite production build passed.
- A+B browser acceptance passed at 320/390/768/1440: direct-month entry, category
  reconciliation, missing/zero/error states, filters, repeated panels/months,
  keyboard/focus/Back, source editing and unchanged saved bank facts.
- The first lot's financial aggregate passed 303/303, inventory view 6/6 and all
  11 finance browser suites. No worker financial calculation changed in this lot.

## Publication gate

Automatic approval rejected pushing `feat/finance-unified-navigation`: publishing
the current navigation was judged insufficiently authorized while the newer Projets /
Récurrents placement proposal awaited validation. That push did not execute and no
alternate publication route was attempted.
The owner subsequently authorized draft PRs and CI explicitly; the single permitted
retry succeeded and #293/#294 were created. No GitHub Issue is required by the user's
explicit instruction, and none was created. The initial CI passed compilation, .NET
and financial calculations. Remaining failures exposed old theme/navigation/version
expectations and the relocated collection-coverage control. Tests follow the actual
approved UI; the information panel retains the exact covered-account count.

Complete exact-commit npm/Node 22 CI, merge, Pages publication and installed-worker
verification remain release gates. .NET regressions passed on the initial remote
commit. Local tests use Node 24/pnpm; dotnet is unavailable locally. No deployment
or newly synchronized bank data is claimed.

The second CI run also exposed the old inventory test's expectation that all seven
source accounts remain rendered beneath Trends. The approved monthly screen omits
that duplicate inventory, while Comptes and Dépenses retain all seven. The test now
verifies the compact view and verifies every account again after returning; the
four-width source-inventory suite passes, including stale responses and keyboard.

Finances head `e7c6a46e3eb24e615a2fe4386c8c98a7b507dfad` passed all CI gates in
run 43781125437. Moving #293 from draft to ready was rejected by automatic approval
twice, including after checking the owner's later deployment instructions. No merge,
runtime update or indirect publication was attempted. Draft publication and CI remain
authorized; release needs that workflow block resolved.
