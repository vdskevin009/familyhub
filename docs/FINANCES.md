# Private finances and recurring services

Issues [#162](https://github.com/vdskevin009/familyhub/issues/162) and [#163](https://github.com/vdskevin009/familyhub/issues/163). Requirements FH-FIN-001/002/003 and FH-SAV-007.

## Interface

The existing app gains a primary **Finances** destination with exactly two tabs: **Dépenses** and **Investissements**. The existing Savings destination starts with services and expense items, followed by contracts/packages and public-offer comparison. No new app, cloud database, bank connector or provider permission is required.

```text
Finances                           Actualiser
[ Dépenses ] [ Investissements ]
Sources et import privé (collapsed)
Dates / account / currency
Net imported spending + review count
Category bars     |     Monthly trend
Transactions → classification, evidence, save
Public reference cohorts + methodology
Repeated-charge observations → contracts

Investissements
Dated account values → selected account
Positions / cash / source quantities
Contributions / transfers / grants / direct fees
Source value history, annual fees, GIC maturity

Savings
Services → original contract and attachments
Known monthly equivalents, per currency
Contracts/packages → existing comparison workflow
```

The visual treatment uses the app's green, neutral surfaces, type scale, native modal and existing controls. Horizontal labeled bars retain exact numeric text; negative refunds have a distinct color and minus sign. Two chart columns become one on phones. Dates, account, currency, category and description filters never mutate sources. Category decisions use the existing modal focus containment, visible errors and explicit Save. Browser acceptance covers 320, 390, 768 and 1440 pixels with synthetic screenshots under ignored `output/playwright/finance/`.

## Private import and preservation

`familyhub.td.preparation.v1` is an adapter for an already retrieved preparation, not a live bank connection or a general CSV importer. It validates integer cents, source signs, real dates, account references/currency, row identities and holdings totals. The UI previews counts before an explicit apply. Source JSON, including unknown extension fields, is archived under the paired worker's `finances/sources/<sha256>.json`; original files are not moved or modified. The digest identifies the serialized JSON object, not the whitespace of the uploaded file. Original document hashes remain separate source evidence.

`finances/ledger.json` contains normalized facts, import hashes and a separate decision overlay/history. Every import and edit is serialized and requires the current revision. Duplicate bundle imports are no-ops. Repeated stable identities must retain the same financial facts; conflicts stop without replacing the ledger. New bank identities with the same source fingerprint/occurrence require review and do not enter totals. Genuine repeated occurrences remain separate. Ambiguous duplicate investment activities stop import for source reconciliation. Older imports cannot replace newer account values. Historical rows, holdings, GIC facts, fee reports and portal series remain retained; pre-import ledger backups preserve earlier source windows and coverage.

GET `/finances`, POST `/finances/import` and POST `/finances/decision` reuse pairing, allowed-origin and no-store protections. Reads and previews do not initialize storage. No endpoint accepts credentials or reads arbitrary paths. Financial history is kept in React memory and the private PC store, not browser local storage, public Pages assets, public research or the general browser backup. Back up the existing private worker directory separately. A damaged ledger fails closed and is never silently reset.

## Spending interpretation

Descriptions produce **suggestions**, not verified merchant receipts. Groceries and restaurants are separate, as are housing, mortgage payments, utilities, transport, childcare, child/family purchases, subscriptions, communications, health, leisure, clothing, household purchases, travel, fees and exceptional projects. Ambiguous credits and transfer/investment hints remain reviewable. Transfer and card-payment suggestions are excluded; merchant refunds retain the source credit sign and reduce their assigned category. Manual decisions override suggestions without changing amounts, dates or sources.

Mortgage payments remain whole cash outflows. No principal/interest split is inferred. Currencies have separate totals with no assumed exchange rate. Source-window and coverage-limited months are labeled partial, never extrapolated. A full observed calendar window is not proof that all household accounts or expenses are present. The initial view uses the latest six completed calendar months inside the imported window. Earlier retrieved rows remain available through date filters; the coverage panel reports observed dates and source warnings.

Repeated exact account/merchant descriptions among subscriptions, communications and fees show the previous and latest dated charge, count and observed period cost. A difference is a review lead, never a confirmed price increase, duplicated service, cancellation recommendation or projected saving. Existing Savings contract evidence is the next review step.

## Investments

The account registry supplies names and types, including registered plans and deposits where present in the source. Each balance keeps its as-of date. There is no sum of unsynchronized account snapshots and no fabricated current market value. Latest source positions and cash form the allocation; title-based asset classifications are not invented. Portal value history is labeled as balance history, including contributions and withdrawals, not investment performance calculated from incomplete flows.

Source `CONT`, transfers, grants and directly debited fee actions remain distinct. Purchases, sales and reinvestments are not contributions. Annual fee reports remain independently sourced and are not added to already visible fee debits. GIC principal/rate/maturity are displayed only when sourced. Contribution room, grant eligibility, total embedded fund costs and future returns remain unknown unless separately evidenced. No order, contribution or renewal instruction is submitted.

## Public spending references

The 2023 Survey of Household Spending references were retrieved on 2026-10-10 using the revised 2026-09-18 release, reweighted to the 2021 Census:

- [Table 11-10-0222-01](https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1110022201): British Columbia, all households.
- [Table 11-10-0224-01](https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1110022401): Canada, ten provinces, couples with children, excluding additional persons; children of all ages and counts.
- [Revision notice](https://www150.statcan.gc.ca/n1/daily-quotidien/260918/dq260918a-eng.htm), [methodology](https://www150.statcan.gc.ca/n1/pub/62f0026m/62f0026m2025001-eng.htm), [questionnaire](https://www.statcan.gc.ca/en/statistical-programs/instrument/3508_Q1_V21).

`finance-benchmarks.ts` retains annual CAD values and vector IDs. The displayed monthly reference is annual/12, in nominal 2023 dollars. Averages include nonspenders and are neither medians nor recommended spending targets. No exact local two-adult/toddler cohort is claimed; the two profiles are never blended or scaled by family size. Suppressed F values remain unavailable.

Shelter includes utilities and other accommodation; communications and childcare are nested household operations. These lines must not be summed. Supermarket charges may contain non-food items, restaurant alcohol has a different survey definition, and transport includes net vehicle purchases and travel. Personal comparison stays unavailable for partial windows, individual-account filters, unreviewed/uncertain rows, non-CAD or unmapped/incompatible categories. No overall ratio, income ratio, mortgage-interest estimate or inflation adjustment is fabricated. Category confirmation still requires the operator to reconcile mixed receipts to the displayed definitions.

## Recurring contracts

Optional `billing` preserves original amount, currency, unit/count, as-of date, source description and tax status independently of the legacy contract price. Missing current amounts can explicitly be null even if a historical price exists. Monthly equivalents use months/count, annual/12, weekly ×52/12 or daily ×365.25/12. An irregular utility bill is an annualized reference, not a prediction. The old promotional price retains its original legacy cycle.

Optional `services` hold names, source and `included`, `shared` or `documented` pricing. Included/shared items cannot carry an individual amount. Documented individual monthly amounts require a source and their own tax status. Totals count each contract once, separate currencies and show unknown counts. No equal allocation of a multi-line plan or bundle is assumed. Service rows open the existing editor and its PDF/image/text attachments; attachment, download, backup, sharing/conflict and public-summary privacy rules remain in force. Billing/service source text and documents never enter public-offer research.

## Verification and release boundary

Run `npm run typecheck`, `npm run build`, `npm run test:finances`, `npm run test:finances:browser`, the existing Savings/PWA/invoice checks and retained .NET regression harness. CI includes the new private finance and responsive checks. Public fixtures and screenshots are synthetic. Existing-worker deployment, the private import, preserved-file audit, exact Pages release and physical-phone acceptance are separate gates; record observed outcomes in the issues rather than assuming merge establishes all of them.
