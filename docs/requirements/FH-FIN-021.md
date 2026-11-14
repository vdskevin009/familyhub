# FH-FIN-021: Private contribution cards

Status: implemented locally, synthetic checks passed; live acceptance tracked separately. Extends FH-FIN-020 without changing the ledger, fiscal interpretation, source collection or pairing permissions.

## Accepted interface

- Contributions presents REER then REEE in FamilyHub's existing white/light grey/blue language. Mobile stacks the cards; wide screens may place them side by side.
- Each card shows its private personal goal, identified amount, percentage/progress, remaining amount and remaining months/days. No calendar dates, settings button or explanatory paragraphs below the cards.
- A missing plan, missing pairing, loading/error or unsupported worker is explicit. No example target, beneficiary, account, synchronized status or zero balance is substituted.
- `Voir les versements` opens an accessible native modal, with keyboard focus containment, Escape and focus restoration. The modal contains dates and detailed evidence limits.
- REER separates realized weekly transfers, future weekly estimates with the supplied assumption, and dated one-off transfers. The card's remaining amount subtracts the future estimate, but the estimate never enters progress or achieved status.
- Generic/unassigned transfers stay separate and excluded. REEE uses a personal calendar-year goal, with no assumed subsidy. An unconfirmed beneficiary or unconfirmed attribution cannot produce achieved status.
- Orange indicates required effort greater than CAD 1,000 per month, after REER's future estimate. Text accompanies the color. Actual identified amount meeting/exceeding the goal produces green plus a small check only with confirmed attribution (and confirmed REEE beneficiary).

## Private contract and calculations

Authenticated `GET /contributions/progress` returns schema 1, evaluatedOn, daysPerMonth and zero to two private plans. The frontend validates dates, safe cent amounts, unique plan/row identities, exact identified totals and internally consistent forecasts. It does not store this payload in localStorage or publish it. Unknown values remain unavailable.

Dates, goals, beneficiary and forecast assumptions come from private worker configuration, never source defaults. Deadline display uses calendar-day UTC arithmetic on date-only values. Month conversion is configurable through daysPerMonth; the modal explicitly states the convention and that it needs confirmation. No calendar-month interpretation is silently implied.

Remaining = max(goal − identified − future estimate, 0). Percentage = identified / goal. Future estimate is zero at/after the deadline. Effort = remaining × daysPerMonth / remainingDays; a zero/expired interval has no monthly amount and explicitly shows overdue remaining effort. Progress is visually capped at 100%; the textual percentage can exceed 100%. An achieved indicator is not a tax certification.

## Navigation and open questions

Contributions is reachable through Plus and `?view=contributions`. Existing Récurrent/Savings routes remain intact. Replacement in primary navigation needs a separate confirmed scope. The month convention and private beneficiary evidence need confirmation; never embed either personal fact in public documentation or fixtures.

## Verification

Unit coverage: net forecasts, strict threshold, configurable month length, expired deadlines, unconfirmed beneficiary/attribution, invalid/unknown payloads, unassigned exclusion. Browser acceptance must cover 320/390/768/1440 px, keyboard/modal dismissal/reopening/focus return, loading/offline/empty/invalid response, Back/Forward and preserved navigation. Production data and daily activation are separate private integration gates.

Local verification on 2026-11-14: web TypeScript and Vite production build passed; all six `apps/web/tests/contributions.test.ts` unit cases passed. `apps/web/tests/contributions-browser.mjs` passed at all four widths, checking card order/count, no card dates, named progress, unconfirmed achieved guard, net-effort styling, modal Enter/Tab/Escape and focus return on repeated opening, empty/invalid/offline/retry, Back/Forward and no page errors. Screenshots were visually reviewed at mobile width. Real screen-reader speech, physical phone, live source data, installed worker and publication are not established by those synthetic tests.
