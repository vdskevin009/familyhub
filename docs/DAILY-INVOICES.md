# Daily Gmail documents on Windows

Daily collection extends the existing Node/TypeScript worker instead of adding a second .NET service. It uses your local Codex SDK/login; no API key or paid hosting is introduced.

## Setup

1. Install Node 22+, run `npm install` and `npm run build`, and sign into Codex on this Windows account. `node scripts/smoke-codex.mjs` tests a synthetic receipt without reading Gmail.
2. In your Google Cloud project, enable Gmail API and create an OAuth **Desktop app** client. Download its JSON outside the repository. The browser/Web OAuth client does not provide unattended Desktop access. Configure your authorized test users/consent screen appropriately.
3. Run `./scripts/Connect-Gmail.ps1`. Enter the local path to the JSON, choose an account label, and open the displayed authorization URL **on this PC**. Approve read-only Gmail access. Repeat for the second account. Never put refresh tokens or client secrets in chat or GitHub.
4. Run `./scripts/Run-DailyCollection.ps1` for the first collection. This starts the updated worker on localhost if needed. If an older worker uses port 4713, stop that specific worker before restarting this version; never stop unrelated Node processes.
5. Run `./scripts/Install-DailyCollection.ps1 -At 08:00`. This creates/updates **FamilyHub Daily Invoices** once daily in the **PC local timezone**. It runs as the current Windows user without saving a Windows password. The user must be signed in and the PC awake. Missed runs start when available; concurrent runs are suppressed. Installation refuses to create an unconnected task.
6. Keep your existing private HTTPS route and pairing key in FamilyHub → More → Local AI. Inbox pulls the PC index when opened and every 30 seconds while visible. **Refresh results**, all attachment downloads and correction buttons use the paired worker. Collection itself is owned by the Windows task rather than a second phone/browser scan path.

All three PowerShell scripts accept `-DataDirectory`. Use the existing worker's private-data directory to preserve its pairing key and phone connection. Run/Install also accept `-Port` and `-CodexPath`. No public tunnel is created. A temporary tunnel URL changing still requires updating the phone endpoint.

Inspect: `Get-ScheduledTaskInfo -TaskName 'FamilyHub Daily Invoices'`. Run now: `Start-ScheduledTask -TaskName 'FamilyHub Daily Invoices'`. Disable: `Disable-ScheduledTask -TaskName 'FamilyHub Daily Invoices'`.

## Behavior and limits

- Initial lookback is approximately 32 days. Subsequent scans overlap by two days and deduplicate by account plus Gmail message ID. A frozen window and page cursor resume backlogs; watermarks advance only after the final page. Each run handles at most 100 candidates/account plus ten classification retries. Large backlogs need more runs.
- The Gmail query targets document candidates, not every email. Promotional signals without transaction evidence are filtered before Codex. Prices/insurance words alone are insufficient. A genuine receipt is not rejected merely for having an unsubscribe footer.
- AI output uses a validated JSON schema. Confidence below 90%, uncertain transactions, missing deterministic transaction evidence, or unavailable AI goes to **À vérifier**. Low-confidence marketing also remains reviewable. Scores are estimates, not calibrated probabilities. Failed classifications are retried.
- Reimbursement is separately marked possible/unknown/no. No policy is verified, no claim is automatically ready/submitted, and no insurer portal is accessed. This implementation collects Gmail documents; it does not retrieve portal-only EOBs or submit coordinated claims.
- Health documents now carry separate billed and reimbursed amounts, member, insurer, service date and document role when the evidence supports them. FamilyHub reconciles nearby provider invoices and insurer statements, using **Desjardins → Blue Cross for Kevin** and **Blue Cross → Desjardins for Jasmine**. The remaining amount is always labelled potential/not guaranteed.
- **À votre attention** appears in Today and Inbox. Important/action/security mail is shown separately from reimbursements. Reimbursement cases ask for the missing amount, the primary submission, the secondary submission, or a final balance check instead of treating every detected document as a separate claim.
- **Pub / Reçu / Facture / Ignorer** records a reversible correction scoped to account, exact sender and normalized subject template. A correction does not blacklist a merchant. Background retries preserve corrections/statuses. PC-managed statuses sync to other paired devices. Legacy browser scans remain supported and go to review.
- Learning is progressive: one matching correction is a proposal, while three consistent corrections can automatically filter that exact sender-and-subject template. Decisions are logged and the latest UI decision can be undone. Cleanup suggestions may recommend unsubscribing, but Gmail remains read-only and FamilyHub never unsubscribes or archives email automatically.
- Classification reads bounded email text plus up to 12,000 characters extracted transiently from supported PDF and text attachments (10 MB analysis limit per attachment). A deterministic fallback recognizes explicit totals in either source when AI leaves the amount blank. Extraction status is stored, but extracted attachment text is not written to `invoices.json`. It does not OCR images or image-only PDFs, so those remain **à vérifier**. Attachments can still be downloaded on demand through the authenticated worker, up to 20 MB, without phone Gmail sign-in. They are not permanently cached or automatically filed in Drive. Downloads require an online PC, network and valid Gmail authorization; synced metadata remains available offline.
- Last complete scan, account failures and unfinished backlogs appear in Inbox. Scan completion means indexing finished, not that every AI classification succeeded or insurance paid anything.

## Privacy

Browser access tokens remain memory-only. Separate opt-in refresh credentials are protected by Windows DPAPI for the user who authorized Gmail, under `gmail-credentials.dpapi`. The connection script restricts the data folder ACL to that user and SYSTEM. Tokens are never returned by HTTP or placed in backups.

`invoices.json` stores subjects, senders, dates, inferred amounts, attachment metadata and corrections. This is local JSON protected by directory permissions, not encrypted. Phone metadata and JSON backups are also unencrypted. Full bodies and attachment bytes are not stored in the FamilyHub index. Limited email text **is sent through Codex to OpenAI and may remain in Codex session history**; this is not offline AI processing.

The classifier runs read-only with shell, MCP, apps and web search disabled. It treats email contents as untrusted data. Gmail access is read-only. All invoice routes require pairing and allowed-Origin checks, return no-store responses, and do not log pairing keys. The network binding stays localhost.

Expired/revoked Google grants require reconnecting. OAuth projects in Testing can have short-lived refresh tokens. Existing data is retained when access expires. Account removal/credential editing is local administration; no remote credential-edit API is exposed.

## Verification

Run `npm run typecheck`, `npm run build`, `npm run test:invoices`, and `dotnet run --project tests/Core.Tests -c Release`.

Tests use synthetic data for filtering, schema validation, two-insurer reconciliation, recovery/deduplication, correction/status preservation and endpoint authorization. They do not establish real Gmail consent, Windows task installation, phone connectivity, insurer coverage or an actual unsubscribe; verify the applicable paths after setup.

References: [Google Desktop OAuth / PKCE](https://developers.google.com/identity/protocols/oauth2/native-app), [token expiration](https://developers.google.com/identity/protocols/oauth2#expiration), [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk).
# Copied Blue Cross portal claims

Worker 2.4 parses emailed Blue Cross portal claim tables before the generic 12,000-character classification limit. It reads inert table text, validates dates and monetary rows against the page subtotal, and retains individual service/claimed/paid/statement-date fields without storing scripts or hidden portal fields. Copied identical pages are idempotent; multiple processing events for the same service remain reviewable. Portal grand totals are never individual payments. A partial-page warning appears in Reimbursements when the page and portal totals differ.

For an email missed by an older collector, authenticated `POST /invoices/import-bluecross` accepts `{ email, messageIds, apply: false }` to preview existing Gmail messages, or `apply: true` to commit them with a timestamped private-state backup. It does not send email or submit claims. The normal daily collection uses the same parser.

Matching requires exact known member/date plus service or explicit amount/provider evidence. Structured portal rows additionally require a recognized matching service and supported claimed amount. A Desjardins report-derived submitted balance can be reconciled with the original Blue Cross amount only when it equals the exact remaining amount after that Blue Cross payment. Distinct equal-amount procedures stay separate; uncertain reprocessing, duplicated expenses, and professional-type conflicts remain unmatched. Nathan's primary/secondary order is not assumed; payments with unconfirmed order remain flagged and excluded from primary/secondary summary totals.
