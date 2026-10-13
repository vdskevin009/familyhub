# FH-GROCERY-008 — Receipt-backed product brands

Status: Testing. Issue #208.

Display confidently identified exact products (including their recorded brand/variant) from saved, reviewed nonduplicate receipt lines on corresponding household articles. Manual reviewed transcription is valid even when automated extraction is pending or failed; a running extraction is excluded. A missing quantity or price does not prevent using a confirmed product identity. Reject uncertain lines, absent product/evidence, ambiguous names, conflicting or nonexistent explicit associations. Match explicit reviewed article associations first, then receipt-linked historical prices with exact products, then unique exact names; no fuzzy brand guesses. Keep every distinct observed product, without choosing an exclusive favourite. Search local articles by these product labels.

An article editor shows source store/date and offers an explicit additive preference action, preserving manual text and the 500-character limit. Reading receipts/displaying labels never mutates the plan, quantities, cadence, selections, prices or approvals. Refresh rereads existing receipts; endpoint changes clear previous labels. Receipt-read failures are visible and leave planning usable. No worker/API/schema upgrade or installed process restart.

Public research lets the user select a confirmed product label, review/edit the exact public product/brand query and coarse home area, and confirm before dispatch. Transmit only product, area and confirmation through the existing API. Never automatically copy preferences, receipt evidence, identifiers, store/date or private context into that query. Long labels require manual shortening, never silent truncation. No automatic public research, cart or order.

Model tests cover uncertain/duplicate/unreviewed tickets, exact and explicit matching, ambiguity, multiple products, missing quantities, additive preferences, output privacy and preservation. Synthetic browser checks exercise branded query selection, confirmation reset, exact request body, article display/edit and responsive layouts. Exact CI/public release and physical phone acceptance are separate gates.
