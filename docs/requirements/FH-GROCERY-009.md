# FH-GROCERY-009 — Products-first needs list

Status: Testing. Work item: #155. Refines the mobile needs-list presentation in FH-GROCERY-003.

Courses → Besoins → Ma liste prioritizes product count, Add, basket scope and actual product rows. Remove the duplicate explanatory heading and subtitle from this flow. Keep occasional sync, copy-from-Plan, weekly proposal and explanatory/filter settings in one native, collapsed-by-default Détails et filtres disclosure. An active search or cadence filter remains indicated when it is closed. Dirty drafts keep a visible Save action outside the disclosure; pairing, receipt errors and revision conflicts remain explicit.

Preserve all existing controls and their disabled/busy safeguards, source-backed receipt brands, product editing, basket selections, quantities, prices, comparison calculations, revision-protected saves and offline drafts. No worker/API/schema or household-data change. Opening and closing details, switching view, scrolling or cancelling an editor never saves or changes the plan.

Implementation: GroceryPlanningView, CoursesView and scoped grocery.css. Validate 320/390/412 mobile and desktop widths with products visible before scrolling, 44px actions, no horizontal overflow, accessible disclosure, last-row clearance above navigation, repeated editor open/cancel/Escape/focus return, active-filter indication, ordinary reload and unchanged saved data. Keep existing two-device, offline, capability, failure, receipt-brand, compare and basket regressions.

Local web/worker typechecks and builds and non-browser model/presentation tests pass. The current execution environment cannot launch Chromium; draft-PR CI must pass the browser checks, and its synthetic screenshots must be reviewed before merge/deploy. Physical-phone acceptance remains separate. No private screenshots or household records are included in test fixtures.
