# Household events → personal impact → useful action

FH-NOTIF-003..007, Issue #265. Uses the existing authenticated notification history, device registrations, preferences, generic lock-screen payload and 15-minute worker scan. No new task, key, browser permission, financial action or provider contact. Source financial records, PDFs, quotes and manual decisions are read only. Worker 2.28.0 is required; deployment and handset receipt are separate acceptance gates.

## Bank of Canada

`PolicyRateMonitor` fetches only the public official policy-rate page, with a 12-second timeout, no redirects and an hourly persistent cache. No household fields are sent. Only the Recent data table's dated target and explicit change qualify. The preceding target must agree arithmetically. Forecasts, Bank Rate, navigation dates, future announcements and changed layouts cannot become a decision. Since 2021 changes take effect the next day; announcement and effective dates remain separate.

The stable event identity is the announcement date. Target/change/effective-date corrections are material evidence changes; retrieval timestamps are not. A failed fetch preserves last known evidence without treating it as a fresh decision. Corrupt monitoring state is preserved and reported unavailable, never silently replaced. History keeps the source link. The first successful source read is a silent baseline; no old backlog is pushed. Later changes remain eligible for seven days and obey the existing one-per-day 08:00–21:00 Vancouver policy.

Personal impact reads the latest saved mortgage decision profile. A current fixed contract does not change its contractual rate; a variable contract requires its lender's prime, discount and payment mode. Missing profile facts remain explicit. No mechanical policy-to-prime relationship, new mortgage payment, quote repricing or saving is inferred. Private profile values never appear in public fixtures or source.

Official verification for this implementation: the 2026-10-28 announcement changed the target from 2.25% to 2.50%, effective 2026-10-29. Source: https://www.bankofcanada.ca/core-functions/monetary-policy/key-interest-rate/ and its linked release. These public facts are not hardcoded as household events.

## Other accepted categories

Worker 2.28.1 adds a narrow operator action through the existing authenticated, revision-checked `POST /notifications` `restore` operation: an active, actionable, unexpired policy baseline can be surfaced in the default action list. It keeps the same event ID, source facts and evidence fingerprint and stays `pushState: handled`; rescans/restarts cannot resend it. This is explicit per-event restoration, never automatic replay of the first observation or another category's history. An expired policy baseline remains historical. No announcement or household fact is created by this operation.

- **Insurance / telecom renewals:** retain documented renewal, commitment and promotion dates, structured insurance date/conflict checks and 30/7/1-day milestones. A duration does not establish a date. Read/snooze/resolve behavior remains separate from the underlying contract. Action: review renewal price, equivalent cover/service and notice conditions before the documented date.
- **GIC maturity:** retain source account/date links and 30/7/1-day milestones. Automatic delivery requires finance collection within 45 days. Action: verify maturity instructions and renewal options; no future yield or new offer is invented.
- **Regular grocery price drops:** require two distinct, reviewed, final paid receipts on distinct dates within 90 days, distinct source sets and a latest purchase within 30 days. Exact normalized product text, compatible units/currency, a reviewed local available public price, permitted store/mode/membership, explicit current validity and observation within seven days are required. No substitution, coupon/loyalty assumption or inferred consumption/stock. Both a 15% unit-price drop and an observed difference of at least two currency units after whole-pack rounding are required. Detail states product-only difference, excluding taxes, fees and travel; never a guaranteed net saving. The notification opens the exact receipt and the merchant evidence.
- **Claim submission deadline:** never infer a deadline from a service date or a general policy guess. Requires an explicit operator-reviewed rule, linked source document, correct current next insurer, open submittable dossier, no missing original or unresolved reimbursement evidence and collection within seven days. Milestones are 30/7/1 days. No claim is submitted.

The separate optional private `notifications/claim-deadlines.json` is read only by this feature. It is absent by default; the UI explicitly says the deadline evidence is missing. It can be populated only after reviewing the real policy/source and exact dossier. It is not a new secret or a financial ledger. Shape:

```json
{"schema":1,"records":[{"expenseId":"synthetic-expense","insurer":"desjardins","date":"2030-11-30","sourceDocumentId":"synthetic-source","sourceDate":"2030-10-01","sourceNote":"Explicit source rule, reviewed by the operator","confirmedAt":"2030-10-02T12:00:00Z"}]}
```

Duplicate/conflicting dossier+insurer rules and malformed evidence fail closed; the file is never automatically written. There is no production rule import, deadline editor or automatic policy interpretation in this release. No applicable rule means **missing evidence**, not that the household has no claim deadline. Existing invoices and source documents are unchanged.

## Compatibility and acceptance

New policy/grocery/claim-deadline preferences are additive; existing choices, subscriptions, VAPID identity, history and uncertain-send reservations remain intact. Old open clients may omit only the added preference keys; their saved values are preserved. New sources establish silent baselines. A source outage cannot resolve old alerts. Notification source links remain authenticated for private detail; external links are explicit public evidence links. The lock screen still contains only the generic FamilyHub text and opaque ID.

The Notifications disclosure reports the five monitored categories and missing/unavailable evidence. An unreachable PC is not represented as unconfigured Push or no registered device.

Focused tests cover actual table markup, mismatch/future rejection, cache/restart/outage/corruption, fixed/variable/unknown impact, price/quantity/source/freshness guards, claim/source/state validation, preference migration, baseline and restart dedup. Existing notification/API/transport and responsive flows remain required. Live official-source parsing, installed-worker source/hash preservation, deployed release identity and a single authorized handset test are separate checks. Provider acceptance is never physical receipt.
