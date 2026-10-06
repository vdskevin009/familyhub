# Secure insurer login

Worker 2.16.0 adds optional automatic password login for Pacific Blue Cross and Desjardins after their existing private session expires. That original release kept collection in preview mode and created no recurring task. FH-REIMB-043 now permits an explicit local opt-in for automatically saving validated new payments; existing changes and ambiguous records remain reviewable. Authentication changes never enable a schedule.

## Configure locally

Use an installed PowerShell that permits local scripts (PowerShell 7 on this PC) on the worker PC as the **same Windows user** that runs the existing worker. From its checkout:

```powershell
.\scripts\Set-InsurerLogin.ps1 -Insurer desjardins -DataDirectory 'YOUR_EXISTING_PRIVATE_DATA_DIRECTORY'
.\scripts\Set-InsurerLogin.ps1 -Insurer bluecross -DataDirectory 'YOUR_EXISTING_PRIVATE_DATA_DIRECTORY'
```

Use the actual existing DataDirectory containing pairing-key.txt; do not make a new worker or data directory. All account identifiers and passwords are entered through masked local prompts, never command arguments, environment variables, chat, screenshots or the PWA. Desjardins requires Identifiant and password; Blue Cross requires Policy, ID Number, password and an explicit member/spouse choice. Running Set again replaces the saved credential and resets the retry latch. Cancel before completion to leave the previous credential unchanged.

The file login.dpapi uses CurrentUser Windows DPAPI, and its ACL grants the current user access. Decryption only occurs inside the existing collector. This protects data at rest; it cannot protect against compromise of the same Windows account. The HTTP API never accepts or returns credentials. A boolean configured indicator means a file exists; an inability to decrypt appears when collection tries to use it.

Use the same command with -Action Status to inspect presence without decrypting, or -Action Delete to remove the saved password. Deletion does not clear the existing browser session or claims.

## Normal use and recovery

1. Choose Update in Sources. The collector tries the existing private session first.
2. If needed, it makes one ordinary login with the saved credential. It reads the same claim history after confirming the authenticated page.
3. Review the preview and use Apply when ready. Imported statements appear in DJ/BC and update matching claims; they do not create invoice source documents.
4. For MFA, CAPTCHA or another human step, choose Reconnect on PC. Complete the portal flow yourself; the visible collector waits up to ten minutes and resumes the preview. If the portal does not preserve the pending challenge, complete sign-in again in that window. FamilyHub does not capture or submit verification codes.

A rejected password or unknown submission outcome disables further automatic attempts across restarts. Replace the credential, or sign in successfully through Reconnect. Successful authentication clears this latch but leaves a 30-minute cooldown since the last automatic attempt. Manual Reconnect remains available during cooldown. Missing/corrupt credentials, an unrecognized page and a busy profile have distinct recovery messages. Last saved claims, snapshots and lastSuccess remain available on failure.

The collector, CLI and setup command hold the same per-insurer lock. If a process crashes, automatic retries do not steal its lock. After closing any leftover insurer browser, use -Action RecoverLock; recovery refuses a live owner/browser and preserves the retry latch. If the owner record is invalid, inspect locally instead of deleting a guessed profile path.

## Desjardins account-profile selection

Worker 2.22.1 follows the observed trusted post-password account-profile form through its visible controls. A single profile may continue when there is no explicit preference. With a locally saved operator-approved DPAPI preference, only that exact profile may continue, even if another profile is the only option. Multiple unmatched profiles report an account choice instead of a verification challenge; an unavailable or unreadable preference cannot select a different account. The HTTP API accepts and returns no account identifier or credential.

An interrupted, unconsumed profile selection may be held under Windows CurrentUser DPAPI for at most 30 minutes. The portal may expire its transaction sooner; successful continuation is not guaranteed. Each selection transaction is recorded before submission and is never replayed after an uncertain outcome, including across worker restarts. A consumed pending transaction is skipped on the next ordinary session check. No hidden authentication API or MFA code is used.

Unknown failed submissions or history timeouts report login-incomplete and preserve the retry stop; human-required is reserved for an observed challenge. Secret-free local diagnostics retain only login phase, coarse trusted host/page category, control visibility and allowlisted error kind. They contain no raw URL, token, field value, browser error text or health data.

## Acceptance boundaries

Synthetic tests cover session reuse without reading secrets, one login, failure latching, timeout, origin/field validation, MFA/rejection, missing/unreadable credentials, cooldown, lock exclusion and financial/status preservation. Windows DPAPI is tested with synthetic Unicode secrets. The public anonymous login forms were inspected to ground selectors. No real credentials or authenticated health data are included in tests or Git.

The installed Desjardins worker has completed a fresh ordinary password login through the operator-selected profile after an expired session, without an observed verification challenge, and read complete history without changing the ledger. Credential/pairing files, existing records, manual decisions, tunnel and task definitions were preserved. Source CI passed including retained .NET checks. Repeated ordinary collections reused the same protected session without another password submission; eligible positive-payment intake succeeded and a repeated run kept the ledger byte-identical. The installed runner now waits with an explicit fifteen-minute total HTTP deadline, including response headers, and completed a real collection lasting more than five minutes without replay. Nonpositive rows remain reviewable under the approved policy. Actual MFA recovery, paired-phone behavior and the first natural schedule trigger with this correction remain separate gates. The owner-approved existing insurer schedule and automatic-new-payment policy are tracked under FH-REIMB-041/043; no schedule is enabled by this authentication correction. No real claim submission or financial apply is part of authentication previews.

For Windows tests, FAMILYHUB_TEST_POWERSHELL may select the installed PowerShell runtime. Tests do not change execution policy. The default Windows PowerShell on some PCs disallows local scripts; use the existing approved PowerShell 7 runtime instead.
