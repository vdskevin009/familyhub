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

Browser storage is scoped to the origin and profile, not a security boundary between apps on the same github.io origin. Do not store sensitive production data. There are no analytics. The Google Identity Services script is loaded only when you choose to connect Gmail for Benefits & claims. Offline assets are cached after a successful first load; close all app tabs and reopen after a new deployment to activate the waiting service worker.

## Next steps

Authenticated family sync; household membership and permissions; push reminders; conflict-safe offline sync; optional meal-planning AI.

See [architecture](docs/ARCHITECTURE.md).

## Savings tools

Use **Savings tools** beside Family plans:
- **Subscription Hunter**: monthly/annual/weekly costs, next-charge dates, duplicate-name hints, review flags and cancellation tracking. Cancellation is recorded locally; cancel with the provider separately. Savings are annualized run rates, not realized savings.
- **Grocery Price Optimizer**: manually enter comparable receipt/flyer prices, pack sizes and expiry dates. Compare unit prices and whole-pack totals for the quantity you need. Expired or incompatible units are excluded. No live prices, stock or travel-cost integration.
- **Mortgage Renewal Optimizer**: compare two manually entered Canadian fixed-rate scenarios using monthly payments and semi-annual compounding. Shows term interest, remaining balance and net interest savings after switching fees. Enter the expected balance at renewal, not today's balance. No live lender rates or applications.

Savings are stored under `familyhub.savings.v1` independently of existing `familyhub.v1` plans. Export and import savings using the separate savings backup controls. Imports validate before a confirmed replacement; failed writes do not replace in-memory saved data. Existing plans and backups remain compatible. Do not put personal data in repository issues or commits.

The install banner detects when FamilyHub is already installed and uses the browser's native PWA prompt when available, with browser-specific Add to Home Screen instructions otherwise. The manifest includes separate maskable Android icons, standalone display metadata and workspace shortcuts. Android Chrome/Edge can install FamilyHub as a PWA; iPhone/iPad use Safari → Share → Add to Home Screen. Open online once to cache the full app, then close all tabs and reopen when a new version is deployed. Installing does not create cross-device sync or push reminders.


## Benefits & claims

Use **Benefits & claims** to build a local reimbursement queue from two Gmail accounts.

- Configure a Google OAuth 2.0 **Web application** client ID in the app. Enable Gmail API, authorize the JavaScript origin `https://vdskevin009.github.io`, and add both household Google accounts as consent-screen test users while the app remains private-use/testing.
- Connect each account independently. Google shows the account picker and FamilyHub requests `gmail.readonly` plus basic identity scopes.
- Scan 3–24 months. FamilyHub looks for receipt/invoice and claim language around health benefits (physio, massage, dental, pharmacy, etc.), travel, and other likely reimbursement documents.
- Review the detected provider, amount and category, then track the item as **To review**, **Ready to claim**, **Claimed**, **Reimbursed** or **Ignored**.
- Attachment files are fetched from Gmail only when you press their download button. Full email bodies and attachments are not persisted by FamilyHub.
- The reimbursement index is stored locally under `familyhub.reimbursements.v1`. The OAuth client ID is stored under `familyhub.gmail.config.v1`; it is a public client identifier, not a client secret.

Gmail access tokens live only in JavaScript memory and are lost on reload/expiry, so accounts must be reconnected for later scans or attachment downloads. The app has no server and cannot safely hold a Google client secret or refresh token. Detected amounts are heuristics and must be reviewed before making a claim. Do not use the reimbursement index on a shared browser profile.
