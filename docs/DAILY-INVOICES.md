# Daily Gmail documents on Windows

Daily collection extends the existing Node/TypeScript worker instead of adding a second .NET service. It uses your local Codex SDK/login; no API key or paid hosting is introduced.

## Setup

1. Install Node 22+, run `npm install` and `npm run build`, and sign into Codex on this Windows account. `node scripts/smoke-codex.mjs` tests a synthetic receipt without reading Gmail.
2. In your Google Cloud project, enable Gmail API and create an OAuth **Desktop app** client. Download its JSON outside the repository. The browser/Web OAuth client does not provide unattended Desktop access. Configure your authorized test users/consent screen appropriately.
3. Run `./scripts/Connect-Gmail.ps1`. Enter the local path to the JSON, choose an account label, and open the displayed authorization URL **on this PC**. Approve read-only Gmail access. Repeat for the second account. Never put refresh tokens or client secrets in chat or GitHub.
4. Run `./scripts/Run-DailyCollection.ps1` for the first collection. This starts the updated worker on localhost if needed. If an older worker uses port 4713, stop that specific worker before restarting this version; never stop unrelated Node processes.
5. Run `./scripts/Install-DailyCollection.ps1 -At 08:00`. This creates/updates **FamilyHub Daily Invoices** once daily in the **PC local timezone**. It runs as the current Windows user without saving a Windows password. The user must be signed in and the PC awake. Missed runs start when available; concurrent runs are suppressed. Installation refuses to create an unconnected task.
6. Keep your existing private HTTPS route and pairing key in FamilyHub → More → Local AI. Inbox pulls the PC index when opened and every 30 seconds while visible. **Collect now**, **Refresh from PC**, all attachment downloads and correction buttons use the paired worker.

All three PowerShell scripts accept `-DataDirectory`. Use the existing worker's private-data directory to preserve its pairing key and phone connection. Run/Install also accept `-Port` and `-CodexPath`. No public tunnel is created. A temporary tunnel URL changing still requires updating the phone endpoint.

Inspect: `Get-ScheduledTaskInfo -TaskName 'FamilyHub Daily Invoices'`. Run now: `Start-ScheduledTask -TaskName 'FamilyHub Daily Invoices'`. Disable: `Disable-ScheduledTask -TaskName 'FamilyHub Daily Invoices'`.

## Behavior and limits

- Initial lookback is approximately 32 days. Subsequent scans overlap by two days and deduplicate by account plus Gmail message ID. A frozen window and page cursor resume backlogs; watermarks advance only after the final page. Each run handles at most 100 candidates/account plus ten classification retries. Large backlogs need more runs.
- The Gmail query targets document candidates, not every email. Promotional signals without transaction evidence are filtered before Codex. Prices/insurance words alone are insufficient. A genuine receipt is not rejected merely for having an unsubscribe footer.
- AI output uses a validated JSON schema. Confidence below 90%, uncertain transactions, missing deterministic transaction evidence, or unavailable AI goes to **À vérifier**. Low-confidence marketing also remains reviewable. Scores are estimates, not calibrated probabilities. Failed classifications are retried.
- Reimbursement is separately marked possible/unknown/no. No policy is verified, no claim is automatically ready/submitted, and no insurer portal is accessed. This implementation collects Gmail documents; it does not retrieve portal-only EOBs or submit coordinated claims.
- **Pub / Reçu / Facture / Ignorer** records a reversible correction scoped to account, exact sender and normalized subject template. A correction does not blacklist a merchant. Background retries preserve corrections/statuses. PC-managed statuses sync to other paired devices. Legacy browser scans remain supported and go to review.
- Classification reads up to 12,000 characters of email text and attachment filenames. It does not OCR PDFs/images. Attachments are fetched on demand through the authenticated worker, up to 20 MB, without phone Gmail sign-in. They are not permanently cached or automatically filed in Drive. Downloads require an online PC, network and valid Gmail authorization; synced metadata remains available offline.
- Last complete scan, account failures and unfinished backlogs appear in Inbox. Scan completion means indexing finished, not that every AI classification succeeded or insurance paid anything.

## Privacy

Browser access tokens remain memory-only. Separate opt-in refresh credentials are protected by Windows DPAPI for the user who authorized Gmail, under `gmail-credentials.dpapi`. The connection script restricts the data folder ACL to that user and SYSTEM. Tokens are never returned by HTTP or placed in backups.

`invoices.json` stores subjects, senders, dates, inferred amounts, attachment metadata and corrections. This is local JSON protected by directory permissions, not encrypted. Phone metadata and JSON backups are also unencrypted. Full bodies and attachment bytes are not stored in the FamilyHub index. Limited email text **is sent through Codex to OpenAI and may remain in Codex session history**; this is not offline AI processing.

The classifier runs read-only with shell, MCP, apps and web search disabled. It treats email contents as untrusted data. Gmail access is read-only. All invoice routes require pairing and allowed-Origin checks, return no-store responses, and do not log pairing keys. The network binding stays localhost.

Expired/revoked Google grants require reconnecting. OAuth projects in Testing can have short-lived refresh tokens. Existing data is retained when access expires. Account removal/credential editing is local administration; no remote credential-edit API is exposed.

## Verification

Run `npm run typecheck`, `npm run build`, `npm run test:invoices`, and `dotnet run --project tests/Core.Tests -c Release`.

Tests use synthetic data for filtering, schema validation, recovery/deduplication, correction/status preservation and endpoint authorization. They do not establish real Gmail consent, Windows task installation, or phone connectivity; verify those after setup.

References: [Google Desktop OAuth / PKCE](https://developers.google.com/identity/protocols/oauth2/native-app), [token expiration](https://developers.google.com/identity/protocols/oauth2#expiration), [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk).
