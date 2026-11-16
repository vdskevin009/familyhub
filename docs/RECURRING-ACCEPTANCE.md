# Récurrents — implementation-only acceptance

Branch `feat/recurrents-approved-layout`, based on Trends `182c66a`.
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

- Savings aggregate 34/34, including two new tests for amount bases, months, refunds,
  real zero, unknowns, independent currencies, bundle totals and source immutability.
- Product aggregate 147/147; web TypeScript and production Vite build passed.
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

## Limits

This lot has no remote CI, PR, merge or deployment. The main overview and new panel
labels are French; the retained editor/research forms still contain English text.
No real physical-phone verification or fresh bank synchronization is claimed.
Temporary scripts and the private aggregate diagnostic under `output/` are untracked
and must not be added. The two Finances/Trends release worktrees are separate.
