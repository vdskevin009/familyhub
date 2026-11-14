# Reviewed finance screens

FH-FIN-022 implements the owner's approved four-screen review while retaining the existing three tabs. The operations detail opens immediately below the spending summary, retains query/scope/category and review choices on return, supports date or amount ordering, and keeps explicit source editing and undo. Totals show spending less refunds and are never labeled available cash. Investment accounts keep their individual dated values and all detailed holdings, cash flows, history, fees, GIC and source views. No incompatible consolidated net worth is invented.

Trend bars replace rings while keeping twelve months, common annual/detail scale, signed refunds, partial-period disclosures, daily values, categories and pending separation. All original classification and calculation logic remains authoritative.

## Evidence and privacy

A successful paired PC refresh is not a new bank synchronization. Collection/import timestamps do not establish balance age. Finances plugin reads on 2026-11-14 returned accounts and full-history transaction coverage with unknown freshness. Holdings and investment-transaction queries returned empty arrays without coverage: these are unavailable/unproven, not confirmed empty portfolios. No real data belongs in source, screenshots or tests. No bank transaction, new account permission or public data upload is implemented.

## Validation gates

Use existing finance model/API and browser suites. Verify 320/390/768/1440px, repeated operation entry/back with focus restoration, filters/sort, edits/undo, investment drilldowns and trend parity. Typecheck/build and source-only tests are not deployment. Exact CI, Pages identity, installed runtime, genuine private mapping/import and future daily automation must be verified independently. The concurrent Gmail/contributions release owns the active runtime and publication until handed over.

## Local checks completed

Web and worker TypeScript checks and production PWA build pass. Finance model/API/edit tests (42) and plugin adapter tests (18, including 10 broad-feed cases) pass. Synthetic Edge browser suites pass at 320/390/768/1440px for full finance/import/edit workflows, card repayment exclusions, inline editing, change/undo/retry/conflict, trends and compact screens including repeated Operations entry/back and retained filters. Screenshots were inspected. .NET was not run: no dotnet executable was found on PATH or the standard system/user locations. This must be checked in CI before release.

The local script scripts/Sync-FinanceFeed.mjs reads only an explicitly supplied private directory, defaults to preview, requires an exact reviewed revision, and never logs raw source rows or the pairing key. An --apply invocation must follow reviewed mapping/preview and the owner's scope. No full-feed schedule or real-data apply is enabled by this code.
