# Finance month journeys — #191

FH-FIN-018 refines the existing React/TypeScript finance UI with its shared system font, semantic colors and native controls. Sources, financial rows, decisions, audit, bulk actions, Save & Next, undo and original document links retain their existing storage/API behavior.

## Behavior and calculation boundaries

- Tendances lands on twelve compact month circles, using a shared annual magnitude scale. Select a month for its observed amount, historical reference, categories and payments. Back returns focus to the selected month. Signed numeric amounts remain available alongside the decorative graph; a refund month is not a budget-progress ratio.
- Actual observation renders independently of reference availability. At least three eligible prior months are still required. Every prior candidate retains its original full-month, account, currency and source-bound gates; partial references use identical elapsed days without extrapolation.
- Reference availability and current comparison eligibility are separate. An eligible historical reference can be shown when current movement bounds are unresolved, with an explicit coverage status. Above/below differences require both current comparability and the historical reference. Unknown coverage never becomes an invented zero or a complete-history claim. Future months remain unavailable.
- Dépenses opens with its existing net total and five leading categories. Other categories remain in a native disclosure and retain the same chart scale, payment drill-down and explicit editor. If a saved category moves into that disclosure, returning from payments opens it and restores visible focus.
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
