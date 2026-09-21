# FamilyHub

FamilyHub is a mobile-first PWA that acts as a household assistant: it filters what deserves attention, helps plan meals and groceries, organizes life admin, surfaces money-saving opportunities, and can hand deeper analysis to an optional Codex worker running on your own computer.

[Open FamilyHub](https://vdskevin009.github.io/familyhub/) · [CI](https://github.com/vdskevin009/familyhub/actions) · [Architecture](docs/ARCHITECTURE.md)

## Product principles

Every feature should do at least one of three things:

1. save time,
2. prevent something important from being missed,
3. reduce avoidable spending.

The default experience is **Today**, not a collection of dashboards. FamilyHub should proactively surface a small number of useful actions and keep the rest one tap away.

## Current experience

- **Today / Assistant** — prioritized household insights, quick actions, and an optional local AI assistant.
- **Inbox** — connect two Google accounts, scan for likely bills, receipts, reimbursement items and administrative documents, heavily filter promotions/newsletters, and review before acting.
- **Daily PC collection** — optional offline Gmail authorization, a Windows daily task, Codex classification, phone retrieval, attachment downloads and remembered corrections. Low-confidence items go to **À vérifier**. See [setup and limitations](docs/DAILY-INVOICES.md).
- **Google Drive archive** — optionally file a selected Gmail attachment into a sensible FamilyHub administrative folder using the limited `drive.file` scope.
- **Plan** — dinner planning, recipe library, generated grocery list, and family tasks.
- **Money** — local CSV transaction import, category summaries, recurring-merchant detection, subscription review, and Canadian mortgage scenario comparison.
- **Opportunity radar** — saved research watches that the optional local worker can run or re-check while it is online.
- **Portable local state** — browser-local data plus a combined JSON backup/restore flow.

Nothing in the UI should pretend a purchase, claim, cancellation, message, bank connection, or external action happened when it did not.

## Technology

FamilyHub is one repository and one product:

- `apps/web` — React 19 + TypeScript + Vite PWA deployed to GitHub Pages.
- `apps/worker` — optional Node/TypeScript local worker using `@openai/codex-sdk`.
- `src/Core`, `src/Web`, `tests/Core.Tests` — retained .NET/Blazor implementation and regression harness during the migration. They are no longer the GitHub Pages deploy target.
- `.github/workflows/ci.yml` — typechecks/builds the React PWA + worker, runs retained .NET regression tests, and deploys `apps/web/dist` from `main`.

No paid hosting, hosted database, or paid AI API is required by the current design.

## Run the web app

Prerequisites: Node.js 22+.

```sh
npm install
npm run dev:web
```

Production checks:

```sh
npm run typecheck
npm run build
dotnet run --project tests/Core.Tests -c Release
```

Vite is configured for the GitHub Pages base path `/familyhub/`.

## Run the optional local worker

The worker is deliberately separate from the static PWA process but lives in the same repository.

```sh
npm install
npm run dev:worker
```

On first launch it creates a random pairing key and prints:

- the local endpoint (default `http://127.0.0.1:4713`),
- the pairing key,
- the local path where the key is stored.

In FamilyHub open **More → Local AI**, enter the reachable worker endpoint and pairing key, then use **Test connection**.

The worker defaults to localhost only. Do not bind it directly to a public interface. To use it from a phone, expose it only through a private HTTPS route you control (for example an existing private VPN/remote-network setup) and keep the pairing key enabled. The worker never needs to be reachable by GitHub Pages itself outside the browser session.

Environment overrides:

```text
FAMILYHUB_WORKER_HOST
FAMILYHUB_WORKER_PORT
FAMILYHUB_WORKER_DATA
FAMILYHUB_ALLOWED_ORIGINS
```

Saved research watches are persisted under `~/.familyhub-worker/`. Automatic watch checks only run while the worker process is running.

## Gmail and Google Drive

FamilyHub ships with its public Google OAuth web client ID. Keep the Gmail API enabled and the GitHub Pages origin allowed in the Google consent/client configuration.

Each household account is connected independently. Tokens are short-lived and remain in JavaScript memory. FamilyHub requests:

- `gmail.readonly` for inbox analysis,
- `drive.file` so it can create/manage only files and folders it creates through FamilyHub.

The scan starts with a narrow Gmail query, then applies a second deterministic filter. Marketing headers, Gmail promotion labels, bulk precedence and common newsletter/sales language lower confidence or remove the candidate. A generic mention of “benefits” or “insurance” is not enough on its own to classify an email as a claim.

Detected amounts and document types are heuristics. Review them before filing a claim or treating them as financial records. Full message bodies and attachment bytes are not persisted by the app.

## Money data

There is no live bank connection. Transaction CSVs are parsed in the browser and stored in local storage. Recurring merchants are candidates, not confirmed subscriptions. Mortgage comparisons use entered values and are estimates, not lender quotes or financial advice.

## Local storage and privacy

Current household state is browser-local and is not encrypted by FamilyHub. Do not use the app for sensitive production data on a shared browser profile. The optional daily invoice index, corrections and statuses sync through the paired PC while Inbox is open; there is no general household sync.

The combined backup intentionally excludes Gmail access tokens and the local-worker pairing key. The public repository must never contain real family records, account exports, credentials, or financial account identifiers.

## Deployment

Pull requests run typecheck/build/regression checks but do not deploy. A successful merge to `main` builds the React PWA and deploys it to GitHub Pages.

Pages source must be **GitHub Actions** in repository Settings → Pages.

## Near-term roadmap

- improve inbox classification using user corrections without sending full email bodies away,
- richer proactive Today insights and household routines,
- grocery price/opportunity inputs and eventually assisted shopping flows with explicit confirmation,
- better recurring-cost detection and financial anomaly review,
- private worker connectivity from mobile,
- authenticated household sync only if it can be added without weakening the local-first/privacy model.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for boundaries and data flows.
