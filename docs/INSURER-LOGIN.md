# Secure insurer login

Worker 2.16.0 adds optional automatic password login for Pacific Blue Cross and Desjardins after their existing private session expires. Collection remains a preview. Apply remains explicit. No recurring task is created.

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

## Acceptance boundaries

Synthetic tests cover session reuse without reading secrets, one login, failure latching, timeout, origin/field validation, MFA/rejection, missing/unreadable credentials, cooldown, lock exclusion and financial/status preservation. Windows DPAPI is tested with synthetic Unicode secrets. The public anonymous login forms were inspected to ground selectors. No real credentials or authenticated health data are included in tests or Git.

Still required: local credential setup under the worker account; real login after expiration for both insurers; MFA recovery; installed-worker preservation; paired-phone behavior. Scheduling is a separate undecided product choice. No real claim submission or financial apply is part of authentication validation.

For Windows tests, FAMILYHUB_TEST_POWERSHELL may select the installed PowerShell runtime. Tests do not change execution policy. The default Windows PowerShell on some PCs disallows local scripts; use the existing approved PowerShell 7 runtime instead.

## Authenticated history in another tab

Worker 2.22.3 observes the tabs within each collector's existing private context during reconnect. An operator can complete ordinary navigation in another tab and leave claims history visible. The collector resumes only from its already verified current tab or one unique alternate tab with the exact insurer origin/history path and one visible grid. It does not inspect other browser profiles or transfer session data between contexts. Multiple alternate histories remain unresolved. Coarse `history-tab-diagnostic.json` contains only page counts, fixed page categories and selection state; it contains no URLs, tokens, credentials or claim contents. These observations do not clear an authentication stop. A successful authenticated history check retains the existing supported session-save and stop-clear behavior. Live two-source collection and scheduled repeat acceptance remain pending.
