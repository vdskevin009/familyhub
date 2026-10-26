# Mortgage decision assistant — FH-MORTGAGE-003..007

This extends the existing private Mortgage evidence store and source automation. Original records, the immutable 2026-10-20 reference, dated quotes and contact revisions remain append-only. No financial evidence is bundled with the static PWA.

## Daily chain and ownership

The existing hosted **Suivre les taux Mortgage** automation performs real visible Ratehub reads for four products and appends `/mortgage/snapshots`. It remains the sole Ratehub collector. Do not create another Windows task or Codex automation. The existing worker produces a report after an accepted Mortgage input change. Its existing 15-minute notification loop also checks for a missing report after 09:30 America/Vancouver. A running worker is required; missed historical days are never fabricated. The dated report shows absent/failed rates if the source automation did not succeed.

`MortgageDailyRunner` serializes concurrent runs, drains later evidence changes, caches by immutable input identities, and reuses a day's actual official collection for private corrections. A first report is a silent notification baseline. Every report is retained, including blocked and unchanged days. POST `/mortgage/run-daily` is a bounded explicit local run, not an alternative collector or scheduler. `scripts/mortgage-daily.mjs` calls it once through existing pairing and verifies readback; an uncertain request is not replayed.

Public automatic requests contain only hard-coded official URLs and generic dates/series. They never include balances, names, emails, document references or contact notes. Ratehub collection continues to verify visible purpose, balance, amortization, Vancouver, occupancy, payment and CMHC controls, all rows and actual minima; its source timestamp is distinct from the collection timestamp. Public eligibility never becomes personal approval. The current evidence contract stores minima; full browser capture remains with its collector.

## Official context

The bounded source adapter reads Bank of Canada Valet policy, three/five-year benchmark bond yields, national prime benchmark and annual CPI variation. Every item stores source URL/title, observation date, collection instant, reliability, conditions and last successful evidence. A failed request has null current value; retained prior values retain their original dates. CPI dates represent the reference month, not the publication date. A national prime benchmark does not replace the lender's own prime. TD general and mortgage prime are collected separately from its official published table and fixed public product-rate endpoint. See [MORTGAGE-SOURCES.md](MORTGAGE-SOURCES.md) for exact source contracts and effectivity versus observation dates.

The policy calendar parser accepts the explicit complete official annual table. Employment and external monetary-policy outlook have their own dated official source records; unavailable or changed markup stays failed/unknown. No probability is generated. External outlook text is separate from household rate simulations. Lender-specific prime/discount facts stay with private offer terms and must be confirmed when missing or stale.

## Private contracts and costs

`GET /mortgage` remains schema 1 and adds optional `profiles`, `terms`, `reports` and `settings` arrays, defaulting empty on older data. Capability `mortgage-assistant-v1` gates explicit writes. New paired/origin-protected POST routes are `/mortgage/profiles`, `/mortgage/terms` and `/mortgage/settings`. They append immutable validated records. Terms must reference an existing offer; reports reference preserved snapshots/offers. Duplicate IDs with identical contents are no-ops; conflicting contents fail without replacement. Reports are created by the worker, not accepted as arbitrary client results.

Profile fields separately retain balance date, principal, remaining amortization, current rate/type/payment mode/compounding, actual payment, next payment and exact maturity. Source-confirmed maturity can coexist with unknown balance/amortization. Prior working assumptions are not silently promoted. Every cost stores amount, source, as-of, valid-until and whether financed. Null means unknown, never zero. Offer terms retain validity, eligibility, approval status, compounding, fees, cashback timing, recovery, conditions and optional dated lender prime/discount evidence. A marketing total incentive is not automatically cash.

The comparison uses the same household principal, remaining amortization and **current contractual maturity**. New capital includes financed switching costs. It reports cash payments, interest and ending debt separately. Net gain is:

`current payments - new payments + current ending debt - new ending debt - upfront costs + earned cashback - applicable cashback recovery`

Financed penalties are therefore counted once and accrue interest. Break-even is the first dated economic balance that remains nonnegative for the evaluated horizon, not costs divided by payment reduction. Monthly fixed rates use Canadian semiannual nominal conversion when documented; variable compounding/payment structure must be specified. Partial periods are explicit calendar-month prorata estimates, not lender payout statements. Unsupported payment schedules or missing essential data abstain. Balance projection is bounded and labelled; historical variable paths are not invented.

A quote's expiry and configurable undated-quote age, balance age, cost dates, current term, payment structure and consistency are checked. Confirmed offer status requires explicit offer and eligibility evidence plus documented profile. An estimated result is never a guaranteed saving. Upcoming renewal/refinancing still requires a lender decision; this assistant cannot contact lenders, apply, transmit documents, change contracts or move funds.

## Scenarios and alerts

Stability and plus/minus 0.25/0.50 percentage-point variable shocks apply one calendar month after the displayed simulation date. Their calendar is visible and they affect only variable contracts. Fixed-payment variable paths preserve payments and reveal growing debt; adjustable payments are recast for remaining amortization. Bonds, policy rates, lender prime and offered rates are separate evidence, never mechanically equated.

Proposed configurable thresholds: CAD 1,000 net gain, CAD 500 material gain change, 0.10 percentage-point improvement on a comparable same-lender/product/profile/conditions observation, seven days to a documented expiry, and fourteen days for an undated quote. The UI explains these proposed values. Same evidence/fingerprint never triggers another notice. A source outage cannot refresh evidence or fabricate a gain. First-report/backlog silence is preserved. The existing notification library controls opt-out, quiet hours, grouping, daily budget, durable reservation before transport and no uncertain replay. Mortgage has its own preference; existing choices/devices/identity are preserved. Lock-screen payload remains the existing generic opaque notification.

## Mobile reading order

Mortgage opens on Aujourd'hui: what changed, whether attention is needed, net gain or unknown, freshness and next action. Taux shows two initially active observed series, four toggles, 7d/1m/3m/6m/all, a frozen reference and real quote/event markers. Missing or failed days and filter drift break paths. No retrospective prices or hidden interpolations. Touch/keyboard point selection has a data table and source detail.

Market context is separate from products. Simulations show dollars on their own charts, with dashed projections, explicit shock dates and detailed payment/interest/debt/cost breakdowns. Reports retain daily history and facts/external forecasts/assumptions separately. Offres et contacts preserves the existing private compact flow. Viewing makes no writes; saving thresholds is explicit and one-shot. Unknowns and source failures remain visible. A browser viewport is not proof of physical Samsung acceptance.

## Acceptance and release gates

Unit checks cover independent FCAC/PV/balance math, financed costs, unknown/stale inputs, dated shocks, negative amortization, break-even, source outages, date semantics and material alert dedup. Store/runner and real isolated HTTP tests verify authorization, atomic append, restart/readback, baseline preservation and no duplicate daily run. Browser tests exercise 320/360/384/412/768 widths, chart/range/scenario navigation, reports, old offers/contacts, errors and explicit threshold save.

Run `npm run typecheck`, `npm run build`, `npm run test:mortgage`, `npm run test:mortgage:browser`, applicable notification regressions and the retained .NET suite. CI is distinct from production publication and worker installation. Before installing, verify the exact authoritative process is idle, preserve protected-file hashes and all scheduled-task definitions, compile only intended changed modules against its current source, save rollback code, restart only that worker and read back health/state. Preserve unrelated in-progress work. First real report persistence and a later natural scheduled report are distinct gates; handset push receipt remains user-observed.

## Local validation, 2026-10-23

Worker and web TypeScript checks pass. The full Mortgage suite passes 69 tests; the notification lifecycle/push selection passes 39 tests including seven Mortgage integration cases. Official source adapters were verified live for seven indicators and three dated contexts. Runtime candidate compilation preserves the installed worker's newer claim preparation changes. Production installation, CI/deployment and physical handset acceptance are separate gates, recorded in issue #236.

## Integration validation, 2026-10-26

The merged PC Express intake and selectable contact comparison are retained. Embedded contact cards use the authoritative decision profile/terms and route to current-maturity simulations; legacy working assumptions cannot become displayed decision payments. All 72 Mortgage checks and 48 targeted notification/grocery regressions pass locally. Both Mortgage browser flows, Courses-to-Mortgage navigation and notification browser flows pass on their documented widths.

The authoritative existing worker is installed at 2.27.4. Nine scoped modules were installed against its current sources; all other compiled modules match. Three scheduled tasks and 52 protected files were checked unchanged. The first actual report for 2026-10-26 is persisted with seven official indicators and three context sources; baseline/history, notification preferences/devices and one-shot repeat dedup were read back. Private essential facts remain unknown and the net result remains null. The day's public-rate snapshot was unavailable at this check and stays explicitly missing. Public PWA publication, the next natural daily run and physical handset acceptance remain separate gates tracked in issue #236.
