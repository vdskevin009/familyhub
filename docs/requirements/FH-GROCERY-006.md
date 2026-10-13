# FH-GROCERY-006 — Minimal article prices and offer details

Status: Testing. Work item: #155. Supersedes the article-row presentation in FH-GROCERY-005; its unit calculations remain unchanged.

Each article displays store, normalized unit price and percentage gap only. Incompatible, unavailable and missing observations remain visible with an explicit compact state. One Détails button opens a native modal containing the recorded product, format, package price, need, unit comparison, proportional equivalent and whole-package purchase cost, source/date, mode, locality, review state, taxes, deposits and retailer fees/conditions. Purchases and proportional quantities do not measure consumption.

The modal supports Escape, close, Return, contained keyboard focus and restoration to its article button. Opening/closing it does not save, approve or change any plan. Product links are offered only for recognized recorded product URLs; recorded search URLs are labelled as searches. Other safe recorded URLs remain source links. No URL, density, dose, stock or live market price is invented. Public HTTPS validation rejects credentials and local targets.

Compact vertical store rows compare an identical shared subset of selected articles at identical physical quantities. Different pack sizes are accepted within a known dimension: select the format closest to the desired format, then break ties by unit rate. For labelled uses with no desired pack size, use the lowest observed rate and explicitly qualify that selection. Show the proportional estimate and whole-package purchase cost separately in the popup. Missing quantities, incompatible dimensions and uncertain formats are excluded; no density or dose is inferred. The shared subset/count and estimated status stay visible. A partial base is not a complete basket or a saving after fees. Original purchasing calculations/fees remain available in the popup and unchanged.

Scope: frontend presentation, display-only common-quantity estimate, URL labels, synthetic tests and this technical requirement. No worker API, schema, installed runtime, private-state mutation or new external service. Publication of both refinements was explicitly approved on 2026-10-12 (last confirmation 19:43 UTC).

Validation: typechecks/build; unit/comparison regressions; synthetic receipt and planning flows at 320, 390, 768 and 1440 pixels; Return/close/Escape/focus/tab containment, recorded-link popup and reload with unchanged selection/quantities/approval. Exact CI and release acceptance references will be recorded in the PR/work item. Physical phone and real receipt acceptance remain unverified.

## Compact basket refinement (2026-10-12)

Status: implementation under test, not published. The identical common-base amounts are sorted ascending, unknown amounts last, with deterministic alphabetical ties. Each full store row is a keyboard-accessible Details button. Partial coverage, excluded fees, review state and purchase modes remain concise and visible; mixed modes are labelled. Calculation explanations remain in collapsed Info or Details. Whole-pack purchasing costs stay separate from proportional estimates. No appwide color/launcher change or persistent-state/backend change. Publication and real acceptance are separate gates.

## Comparison coverage (Issue #203)

Status: Testing; publication pending. Count selected articles with comparable unit rates at two or more distinct stores prominently, independently of quantities required for the total. Multiple variants at one store do not constitute a comparison. Unknown household quantities still allow sourced unit-rate comparison; mass, volume, units and labelled uses remain separate.

The common-total count explicitly says “pour le total”. A collapsed store selector changes only this display calculation, preserving all article comparisons and every saved plan field. Default participants retain the existing calculable-store set; a store explicitly selected without compatible references must reduce shared coverage, never silently disappear. Changing store selection requires recomputing one identical subset and quantity at each chosen store; unequal partial totals cannot be ranked. Empty/single-store selections have no competitive claim. Details identify missing quantity/desired format/capacity or the selected store without a compatible reference. No new research, price, household quantity, unit conversion, dose, approval, worker or persistent-state change.

## Superseded quantity exclusion (2026-10-12)

FH-GROCERY-007 supersedes the exclusion of unknown physical household amounts from the display-only common total. Explicitly labelled equal reference quantities are now allowed by the user. The source, format, currency, dimension, store-selection and recommendation safeguards remain in force. See [FH-GROCERY-007](FH-GROCERY-007.md) and #205.

## Mobile basket detail readability (2026-10-13)

Status: Testing; release pending. The basket sheet puts the proportional total and concise partial coverage/fees/review state first. The initial phone viewport shows several article names, common quantities and aligned proportional amounts. Each article is a collapsed, keyboard-operable disclosure; expanding it reveals the full recorded product, whole-pack/weight purchase cost, calculation, reference-quantity caveat, selection rationale, mode/location/availability and dated source. Method, exclusions and original retailer conditions remain available below the list. This presentation does not change FH-GROCERY-007 equal reference quantities, selected stores, calculations or saved data. The total is explicitly proportional, not a checkout amount.

Validate with at least seven synthetic items and long product names at 320/390/412 phone widths, short viewports, multiple initially visible price rows, scrolling and footer geometry, repeated touch/keyboard disclosures, close/Escape/focus return, reload and unchanged saved plan. No private screenshot content or household records enter repository fixtures.
