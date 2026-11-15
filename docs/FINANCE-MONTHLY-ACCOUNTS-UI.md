# Monthly Accounts UI — FH-FIN-026

Frontend delivery, pending integration and publication. The Accounts tab follows the approved monthly mockup: chevrons, filters, total, compact account rows, details behind information controls.

- Reads capability-gated account-captures and immutable account-history endpoints. No imports, provider calls, private browser persistence or runtime changes.
- Chooses one version. Latest source capture is preferred over a later legacy batch; partial newer source remains partial. Historical default prefers the complete recorded scope over intake fragments. Other versions remain selectable in the info panel.
- Monthly buckets and receipt labels use UTC. Source dates are never receipt dates. Empty months have no total.
- Per-currency source totals use the shared validated signed net helper. Historical totals preserve original signed values and have an explicitly recorded-total label, never certified net or performance. Unknown values stay excluded and visible.
- Historical drilldown uses only the archive's exact canonical ID if present in the current register; recent source IDs never infer a link. Existing positions, activity and evolution remain accessible via the historical register.
- Refresh clears old data and rejects stale requests across generations and worker credentials. Filters and month survive detail navigation.

Verification: model/client tests, web/worker typechecks, production build and synthetic Edge browser acceptance at 320, 390, 768 and 1440 pixels. Browser exercises monthly/archive navigation, exact historical drilldown, currency and account filters, UTC receipt, per-credit-field dates, keyboard, stale responses, empty/unsupported/error states and no writes/cache. Screenshots use fictional data only. Full integration/CI/runtime verification belongs to the release coordinator.

Local results: 15 model/client tests passed; monthly accounts, existing finances, observations and source-inventory browser suites passed at all four widths. Pixel inspection completed at all four widths. The .NET SDK was unavailable locally; CI and release checks remain required.
