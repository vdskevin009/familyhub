# FamilyHub

Tasks, groceries, meals, appointments and recurring reminders in a local-first family PWA.

[Open the app](https://vdskevin009.github.io/familyhub/) · [CI](https://github.com/vdskevin009/familyhub/actions) · [Phone workflow](docs/PHONE-WORKFLOW.md)

## MVP features

Create, edit, complete and delete entries; category filters; due dates, times, owners and notes; daily/weekly/monthly recurrence; JSON backup export and validated merge import.

## Run locally

Install the SDK pinned in global.json: .NET 11 RC1 (11.0.100-rc.1.26425.128). This is a prerelease SDK; update the SDK and ASP.NET package versions together after testing.

```sh
dotnet run --project src/Web
# Meaningful domain tests, using a dependency-free executable harness:
dotnet run --project tests/Core.Tests -c Release
dotnet publish src/Web -c Release -o artifacts/site
```

The harness exits nonzero on a failed assertion. It is deliberately run with **dotnet run**, not dotnet test.

## Repository layout

- src/Core: domain rules and calculations
- src/Web: responsive Blazor WebAssembly UI, persistence adapter and PWA assets
- tests/Core.Tests: executable domain tests
- docs: architecture, roadmap and phone instructions
- .github/workflows/ci.yml: PR checks and main-branch deployment
- scripts/setup.sh: Linux cloud environment setup

## Hosting and delivery

Public GitHub repository + GitHub Pages. No server, database, paid AI API or paid infrastructure. Standard public-repository GitHub-hosted runners are used. Changes on a feature branch go through a PR; merge to main builds, tests and deploys. Manual redeploy: Actions → Build, test and deploy → Run workflow → main.

Pages source must be **GitHub Actions** in Settings → Pages. The build changes the base href before publishing so offline integrity hashes match the Pages subpath. Rollback by reverting the problematic merge in a new PR; the revert deployment replaces the current build.

## Honest limitations

Entries are private to the current browser profile, not encrypted or protected by application sign-in. No automatic cross-device sharing; use private backup transfer. Reminders are in-app only. The public site and repository contain no personal entries.

Browser storage is scoped to the origin and profile, not a security boundary between apps on the same github.io origin. Do not store sensitive production data. There are no analytics or third-party scripts. Offline assets are cached after a successful first load; close all app tabs and reopen after a new deployment to activate the waiting service worker.

## Next steps

Authenticated family sync; household membership and permissions; push reminders; conflict-safe offline sync; optional meal-planning AI.

See [architecture](docs/ARCHITECTURE.md).

## Savings tools

Use **Savings tools** beside Family plans:
- **Subscription Hunter**: monthly/annual/weekly costs, next-charge dates, duplicate-name hints, review flags and cancellation tracking. Cancellation is recorded locally; cancel with the provider separately. Savings are annualized run rates, not realized savings.
- **Grocery Price Optimizer**: manually enter comparable receipt/flyer prices, pack sizes and expiry dates. Compare unit prices and whole-pack totals for the quantity you need. Expired or incompatible units are excluded. No live prices, stock or travel-cost integration.
- **Mortgage Renewal Optimizer**: compare two manually entered Canadian fixed-rate scenarios using monthly payments and semi-annual compounding. Shows term interest, remaining balance and net interest savings after switching fees. Enter the expected balance at renewal, not today's balance. No live lender rates or applications.

Savings are stored under `familyhub.savings.v1` independently of existing `familyhub.v1` plans. Export and import savings using the separate savings backup controls. Imports validate before a confirmed replacement; failed writes do not replace in-memory saved data. Existing plans and backups remain compatible. Do not put personal data in repository issues or commits.

The install button offers the browser's native prompt when available, with browser-specific instructions otherwise. PNG icons support Android installation and iOS home-screen use. Open online once to cache the full app, then close all tabs and reopen when a new version is deployed. Installing does not create cross-device sync or push reminders.
