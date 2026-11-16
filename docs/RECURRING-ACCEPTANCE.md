# Récurrents — implementation-only acceptance

Branch `feat/recurrents-approved-layout`, feature commit `2c2531e`, integrated with
deployed main `844f991` in local merge `a40fedd`.
Requirement FH-SAV-013. No publication or deployment is authorized for this lot.
No private data, imports, worker controller, secrets or permissions changed.

The original approved PNG was opened locally before UI changes and compared with
synthetic mobile/desktop screenshots. Its SHA-256 is
`11237b86f27e3e9950938f57c6fbe213b1a37f2f78d0693d16087286015d92a0`.
No mock amount is an application default or a production record.

Implemented: compact month navigation, paid-only blue card, currency-separated totals,
one row per contract, paid/reference/unknown bases, one review banner, contract services
and payment-history panels, comparison disclosure and options for import, sharing and
daily research. Existing calculators, form validations and research protections remain.
The savings route stays in Plus; the proposed Projets navigation is not implemented.

`recurring-presentation.ts` projects the existing reconciliation without inferring
current prices from old debits. Known zero and negative refunds remain valid; unknown
payments remain unavailable. Included/shared service rows never add another total.
Provider-label grouping keeps its existing limitations visible in the history panel.

## Completed checks

- Savings aggregate 35/35, including three new tests for amount bases, months, refunds,
  real zero, unknowns, independent currencies, bundle totals and source immutability.
- Product aggregate 147/147; web TypeScript and production Vite build passed.
  Product aggregate, web typecheck/build and compact browser acceptance passed again
  after integrating the final deployed main commit.
- Browser suites passed: finances, compact-spending, savings, savings-sharing,
  notifications and insurance-reference. Responsive suites cover 320/390/768/1440;
  insurance additionally checks its existing 1280 desktop fixture.
- Tests preserve original sources, exports, offline documents/cache, sharing revisions,
  conflict protection, comparison staleness, empty/incomplete contracts and filters.
- One history entry controls nested panels, so Back closes the current panel and
  retains its parent. Escape and repeated keyboard openings restore the initiating
  contract action. Final editor/research focus checks and the full finance/payment
  suite passed again after the refinements; documented service prices stay distinct
  from shared costs and included services.
- Synthetic screenshots are under `output/playwright/compact/` and
  `output/playwright/finance/`, not public financial records.

## Final regression review (2026-11-16 UTC)

The original PNG was reopened and its SHA-256 rechecked. The 390px overview,
320px contract panel and 1440px overview were inspected against the approved
reference: compact month navigation, blue paid-only summary, one contract row,
paid/reference/unknown distinction and details inside panels. The existing Plus
entry is retained as instructed instead of copying the mockup's Finances backlink.
Comparison results are collapsed initially and remain available through disclosure.

An additional regression changes months repeatedly around an ambiguous payment:
the correct month's review retains its exact source evidence, no contract receives
the amount, the paid total stays unavailable rather than zero, and the original
ledger remains byte-for-byte equivalent. Pending payments remain excluded without
deleting their records. Browser regression also repeats keyboard opening and
Escape/Back closing of the review panel, verifies focus restoration and checks that
neither the paid total nor the source ledger changes. Synthetic review-panel
captures are `output/playwright/finance/recurring-review-{width}.png`.

Initial browser attempts could not reach loopback inside the sandbox; the approved
local-test escalation uses existing Chrome and isolated synthetic fixtures. No
provider or household runtime is contacted by these tests. Web typecheck passed
again. Finances and compact-spending browser suites both passed again at
320/390/768/1440, including the strengthened review-panel checks. No application
or calculation change was needed for this final review.

## Limits

This lot has no remote CI, PR, merge or deployment. The main overview and new panel
labels are French; the retained editor/research forms still contain English text.
No real physical-phone verification or fresh bank synchronization is claimed.
Temporary scripts and the private aggregate diagnostic under `output/` are untracked
and must not be added. The two Finances/Trends release worktrees are separate.
