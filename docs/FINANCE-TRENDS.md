# Personal spending trends

FH-FIN-010 / Issue #177 adds a third Finances tab. Dépenses and Investissements retain their existing behavior; the former two-tab limit is superseded only for this request.

The view reuses the private ledger, existing categories and `summarizeSpending().included`. A card settlement is excluded by its own nature, never because another amount cancels it. Refunds retain their dates and signs; investment flows, duplicate/review natures and pending transactions remain outside posted spending. Existing explicit decisions remain authoritative.

## Personal comparison

The candidate window is the six calendar months immediately before the selected month. At least three must be fully inside the selected spending accounts' imported date bounds, the overall import scope and collection date. The target and future months never enter the baseline. Unrelated brokerage/deposit accounts without spending do not silently prevent a bank/card comparison; selected accounts and accounts containing classified consumption are retained. Missing account bounds or an uncovered target prevent the comparison.

The baseline is the arithmetic mean of these observed months, displayed to the cent. A partial target ends at the earliest of today, the source scope end and collection date. Its baseline uses the same first N days of otherwise fully covered prior months; shorter months are ineligible. Completed months compare entire months, without prorating their different lengths. Daily curves preserve calendar days: for a completed short month, the actual line ends at month-end while a longer historical month may continue. No extrapolation or invented forecast is used.

Imported date bounds are necessary evidence, not proof that every transaction exists. The UI shows account bounds, original coverage warnings and import limitations. Missing history is null, not an invented zero; a zero baseline is valid only for an eligible observed cohort and does not produce a percentage. Classification remains provisional unless explicitly confirmed. These personal averages are neither targets nor population benchmarks.

Pending-count metadata is labelled as import-wide, with no assumed date/account allocation. Detailed pending rows are shown separately when the ledger actually contains them; neither representation is added to posted totals.

## Interface

Preserve FamilyHub's existing system font and tokens: ink #1c3029, muted #5c6e65, green #205744, surface #ffffff, canvas #f4f6f3 and line #dce3dd. Use green solid strokes for observed amounts and grey dashed strokes for history, with numeric labels and a legend. Color never means good/bad or savings. The annual month grid is the navigation surface; the selected month contains one comparison, a cumulative chart and category rows opening the existing source/editor sheet. A visible coverage state and expandable methodology keep the monthly view concise. Layout is left-aligned, three month tiles across on phones, six on wide screens, with a single column for detailed charts on phones. No motion is needed.

Each month's two rings share a scale within that month; the printed amounts compare months with each other. Missing, negative or both-zero comparisons keep numeric labels without inventing a progress percentage. Category bars share an axis and support net-negative refunds. The daily table provides the same values without relying on color or pointer interaction.

Private reference images guide layout only. No reference image or screenshot amount is copied into product data, fixtures, repository files or public artifacts.

## Verification

Synthetic model tests cover the prior-month window, minimum cohort, account/currency bounds, partial-day matching, disconnected intervals, refunds, independently excluded settlement legs, pending rows, zero/negative months, decision changes and calendar boundaries. Browser acceptance covers 320/390/768/1440px, keyboard return, source drill-down, saved decisions, empty/error/missing states and the existing spending period. Both suites are included in the existing finance CI commands. Public release and physical-phone acceptance are separate from these local checks; Issue #177 records delivery evidence.
