# FamilyHub architecture

## Product decision

FamilyHub is a **mobile-first, local-first life assistant** rather than a dashboard. The deployed product is a React/TypeScript/Vite PWA. An optional Node worker can run on a household computer and use the Codex SDK for deeper reasoning/research. Both live in this repository so the product remains coherent and manageable.

The architecture optimizes for:

- no mandatory new paid subscription,
- static hosting on GitHub Pages,
- explicit user control over external actions,
- minimal persistence of sensitive Google data,
- a private local execution path for AI-assisted work,
- graceful usefulness when the local worker is offline.

## Components

### 1. React PWA — `apps/web`

The PWA is the user-facing product. It owns navigation, local persistence, deterministic calculations, Google browser integrations, and the HTTP client for the optional local worker.

Primary areas:

- **Today** — prioritizes a few actions/insights.
- **Inbox** — Gmail triage and document review.
- **Plan** — meals, groceries, recipes and household tasks.
- **Money** — spending imports, subscriptions and mortgage scenarios.
- **More** — worker pairing, Drive archive settings, research watches and backup/restore.

The app is deployable under `/familyhub/` and must remain installable as a PWA.

### 2. Google browser bridge — `apps/web/src/google.ts`

Google Identity Services obtains short-lived browser access tokens. Tokens live only in memory.

Scopes:

- `gmail.readonly` — read candidate messages.
- `drive.file` — create/manage only Drive files FamilyHub creates.

Inbox processing is two-stage:

1. a narrow Gmail query reduces the candidate set;
2. deterministic local scoring rejects promotion/newsletter/bulk mail and requires stronger evidence for receipts, bills, claims and administrative documents.

Only the normalized local index/status is persisted. Full Gmail message bodies and attachment bytes are transient.

Drive filing is user initiated. FamilyHub proposes a deterministic path such as:

```text
FamilyHub/Administrative/Health/Claims/<year>
FamilyHub/Administrative/Travel/<year>
FamilyHub/Administrative/Finance/Bills/<year>
FamilyHub/Administrative/Purchases/<year>
```

The source Gmail message remains traceable from the Inbox UI.

### 3. Local Codex worker — `apps/worker`

The worker is optional. It runs on the household computer and exposes a small authenticated HTTP API to the PWA:

```text
GET  /health
POST /tasks
GET  /tasks/:id
POST /watches
GET  /watches/:id
POST /watches/:id/run
GET  /invoices
POST /invoices/collect
POST /invoices/:id/correction
POST /invoices/:id/status
GET  /invoices/:id/attachments/:attachmentId
```

Default network binding is `127.0.0.1:4713`. A random pairing key is generated locally and required on every API request. CORS is restricted to configured FamilyHub origins.

The worker uses the locally configured Codex SDK environment. Tasks are intentionally narrow:

- general household analysis,
- meal-plan suggestions,
- financial review of supplied summaries,
- document classification assistance,
- opportunity research.

The worker prompt explicitly forbids pretending that purchases, messages, seller contact, sign-ins or other external actions occurred. Research watches may re-run automatically only while the worker is running.

For phone access, the worker needs a **private HTTPS route** from the phone to the computer. Do not expose the localhost service directly to the public internet. The pairing key is defense in depth, not a complete network perimeter.

### 4. Browser-local state

Existing storage keys remain isolated by feature so earlier data can survive the migration:

```text
familyhub.v1
familyhub.savings.v1
familyhub.reimbursements.v1
familyhub.planner.v1
familyhub.spending.v1
familyhub.research.v1
familyhub.worker.v1
familyhub.admin.v1
```

The v2 combined backup exports the household data stores but deliberately excludes Google tokens and the worker pairing key.

Local storage is convenient, not an encrypted security boundary. General household sync is not implemented. The optional daily invoice index and its corrections/statuses sync through the paired worker; see [Daily invoices](DAILY-INVOICES.md).

### 5. Retained .NET code

`src/Core`, `src/Web` and `tests/Core.Tests` remain temporarily while React replaces the original Blazor UI. The .NET executable test harness still runs in CI as a regression safety net for previously implemented domain behavior.

The GitHub Pages artifact is now **only** `apps/web/dist`.

## Data flows

### Gmail triage

```text
Google OAuth token (memory)
        ↓
Gmail candidate query
        ↓
transient message normalization
        ↓
local deterministic classifier
        ↓
browser-local review index
        ↓
user review / claim status / optional Drive archive
```

### Local AI task

```text
PWA creates minimal summarized context
        ↓
private HTTP request + pairing key
        ↓
local worker
        ↓
Codex SDK task
        ↓
result returned to PWA
```

Full Gmail bodies are not included in the assistant household summary.

### Opportunity watch

```text
PWA watch definition
        ↓
local worker persistence
        ↓
manual or due-time Codex research
        ↓
dated result returned/persisted
```

A result is a research lead, not proof of current stock/price until verified.

## Security boundaries

- Never commit secrets, Gmail tokens, pairing keys, personal records, bank exports or real financial account information.
- Worker defaults to localhost.
- Worker requests require an unguessable pairing key and allowed Origin.
- Browser Google tokens are memory-only. Opt-in Windows daily collection separately uses DPAPI-protected offline Gmail credentials. Its index is protected by a private folder ACL. Bounded email text is sent to Codex for classification and may remain in Codex session history.
- Drive uses `drive.file`, not unrestricted Drive access.
- Financial imports are local CSV files, not live bank credentials.
- Sensitive or irreversible external actions require explicit confirmation and a dedicated integration; the current worker is analysis/research only.
- Do not make a deterministic heuristic appear to be an AI decision, and do not make an AI suggestion appear to be a completed external action.

## CI and deployment

Pull requests:

1. install Node workspaces,
2. typecheck React + worker,
3. build React + worker,
4. run retained .NET domain regression harness.

Main performs the same build, prepares `apps/web/dist`, and deploys it through GitHub Pages.

## Evolution

The preferred direction is to add capability behind stable interfaces rather than spin up separate applications. New modules should first ask whether they can fit into Today, Inbox, Plan, Money, More, or the local worker.

Potential future infrastructure (authenticated household sync, push scheduling, server-side integrations) should be introduced only when its benefit justifies the privacy/operations cost and should not make the local-first core dependent on a paid service.
