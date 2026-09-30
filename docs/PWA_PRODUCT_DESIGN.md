# FamilyHub PWA product design — FH-UX-001 / Issue #108

## Scope and invariants

This is a frontend product redesign of the existing FamilyHub application, not a replacement demo. No worker, collector, agent, domain reconciliation, financial calculation, API client contract, or durable data-schema changes are included. The optional PC worker is not restarted, scanned, repaired or imported as part of design validation.

Claims remains the default. Invoices, Desjardins, Blue Cross and Other remain available, including Today/Assistant, Important Mail, Plan, Money and settings/tools. Named insurer amounts, unknown-vs-zero facts, workflow overrides, confidence, match evidence, same-day candidates, manual actions, PDF sources and ignored history are retained.

## Design and interactions

- One compact page heading instead of a global header followed by another large page introduction. Desktop uses a labelled rail; mobile keeps five bottom destinations with safe-area padding. Browser Back/Forward works between views, with per-view scroll restoration and a keyboard skip link.
- A neutral surface palette and deep green accent, semantic warning/error/info/success styles, shared typography, spacing, radii and 44px controls live in `src/ui/tokens.css` and the consolidated `styles.css`. Reduced-motion and visible keyboard focus are covered.
- `PageHeader`, `Sheet`, `SearchField`, `FilterButton`, `FilterChips`, `Notice` and `SkeletonList` provide reusable UI primitives. Native modal dialogs provide background isolation, Escape/close, focus restoration and explicit Tab wrapping. Sheet content scrolls independently on smaller screens.
- Claims shows family scope, a compact recoverable summary, search and workflow tabs. Portal sync/coverage controls move to an explicit Sources sheet without automatically collecting or changing their contracts. Advanced filters move to a sheet with removable active chips; the original inclusive claims date range and exclusive library Before boundary are preserved.
- `ClaimCard` aligns Expense / Desjardins / Blue Cross / Remaining, with visible status, source evidence and confidence. One-tap details expose all former explanation, workflow history, PDF options, match evidence and manual candidate actions. Selection is opt-in; bulk Ignore still acts on the visible selected IDs and retains unsuccessful selections.
- Search/filter/scope choices survive leaving and returning to a view within the same browser tab. These are new, non-financial `familyhub.ui.*` session-storage entries; no existing durable storage key is migrated or cleared.
- The presentation-only `MutationQueue` gives immediate queued/saving/refreshing feedback for each record. Different records can be queued without locking the whole screen. Writes are serialized, duplicate keys are rejected synchronously, and one authoritative refresh follows each drained batch. Amounts/totals are never optimistically guessed. An explicit false acknowledgement, a rejected write, and a saved write whose refresh fails are reported differently.

## Verification and limits

### Local checks completed before publication

- Frontend TypeScript check and production Vite build.
- Existing PWA installability metadata tests plus 11 new product tests (13 tests total).
- Synthetic browser rendering of the actual built JS/CSS for ten routes at 320, 390, 768 and 1440 CSS pixels, with no observed horizontal overflow or page exceptions.
- Claims filters/date bounds, removable chips, persisted search/navigation, keyboard-modal containment, status queuing/deduplication, successful-write/read-failure recovery, rollback after a refused write, evidence/PDF controls, source panel isolation, reconciliation search and source-library filters.
- On the same fictitious 390x844 fixture, the first claim starts at approximately 379px instead of 624px; the first detailed claim card is approximately 321px tall instead of 837px. These are fixture measurements, not performance claims about every real record or phone.

The local browser environment blocks HTTP navigation by policy. Its `--inline` mode renders the real built bundle with synthetic storage/fetch and does **not** prove HTTP routing, live worker connectivity, service-worker upgrades or physical-phone behavior. The separate HTTP mode and normal repository CI must pass before release. Release evidence and any remaining installed-phone acceptance are recorded in Issue #108 / its implementation PR; never interpret merge alone as live acceptance.

No real invoices, reimbursement records, credentials or financial account data were used in test fixtures or screenshots. Do not test the redesign by changing real financial statuses without the operator's explicit approval.

## Run checks

From the repository root:

```sh
npm install
npm run typecheck
npm run build
npm run test:pwa
npm run test:invoices
dotnet run --project tests/Core.Tests -c Release
```

For the synthetic browser suite (requires Python Playwright and Chromium):

```sh
python -m pip install playwright
python -m playwright install chromium
(cd apps/web && npx vite preview --host 127.0.0.1 --port 4173)
# In another terminal:
python apps/web/tests/browser_smoke.py --url http://127.0.0.1:4173/familyhub/ --output artifacts/pwa-product
```

Use `--inline` only in restricted rendering environments, and label its results accordingly. Neither mode contacts a real PC worker. Screenshots and `report.json` are generated in the chosen output folder and should remain build artifacts, not real household data in Git.
