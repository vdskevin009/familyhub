# Finances integration checkpoint — FH-FIN-031

Local candidate on `feat/finance-unified-navigation`, based on main
`14e2417c4732a436889c6d6656c3029a5eb30fd6`. No production publication yet.

## Implemented

- Finances primary navigation, Comptes first/default, then Dépenses, Tendances,
  Contributions. Legacy Contributions links open the existing widgets in Finances.
  Existing Savings routes remain available. The newer proposed Projets navigation
  is awaiting approval; this menu must not be deployed in contradiction with it.
- Expenses has one register and no recent/historical dataset switch. The same
  period/account/currency/search/category/review filters drive charts and details.
- GET `/finances/register-bindings`, protected by the existing pairing/origin gate,
  derives exact account and operation identities from bounded hash-verified successful
  import archives. It performs no import, migration, collection or private write.
- All original source observations, amounts, classifications and capture timestamps
  survive. Known operations count once using the canonical ledger rules/decisions.
  Pending, conflicting and unbound rows are labelled outside the subtotal; unknown
  data never becomes zero. This does NOT establish complete unified data coverage.
- A category opens a native dialog. Browser Back, Escape, keyboard focus and return
  are covered. Back refuses to discard unsaved edits. Batch editing is available
  explicitly; revision guards, partial progress, audit and undo remain unchanged.
- Unknown source accounts remain selectable without inventing a canonical account,
  currency, balance or identity. Large unmatched lists paginate by 20.

## Reference and scope

All three original approved PNGs are now readable on kevinpc and their pixels were
opened. Finances reference SHA-256:
`c62fc3e7148f04e47fbbaf38b23c18a740feb4d33ae94669f3892ec596a74136`.
Comptes first overrides its older order. Mock amounts are presentation fiction only.
The earlier Library transfer failures are no longer a visual-reference blocker.
No GitHub issue is required or created, per the owner's later instruction.

The read-only runtime coverage check found genuine unmatched identities. They cannot
be invented or added to a complete total. No private counts or records belong in this
public document. The operator report describes the measured limitation separately.

## Verification

- 16 new reconciliation/archive checks, focused finance/contribution/source run 70/70,
  product aggregate 138/138, finance aggregate 303/303 (overlapping sets).
- Paired endpoint privacy, unsupported POST and no-write assertions passed.
- Web/worker typechecks and Vite build passed; final checks rerun after UI refinements.
- All 11 finance browser scripts passed at four widths (320/390/768/1440) after adapting obsolete default-tab, dataset-switch and unfiltered-chart expectations. The category overview matches the approved panel structure; existing batch editing is opt-in. Final mobile tab sizing and global notification/proactive navigation checks follow.
- No lint script exists. Local dotnet/npm are absent; local checks use installed
  Node/pnpm dependencies. Exact lockfile/Node22/.NET/CI remain release gates.

## Remaining gates

Finish source/archived identity presentation and screenshot comparison, complete all
browser regression scripts and exact-commit CI, obtain the pending navigation decision,
then merge/deploy through the normal workflow only when ready. Trends A+B is a distinct
following branch. Récurrents is separately authorized for implementation only.

The installed worker, private ledgers, scheduled-intake checkout, controller, pins,
locks, secrets and permissions are unchanged. No collection was triggered. No fresh
bank synchronization, full history, CI success or deployment is claimed.
