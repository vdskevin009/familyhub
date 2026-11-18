# Existing screens: visual clarity and production readiness

Implementation PR #308; release tracking in issue #307. FH-UX-001/002, FH-PROACTIVE-001..006, FH-NOTIF-001/007 and existing financial/source contracts. Existing functionality is the scope; forecast, reserve and outcome-ledger proposals are deferred.

## Design direction

Keep five destinations and the evidence-backed action model. Existing palette: canvas `#f5f6f8`, white `#ffffff`, ink `#202124`, muted `#62676f`, action blue `#2463d3`, with distinct warning/error/success. Existing system/Segoe UI type and tabular figures; no external fonts, copied brand assets or new chart dependencies.

Actual comparable quantities receive aligned, labelled bars. Unknowns stay outside plotted totals. Signed Finance changes share an explicit zero; recurring refunds retain signed amounts and explicit refund labels. Secondary evidence uses native disclosures/sheets while material uncertainty stays visible. The first useful action precedes aggregate summaries.

```
Today                 Finances / recurring          Reimbursements
next useful action    period + scope filters         person + open case scope
qualified summaries   attested amount / chart        qualified remaining amount
remaining actions     ranked details                 search + workflow
sources + follow-up   evidence/actions on demand     cases + existing actions
```

Official examples visually inspected and adapted to FamilyHub's own semantics:

- [YNAB spending breakdown](https://www.ynab.com/whats-new/spending-breakdown-on-mobile): period total and ranked, aligned category amounts.
- [Monarch Reports](https://help.monarch.com/hc/en-us/articles/21846787088916-Using-Reports): visual overview with underlying detail available.
- [PocketSmith reporting](https://www.pocketsmith.com/features/reporting/): explicit labels and distinct financial states.

## Existing-screen changes

| Screen | Change | Preserved |
| --- | --- | --- |
| Aujourd’hui | Category icons, concise qualified amounts and freshness | First action, exact links, decisions, partial/offline states |
| Finances | Attested assets/debts, signed expense/change bars and distinct contribution states | Four tabs, filters, sources, corrections/undo, forecasts separate from payments |
| Remboursements | Compact source warning, prominent recovery estimate and scannable case values | PDFs, insurer evidence, scope rules, reconciliation/preparation/manual choices |
| Dépenses récurrentes | Actual-paid summary, ranked categories and compact package rows | Separate currencies, refunds, unknown/reference costs, contracts/documents/comparisons |
| Notifications | Category, action state, validity and next action visible; evidence/secondary controls disclosed | Quiet hours, delivery budget, opt-in, lifecycle and generic Push content |

## Corrected defects

| Area | Before | After |
| --- | --- | --- |
| Navigation | Mortgage selected Projets and Plus | One explicit destination per existing route |
| Reimbursements | Missing collection time became current read time | Unknown stays unknown; saved-results label |
| Reimbursements | Reads/async sync continuations could write after departure | Active connection identity and read epoch guards |
| Reimbursements | Unknown aggregate amounts appeared as zero | Unknown/partial sums remain distinct from reported zero |
| Shared notices | Information/unavailable states looked successful | Neutral information; success explicitly requested |
| Shared sheets | Focus cycling omitted native summaries | Visible disclosures included in keyboard cycle |
| Finances | Valid account captures under absent-history banner | Empty-state scoped to views needing that history |
| Recurring | Multiple operations total labelled as one dated payment | Actual observed range and operation count |
| Recurring | Import instructions during pending read | Honest loading state |

## Review coverage

This review covers changed entry/detail flows, not every screen's complete business process. Domain guidance was shared across accessibility/colors, layout/writing and typography/UI owners. Synthetic rendered evidence supports the inspected states; wider unchanged routes receive retained theme/navigation checks and CI regressions. No real household values are used as fixtures.

| Domain | Evidence |
| --- | --- |
| Accessibility | Named controls, focus, native sheet containment/return, keyboard disclosures, contrast and labelled charts |
| Layout | Narrow/mobile/desktop screenshots, no overflow, aligned financial zero axes and action-first order |
| Writing | Repeated prose disclosed; visible potential/partial/stale/unknown qualifiers; no invented completed action |
| Typography | Existing system type, tabular figures, mobile input legibility and inspected amount wrapping |
| Colors | Existing tested tokens, semantic separation and numbers that do not depend on color |
| UI polish | Screenshot critique, consistent axes/amounts, loading/empty/error states and retained control paths |

## Verification and release

Local typechecking for web/worker, production web/worker compilation, 162 PWA/product/transport tests and five CI shard-coverage tests pass. The theme/navigation harness passes 12 routes at four widths under both system color preferences. New regressions pass at six widths (320–1440 px), including unknown freshness, late unmounted reads and post-sync continuations, one active destination, source details and keyboard focus. The synthetic sync is isolated and is never replayed.

Today passes six widths, Notifications four, existing Savings four and new recurring visual regressions four. Finance, Monthly Accounts, Trends, Contributions and compact spending pass four widths each, plus 45 financial model and 21 targeted Savings tests. Final Finance/Monthly/Trends reruns pass against the release build. Existing tests retain correction/undo, source documents, saved decisions and lifecycle acceptance. Full PR/main CI, publication and exact served revision remain required release gates; issue #307 records each gate separately.

No worker source/API/schema changes are introduced, so no installed-worker restart is required. Natural daily source completion, physical-phone rendering/push receipt and financial outcomes remain distinct, unproven gates in #305. A healthy process or synthetic fixture cannot establish them. RTL and slow-motion animation inspection were not performed; existing reduced-motion behavior is retained.
