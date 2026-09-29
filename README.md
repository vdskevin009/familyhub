# FamilyHub

FamilyHub is a mobile-first PWA that acts as a household assistant: it filters what deserves attention, helps plan meals and groceries, organizes life admin, surfaces money-saving opportunities, and can hand deeper analysis to an optional Codex worker running on your own computer.

[Open FamilyHub](https://vdskevin009.github.io/familyhub/) · [CI](https://github.com/vdskevin009/familyhub/actions) · [Architecture](docs/ARCHITECTURE.md)

## Product principles

Every feature should do at least one of three things:

1. save time,
2. prevent something important from being missed,
3. reduce avoidable spending.

The current default experience is **Claims**. Invoices and insurer source records are one tap away; the household tools remain under **Other**.

## Current experience

- **Claims** — the default healthcare reconciliation experience with its existing alerts and actions.
- **Invoices** — every indexed invoice/receipt source, independently of reimbursement status.
- **DJ / BC** — separate Desjardins and Blue Cross source-record libraries, including imported Blue Cross rows.
- **Other → Today / Assistant** — prioritized household insights, quick actions, and an optional local AI assistant.
- **Important Mail** — review time-sensitive and administrative results prepared by the paired PC agent; promotions/newsletters are filtered and uncertain classifications remain reviewable.
- **Reimbursements** — a healthcare reconciliation screen with paid, primary-insurer, secondary-insurer and outstanding totals; match-specific confidence/evidence; persistent manual confirm/reject decisions; and a dedicated mobile-first **À réconcilier** queue that presents one genuinely unmatched insurer record at a time with ranked expense candidates, in-place search and nearby context.
- **Daily PC collection** — optional offline Gmail authorization, a Windows daily task, Codex classification, bounded PDF/text attachment reading, phone retrieval, attachment downloads and remembered corrections. Low-confidence items go to **À vérifier**. See [setup and limitations](docs/DAILY-INVOICES.md).
- **Reimbursement attention loop** — conservatively reconciles health invoices with Desjardins and Blue Cross statements, follows the configured Kevin/Jasmine insurer order, refuses ambiguous automatic matches, shows the next useful action in Today, learns repeated corrections gradually, and keeps an undoable decision history.
- **Local agent chain** — scheduled Invoice Collector → deterministic Reimbursement Reconciler → Codex Needs Attention Reviewer. The second review gives evidence-linked suggestions for uncertain cases in the Reimbursements screen; it does not submit claims or automatically link doubtful records. Role boundaries are in [`agents/`](agents/familyhub-supervisor.md).
- **Google Drive archive** — optionally file a selected Gmail attachment into a sensible FamilyHub administrative folder using the limited `drive.file` scope.
- **Plan** — dinner planning, recipe library, generated grocery list, and family tasks.
- **Money** — local CSV transaction import, category summaries, recurring-merchant detection, subscription review, and Canadian mortgage scenario comparison.
- **Opportunity radar** — saved research watches that the optional local worker can run or re-check while it is online.
- **Portable local state** — browser-local data plus a combined JSON backup/restore flow.

Nothing in the UI should pretend a purchase, claim, cancellation, unsubscribe, message, bank connection, or external action happened when it did not.

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

In FamilyHub open **Other → Settings & tools → Local AI**, enter the reachable worker endpoint and pairing key, then use **Test connection**.

The worker defaults to localhost only. Do not bind it directly to a public interface. To use it from a phone, expose it only through a private HTTPS route you control (for example an existing private VPN/remote-network setup) and keep the pairing key enabled. The worker never needs to be reachable by GitHub Pages itself outside the browser session.

Environment overrides:

```text
FAMILYHUB_WORKER_HOST
FAMILYHUB_WORKER_PORT
FAMILYHUB_WORKER_DATA
FAMILYHUB_ALLOWED_ORIGINS
```

Saved research watches are persisted under `~/.familyhub-worker/`. Automatic watch checks only run while the worker process is running.

## Manual Pacific Blue Cross portal collection

Issue #92 / FH-REIMB-032 adds a read-only collector to the local PC worker. It uses the existing Blue Cross import and reimbursement reconciliation. It has **no nightly schedule**. On the PC running the worker:

```sh
npm install
npm run collect:bluecross -- --dry-run --login
npm run collect:bluecross -- --dry-run
npm run collect:bluecross -- --apply
```

On Windows, the collector uses the PC's installed Google Chrome through Playwright; Chrome must be installed and launchable for this user. On other platforms, install Playwright Chromium first with `npx playwright install chromium`.

Set `FAMILYHUB_WORKER_DATA` to the **same** private data directory used by the installed worker before these commands. `--apply` requires that updated worker to be running on localhost; the CLI sends the explicit apply request to it so a separate process cannot overwrite its live in-memory invoice state.

The first command with `--login` opens a visible browser. Sign in yourself within ten minutes, then open **View more claims / Claims History** if needed. The collector waits for the claims table; it never enters credentials or submits a claim. It selects **All Covered Lives** and **24 Months** before reading the table and checks every page against the portal grand total. Subsequent runs reuse the private browser profile. An expired session returns `login-required`; repeat the visible `--login` flow on the PC. A phone can request a preview or apply from Claims through the paired worker, but the first login must be completed on the PC.

The profile is under `<FAMILYHUB_WORKER_DATA>/bluecross/browser-profile` (by default `~/.familyhub-worker/bluecross/browser-profile`). On Windows, Blue Cross session cookies and the portal session marker for repeat previews are also saved at `<FAMILYHUB_WORKER_DATA>/bluecross/auth-state.dpapi`, encrypted for the current Windows user and never returned by the API. Immutable, minimal-fact snapshots are under `<FAMILYHUB_WORKER_DATA>/bluecross/snapshots`. These paths are outside Git. A snapshot is written before every successful or partial portal collection is considered for apply. A partial, malformed or ambiguous collection cannot be applied. Preview writes only its private audit snapshot and sync status; it does not change `invoices.json`.

A portal row marked **Pended** remains a claim with an unknown payment. It is excluded from reimbursement matching. If it contradicts an already recorded payment for the same claim, apply stops for manual review and preserves the known record.

Before enabling any future scheduling, manually confirm an accurate first preview, an immediate repeat, explicit apply, and repeated apply against the real local worker. Check Claims and **À réconcilier**, and confirm previous manual decisions remain intact. Portal layout and authentication require live validation; tests use only fictitious records.

## Manual Desjardins portal collection

Issue #36 / FH-REIMB-033 adds a separate, read-only collector for **Historique → Réclamations traitées** in the Desjardins group-insurance portal. It has **no nightly schedule**. On the PC running the worker, set `FAMILYHUB_WORKER_DATA` to the installed worker's existing private data directory and run:

```sh
npm install
npm run collect:desjardins -- --dry-run --login --repeat
npm run collect:desjardins -- --apply
```

On Windows, the visible login uses installed Microsoft Edge because Chrome may fail to launch on this PC. Complete login, profile selection, MFA and dossier selection yourself; then open **Historique → Réclamations traitées**. The collector reads all-patient/all-category results, opens claim details and checks service-line reimbursements against each list payment. It cannot submit claims. `--repeat` performs two full passes in the same login and blocks apply if their facts differ. The worker saves only Desjardins-domain cookies and portal-origin session storage with user-scoped Windows DPAPI encryption for attempted later headless dry-runs. Session reuse depends on the portal and must be verified live; if it expires or is rejected, rerun `--dry-run --login` and complete MFA yourself.

The browser profile and immutable fact snapshots live under `<FAMILYHUB_WORKER_DATA>/desjardins/`, outside Git. A dry-run writes only its private snapshot and status, never `invoices.json`. The explicit `--apply` command asks the running localhost worker to use the latest complete, unambiguous preview (up to 24 hours old), makes a ledger backup and preserves existing sources and manual decisions. It does not launch another browser or MFA challenge. Existing Excel/report rows are counted as known on exact member, service date, service description, submitted amount and paid amount. A unique historical row with the same member/date/amounts and a long service label that is an exact prefix of the portal label can also be counted as known; this never changes the historical row or creates a global service alias. Other near matches block apply for review. The paired Claims view shows Desjardins status and manual preview/apply actions. Do not enable scheduling until repeated real previews, apply, second apply and phone checks pass.

## Gmail and Google Drive

FamilyHub ships with its public Google OAuth web client ID. Keep the Gmail API enabled and the GitHub Pages origin allowed in the Google consent/client configuration.

Each household account is connected independently. Tokens are short-lived and remain in JavaScript memory. FamilyHub requests:

- `gmail.readonly` for inbox analysis,
- `drive.file` so it can create/manage only files and folders it creates through FamilyHub.

The scheduled PC scan is the authoritative mailbox-analysis path when a worker is paired. It starts with a bounded Gmail query, then applies a second deterministic filter. Marketing headers, Gmail promotion labels, bulk precedence and common newsletter/sales language lower confidence or remove the candidate. A generic mention of “benefits” or “insurance” is not enough on its own to classify an email as a claim. Browser scanning remains only as an unpaired fallback for older setups.

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
