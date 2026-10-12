# Finance month journeys — #191

FH-FIN-018, refined by FH-FIN-019, updates the existing React/TypeScript finance UI with its shared system font, semantic colors and native controls. Sources, financial rows, decisions, audit, bulk actions, Save & Next, undo and original document links retain their existing storage/API behavior.

## Behavior and calculation boundaries

- Tendances lands on twelve compact month circles, using a shared annual magnitude scale. Select a month for its observed amount, historical reference, categories and payments. Back returns focus to the selected month. Signed numeric amounts remain available alongside the decorative graph; a refund month is not a budget-progress ratio.
- Actual observation renders independently of reference availability. FH-FIN-019 now uses observed periods in the six calendar months preceding the selected month. Target, future and not-yet-ended imported months are excluded. Partial references use identical elapsed days without extrapolation; months without source observations do not divide the mean as zero. A source-backed net-zero period remains valid.
- Reference availability and current coverage are separate. An indicative reference and indicative signed amount difference remain visible with partial account/history coverage or fewer than six observed periods. Info gives the exact contributing months, six-month window, same-day slice and limitations. Bounds of transactions remain observations, never a completeness certificate. Missing accounts are not assumed inactive. Future targets remain unavailable.
- Dépenses opens with its existing net total in one compact row in the category block, followed by five leading categories. Other categories remain in a native disclosure and retain the same chart scale, payment drill-down and explicit editor. If a saved category moves into that disclosure, returning from payments opens it and restores visible focus.
- Investissements opens with dated account values. Select an account for its dated value and activity; positions, history and review notes remain available through disclosures. Back restores account-button focus. Activity periods do not change source-dated balances or imply returns.

## Interface review

Scope: changed finance components and scoped CSS only, against `AGENTS.md`, `README.md`, `docs/ARCHITECTURE.md` and existing FamilyHub tokens. This is a change review, not a full application accessibility certification.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Native buttons/selects/disclosures; named Info dialogs; signed numeric equivalents; month/account/category focus return; keyboard and four-width browser flows | Addressed hidden graph and focus-return findings; no remaining high finding in scope |
| Layout | Annual/month/detail separation; leading categories; investment navigation; screenshots and overflow checks at 320/390/768/1440 | Compact initial views and reachable detail; no remaining high finding in scope |
| Writing | Observed/reference labels, coverage status, Info method, signed refund and unknown values | Historical reference is distinct from a validated comparison; no remaining finding in scope |
| Typography | Existing system font, tabular money, wrapping, narrow fallback-font regression | Existing conventions retained; no remaining finding in scope |
| Colors | Existing ink/muted/green tokens against white/canvas; numeric/text alternatives | Contrast ratios 13.96/5.42/8.37 on white and green 7.70 on canvas; no remaining finding in scope |
| UI polish | Existing surfaces, 44px navigation/control targets, focus outlines, compact circles and Back behavior | Existing conventions retained; no remaining high finding in scope |

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| HIGH | UI | `FinanceTrends.tsx`, Gauge | Actual arc depended on comparison reference | Independent observed/reference rings | Available spending must remain visible with incomplete comparison coverage |
| MEDIUM | Layout | `FinanceTrends.tsx`, landing | Annual navigation and long monthly detail appeared together | Annual → month → payments with Back | Keeps the mobile entry journey focused |
| MEDIUM | Layout | `FinancesView.tsx`, expense/investment landing | Long categories, operations and selected-account detail appeared immediately | Five leading categories; account selection and native detail controls | Key values precede detailed investigation |
| MEDIUM | Accessibility | `FinancesView.tsx`, category/account return | A category could move into hidden remainder after editing | Reopen remainder and restore matching category; account Back restores trigger | Focus remains visible and the existing editing journey remains usable |

These findings are addressed by this change. Approve within the scope and evidence above, subject to final automated and release checks.

## Verification and release boundaries

`npm run typecheck`, `npm run build`, `npm run test:finances`, `npm run test:finances:browser`, `npm run test:pwa` and `npm run test:savings` are the relevant local commands. Browser fixtures use temporary libraries and an intercepted synthetic worker. They cover repeated annual/month/Back, actual without reference, reference without valid current comparison, zero/refund/future/empty/error, account/currency filters, persistence, original source evidence, bulk Save & Next, retries/conflicts and undo.

Private read-only local previews verify current filtered data without storing it in this repository or contacting external services. Private screenshots and state hashes remain outside Git. Authenticated deployed UI, physical phone behavior, actual mobile latency and a full screen-reader/200% zoom audit are separate acceptance limits. No installed worker, profile, key, subscription or real financial decision is changed by this frontend work. Exact PR CI and Pages deployment evidence belong in Issue #191 after completion.


## Follow-up #194 / FH-FIN-019

The annual and month-detail circles share the same annual absolute-amount denominator and one as-of date snapshot. Both expense and month-detail totals now share their category block. The old detail omitted the scale prop and normalized the same amounts against its own maximum. Ring lengths, reference amounts and observed periods now agree through month/Back/filter navigation. This is an amount visualization, not a budget completion ratio.

Category payments start with search; the short row count/total and Info replace the introduction. Native row nature/category menus select a draft automatically. Explicit checkboxes and lot menus allow multiple rows with different retained natures. Save and Save & Next stay reachable in the sheet footer. Save & Next advances in the original amount order, skips the affected same-name group and restores checkbox/search focus when edited rows leave the category. Search-hidden selections are counted explicitly.

Batches use the existing revision-protected API sequentially, with compact authoritative deltas after each confirmed operation. No global GET follows ordinary saves. Progress reports selections actually completed; a partial failure preserves pending selections/drafts. Lost acknowledgements retry the exact payload and request ID, including a later individual nature change following same-name expansion. Conflicts and replay acknowledgements requiring a newer snapshot stop the remaining lot for an explicit read/review; they never reapply an older decision over a newer one. Conflicting categories within overlapping same-name scopes are rejected before any request. Other same-name rows retain their nature/notes; selected rows still receive their explicit nature. Source facts and old audit entries are never replaced.

A lot is not a new atomic worker transaction. Each existing operation remains independently audited and undoable only when its existing manual-authority guard allows it; overlapping or newer changes can make an earlier operation non-undoable. Valid undo controls are retained in History. Cancel discards unsaved drafts, while confirmed steps remain saved. Source details still open deliberately; an individual modal is not needed for normal nature/category changes. Months with no observation stay unknown; genuine net-zero periods retain zero. Daily note fields are hidden in a native Note and audit disclosure, preserving old note content.

Closing nested Info with Escape now stops its cancel event from closing the surrounding payment sheet. This shared one-line correction retains each existing Info focus-return behavior.

### Scoped screen review

Review scope is the annual → month → category list/inline edit/Back journey and compact expense summary. React/native controls and FamilyHub tokens; conventions read: AGENTS.md, REQUIREMENTS.md, README.md and docs/ARCHITECTURE.md. Domains reviewed: accessibility (names, native keyboard, focus, error/progress), layout (320/390/768/1440, compact totals/footer), writing (observed/indicative counts and recovery), typography (system fonts, numeric signs, wrapping, 16px selects), colors (existing tokens, redundant text meanings), UI (44px controls, existing surfaces and no new motion). Full screen-reader, physical-phone, RTL and 200% zoom acceptance remain unverified.

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| HIGH | Layout | `apps/web/src/views/FinanceTrends.tsx:91`, monthly Gauge | Same amount renormalized locally | Annual scale passed to detail | Ring fill must not imply a changed amount |
| MEDIUM | Writing | `apps/web/src/finance-trends.ts:68`, reference cohort | Partial imported history suppressed | Observed cohort with explicit indicative count/limits | Helps compare available evidence without inventing zeros |
| MEDIUM | Layout | `apps/web/src/views/FinancesView.tsx:693`, expense total | Separate tall card | Compact total in categories block | Keeps categories prominent on mobile |
| MEDIUM | Accessibility | `apps/web/src/ui/InfoPopover.tsx:30`, onCancel | Nested Escape closed its parent sheet | Stop cancel propagation | Retains category context and focus |

These findings are addressed. Approval is limited to the inspected flow and completed synthetic/read-only checks; release and exact CI remain tracked in #194. No claim of a full accessibility certification.

Measured unchanged ink/muted/green contrast on white: 13.96/5.42/8.37; on the soft toolbar: 12.48/4.85/7.48. The native selected option retains its full accessible label even when the narrow select truncates its visual value.
