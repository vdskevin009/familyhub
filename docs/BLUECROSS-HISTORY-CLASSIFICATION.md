# Blue Cross history failure classification

Issue #159; FH-REIMB-032, FH-REIMB-040, FH-REIMB-045. Release candidate.

The synthetic regression reaches the member home, finds one visible history
control and completes its click, but never finds a ready history grid.
The code confirms the classification defect: `tryPortalLogin` returns
`layout-changed` after the reused-session wait when the current page is not the
login route. The collector previously converted every readiness failure into
`login-required`; the existing UI then described an unknown sign-in page.

The new observer only recognizes a reserved history click on the exact trusted
member, login-path member home or history route, after a fresh check for visible
password/challenge controls and challenge/rejection text. It replaces only the
generic `layout-changed` outcome with a fixed collection error. An unreadable,
closed, changing, foreign or account-update page abstains. Actual authentication
failures, uncertain credential attempts, cooldowns and locks retain their reasons.
It neither proves authentication nor clears any login control.

The error travels through the existing collection-error API and UI path. Its
fixed message is sanitized again at the sync boundary. It is non-transient, so
the existing retry policy stops after one attempt. No collection snapshot,
financial apply or automatic intake is reached. The existing last success and
applied timestamps, ledger and manual decisions survive.

Existing stored `login-required/layout-changed` statuses do not contain enough
evidence to reconstruct their original page. Their UI copy now describes an
unrecognized insurer page and unavailable history without asserting session
expiration or recommending reconnection. The compact coverage notice follows the
same distinction. Other authentication reasons retain their recovery instructions.

No navigation fallback was added: a completed click without a grid does not
establish whether the portal handler, session bridge, response or destination
failed. Guessing a direct URL or replaying that click would exceed the evidence.
The click/navigation implementation and exact history-grid verifier are retained.
Live diagnosis and collection acceptance remain separate work; this candidate
does not repair the underlying portal handler or establish successful collection.

Validation uses intercepted synthetic browser pages only, including the real
login preflight with credential reads, submissions and control writes prohibited.
Additional sync regressions cover preview, explicit apply and automatic intake,
single-attempt behavior, persisted error status, sanitization and byte-identical
ledger preservation. Existing navigation, authentication, parser, reconciliation
and duplicate protections remain in the targeted regression scope.

No real portal session, credential, private-data file, permission, trust fingerprint,
runtime, schedule or other working branch was modified. Installed-worker activation
and live collection remain separate acceptance gates. All committed regression
fixtures use synthetic data; no private diagnostic or browser state is included.

## Local validation and review

- Worker build and typecheck passed using TypeScript 5.9.3.
- Web typecheck and Vite production build passed.
- 129 targeted backend tests: 128 passed; the existing Windows credential-setup
  test could not execute its PowerShell script because scripts are disabled by
  the host policy. The policy was not bypassed or changed.
- 15 additional reconnect, scheduled-preview, Desjardins navigation and evidence
  workflow checks passed. The scheduled runner initially could not reach its
  temporary loopback fixture inside the sandbox; its complete six-test suite
  then passed outside that sandbox, without contacting the installed worker.
- 37 invoice-state and insurer-message tests passed.
- 44 intercepted Blue Cross browser scenarios passed, including ten new failure
  classification cases and the existing login/recovery/navigation protections.
- Built PWA acceptance passed at 390 and 1440 pixels, including both the old
  stored-layout status and new history-error copy, retained saved records and last
  complete read, no Apply button and no additional POST. Synthetic screenshots
  are under `output/playwright/bluecross-{legacy-layout,history-error}-*.png`.
- `git diff --check` passed. Code-path review checked the exception boundary,
  existing non-transient retry handling, sanitized status, preservation of login
  stops and the unchanged financial planner. No independent agent review is claimed.
- The retained .NET regression command could not run: `dotnet` is unavailable in
  this environment. Full CI and .NET validation remain release gates.

Dependencies were copied from the supplied checkout's existing package store into
this isolated checkout; no source checkout dependency, runtime or system permission
was modified. Commands used the local Node/TypeScript/Vite executables because
`npm` was not on PATH. No dependency or lockfile update is part of this change.
