# Courses — Issue #155 / FH-GROCERY-001/002

Source candidate: **Other → Courses**, with receipts/monthly spending and usual list/basket planning. Release remains Testing until final-head CI and coordinated installed acceptance. No private fixtures are committed.

## Receipts

Photograph one long receipt from top to bottom with a small overlap, or choose JPG/PNG/WebP, text or a text-bearing PDF. Original sources are saved on the paired PC before extraction. A health capability check runs before receipt bytes are sent. The existing ephemeral private Codex extracts only evidenced store/date/currency, net product prices and quantities/formats. Ambiguous currency, missing formats and overlapping rows remain reviewable. PDFs without readable text require photos/manual entry; HEIC needs conversion to JPG.

Review originals, correct rows and explicitly confirm uncertainties before recording an actual purchase. Drafts do not count in spending. Source hashes deduplicate reordered/repeated batches; possible same-store/date/currency/total duplicates require distinct-purchase confirmation or explicit attachment to the saved purchase. Genuine repeated physical product rows remain separate. Stale revisions/extraction failures preserve sources and corrections. Extraction cannot replace manual rows or saved purchases. Interrupted extraction reports failure on restart and never replays automatically.

Monthly totals separate currencies and known delivery/service/tips; frequent products and unit prices link to dated historical sources. Purchases do not measure consumption. Historical price differences are leads to review, not current offers or guaranteed savings. Bank movements and receipt purchases are never added into one ledger.

## Usual list and baskets

Start empty or explicitly copy unchecked Plan products. Original Plan records/checks stay unchanged; unclear quantity strings remain notes requiring entry. Desired quantity × format, unit, preferences, inclusion and substitution permissions are editable. Shared PC planning writes require the current revision. On conflict, compare PC data before explicitly replacing either version. Local drafts support reconnect/retry.

Every price records exact product/store/currency/format, price, tax rate, availability, source/date/validity and reviewed match. Unreviewed/unavailable observations are excluded. Historical receipt prices cannot support a current recommendation. Public prices require HTTPS source links. Price edits reset review confirmation. Compatible units normalize to kg/l/unit; whole packs round up and weighed products remain proportional.

Retailer terms model delivery, fixed service plus percentage service, fee tax, minimum order and optional free-delivery threshold. Enter 0 only for a confirmed absence; blank required charges remain unknown. Optional tip defaults explicitly to zero per order. Confirm actual home delivery coverage and condition validity. Unmodeled membership costs, deposits/bag fees/surcharges or minimum-service rules block recommendation through the mandatory-fees confirmation; they are never silently estimated. Minimum applies to pre-tax product subtotal; product tax rounds per line and fee tax per order, so final retailer rounding may differ.

Whole-store and split baskets retain all supplied pack alternatives, including nonlinear delivery thresholds, within 5,000 combinations. Split options use at most three stores. Missing items, prices, quantities, taxes, mandatory fees or minimums cannot produce a complete total. Unknown stock/home area/delivery coverage/validity, expired or historical prices and unmet minimums yield conditional estimates. Only fully modeled reviewed sourced options can receive “lowest estimate among the entered fully priced options”; there is no global market claim. Truncation suppresses the best-basket label.

## Public research

The user reviews a generic product and confirms their actual home city/Canadian postal prefix, not a trip location. Research rejects exact addresses and full postal codes. Only those two whitelisted values reach a read-only search through the existing Codex account/binary. No receipt, household list, quantity, preference, bank/contract data, private history, new provider/account, order, subscription or automation is involved. Shell/MCP/apps are disabled; history is ephemeral, errors sanitized and temporary files deleted. Up to eight official-retailer observations require user review before adding; unavailable prices/formats/currency stay null. Research cannot auto-apply a price or confirm stock.

Official policy checks on 2026-10-10: [Instacart Canada fees](https://www.instacart.ca/help/section/360007902791/360039164252) describes retailer/window/order-dependent delivery charges and additional service fees; [Walmart Canada conditions](https://www.walmart.ca/en/help/article/walmart-faqs/4e31d6df48e44999ba47a14d72cb8ecb) includes scheduled-delivery/location exclusions. These are guidance, not household quotes; no prices/fees are prefilled. Actual household service area and usual products remain unconfirmed in this task.

## Storage and API

All `/groceries` routes use existing origin/pairing checks and no-store responses. GET `/groceries` lists purchases; POST `/import` preserves source batches; POST `/:id/extract`, `/:id/review`, `/:id/duplicate` use expected revisions; GET `/:id/sources/:hash` returns an original belonging to that record. GET/POST `/groceries/planning` reads/saves the shared plan. POST `/groceries/research` takes reviewed generic product/coarse area. Health capabilities: `grocery-receipts-v1`, `grocery-planning-v1`.

Dedicated PC files: `groceries/purchases.json` and `groceries/planning.json`. Receipt limits: 2,000 records / 100 MiB total bytes; 8 sources / 20 MiB per receipt; 5 MiB per source. Planning limits: 60 products, 8 stores, 300 prices. Damaged PC stores fail closed without replacement. IndexedDB `familyhub.groceries.v1` holds pending upload, endpoint-scoped history/edit/plan drafts. Existing browser backup does not include this library; include the dedicated PC directory in operator backups. Clearing browser data loses device-only work but preserves saved PC records.

## Validation and delivery

After build, run `npm run test:groceries` and `npm run test:groceries:browser`, existing PWA/Savings/Finances/invoice checks and retained .NET checks. Fresh browser profiles/temp localhost stores cover synthetic sources, extraction/save retry, duplicates, reload, stale writes, offline history, incomplete comparisons and 320/390/768/1280 layouts. Representative real receipts, physical phone pairing and live public Codex research remain separate acceptance checks; synthetic mocks do not prove them.

Shared source edits are additive in App/types/domain, worker index/private Codex, package/CI and requirements/architecture. Preserve newer finance categories, notification routes/capabilities, insurer/auth fixes and fresh private state. Runtime sequencing belongs to parent/Auth owner: never reset installed code to source main or restore old private snapshots.
