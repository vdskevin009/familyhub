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

- **Claims** — default healthcare expense-to-insurer reconciliation, with a dedicated mobile-first **À réconcilier** triage view for genuinely unmatched insurer records.
- **Invoices** — indexed expense document sources, without depending on reimbursement status.
- **DJ / BC** — separate Desjardins and Blue Cross insurer source-record libraries.
- **Other** — Today/Assistant, Important Mail, Plan, Money and settings/tools remain available.

The app is deployable under `/familyhub/` and must remain installable as a PWA.

### 2. Google browser bridge — `apps/web/src/google.ts`

Google Identity Services obtains short-lived browser access tokens. Tokens live only in memory.

Scopes:

- `gmail.readonly` — read candidate messages.
- `drive.file` — create/manage only Drive files FamilyHub creates.

When a PC worker is paired, the scheduled worker index is the authoritative Inbox source. The browser bridge's scan is retained only as an unpaired compatibility fallback. Worker processing is two-stage:

1. a bounded Gmail query reduces the candidate set while including explicit security/action signals;
2. deterministic local scoring and Codex classification reject promotion/newsletter/bulk mail, separate important mail from reimbursements, and require stronger evidence for receipts, bills, claims and administrative documents.

Supported PDF and text attachment contents are fetched and read transiently on the PC before classification. The index stores extraction status and character counts, not extracted body text. Images and scanned/image-only PDFs are not OCRed.

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

The invoice snapshot includes reconciliation cases, match-specific confidence/evidence, persisted manual match decisions, and genuinely unmatched insurer records. A singular evidence-supported association stays matched even when it needs user verification; lower-confidence matches can be confirmed or rejected explicitly. Manual confirmations remain authoritative across recomputation, rejected pairs are not immediately recreated, and unresolved ties/conflicts remain unmatched rather than guessed.

Default network binding is `127.0.0.1:4713`. A random pairing key is generated locally and required on every API request. CORS is restricted to configured FamilyHub origins.

The worker uses the locally configured Codex SDK environment. Tasks are intentionally narrow:

- general household analysis,
- meal-plan suggestions,
- financial review of supplied summaries,
- document classification assistance,
- opportunity research.

The worker prompt explicitly forbids pretending that purchases, messages, seller contact, sign-ins or other external actions occurred. Research watches may re-run automatically only while the worker is running.

For phone access, the worker needs a **private HTTPS route** from the phone to the computer. Do not expose the localhost service directly to the public internet. The pairing key is defense in depth, not a complete network perimeter.

### Manual Blue Cross collector

The local worker's Playwright collector uses a private persistent Chromium profile for user-managed Pacific Blue Cross login. It reads Claims History pages, validates each page through the existing `bluecross.ts` parser, writes an immutable minimal-fact snapshot, then previews or explicitly upserts into the existing `invoices.json` ledger. Existing reconciliation, unmatched projection and manual decisions remain authoritative. The authenticated worker exposes `POST /bluecross/sync` (`{ "apply": false | true }`) and `GET /bluecross/status`. Only summary counts and status reach the PWA; browser storage, credentials and private paths do not. No automatic collection task is registered.

### Manual Desjardins collector

The Desjardins Playwright collector uses a separate private Edge profile on Windows. The user completes login, MFA and dossier selection. Only Desjardins-domain cookies and portal-origin session storage are saved under user-scoped Windows DPAPI for attempted later headless previews; session reuse is subject to live validation and an expired session still needs manual login. It reads processed-claim list pages and each claim's service detail, verifies line payments against list totals, and saves an immutable minimal-fact snapshot in the worker DataDirectory. The optional repeat mode compares two full passes in the same browser session and blocks apply if they differ. The preview planner compares claim lines with existing Desjardins portal and historical Excel/report source records conservatively. A partial or ambiguous preview cannot be applied. Explicit apply runs only in the authenticated localhost worker against a complete private preview less than 24 hours old, backs up the ledger and preserves existing evidence and manual decisions. `GET /desjardins/status` and `POST /desjardins/sync` expose only counts and status to the paired PWA; snapshot paths and browser data stay private. No automatic collection task is registered.

Confirmed beneficiary aliases are stored separately in a DPAPI-protected private mapping keyed by the normalized full-name fingerprint. The parser consults that mapping only for the exact heading. A missing, invalid or conflicting mapping keeps the claim incomplete; it never guesses identity from a partial name. The mapping is loaded for each portal collection and is not exposed by the worker API.

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

### Optional insurer login (FH-REIMB-040)

The existing collectors first reuse their private browser sessions, then may make one credential login on an exact HTTPS origin using locally configured Windows CurrentUser DPAPI credentials. A shared filesystem profile lock serializes worker, CLI and configuration. Retry protection is persisted before submission; ambiguous outcomes and human challenges remain blocked until successful operator authentication or credential replacement. A 30-minute cooldown survives successful authentication. MFA/CAPTCHA are never automated. The paired API exposes only configuration presence and fixed recovery codes. Saved claims and lastSuccess survive failure; preview/apply and scheduling boundaries are unchanged. See [setup and acceptance](INSURER-LOGIN.md).
