# Finances and Trends release verification

Verified 2026-11-16 UTC. This final record supersedes the publication-pending notes
in the earlier finance work-in-progress documents. No private account data or
financial amounts are included here. Récurrents was local and unpublished at that
checkpoint; its subsequent PR #295 release is recorded in RECURRING-ACCEPTANCE.md.

| Lot | PR | Exact tested PR head | Main release | PR CI | Main CI and Pages |
| --- | --- | --- | --- | --- | --- |
| Finances | #293 | e7c6a46e3eb24e615a2fe4386c8c98a7b507dfad | c92d5d0d73ec3c508e601a18522fad5a7cbc174b | 43781125437 | 43782857654 |
| Trends A+B | #294 | 8d00e0ba524d7e062629a5d303f18a52333e86a5 | 844f991670088a47159fe3a8c495315cdb4d19fe | 43783003987 | 43783834073 |

All required compile, unit, retained .NET domain, four browser shards, build and
main deployment jobs succeeded. No checks were bypassed. There is no separate lint
script in this repository. The final Pages release metadata and 31 public JS, CSS
and metadata files matched the exact CI artifact by SHA-256.

Finances acceptance passed against published c92d5d0 at 320/390/768/1440. Trends A+B
and Contributions acceptance passed against published 844f991 at all four widths.
Primary Finances/default Comptes navigation and Back/Forward passed at all widths.
Keyboard, Escape, focus restoration, repeated month/category selection, missing
reference, refunds, known zero and account/currency scope were checked. Original
approved image pixels were inspected and synthetic screenshots reviewed. Tests
intercept financial requests with fictional fixtures; no household screenshots
were published and no physical-phone verification is claimed.

The installed worker is healthy locally and through its existing HTTPS entry at
2.30.2, including finance-register-bindings-v1. Entry and new register-bindings
helper match both main CI artifacts exactly. Only those two compiled files and
the matching supervisor entry hash were updated; the installed checkout's Git
HEAD was not changed and is not proof of this runtime deployment. Existing request
security code and pin, task definitions, secrets and permissions were preserved.
Unauthenticated access returns 401 and an untrusted Origin returns 403.

Protected finance/archive/controller files were compared before/after (26 unchanged).
No import or scheduler recovery was triggered; a pre-existing expired pending
daily gate was left untouched. Worker deployment does not establish fresh collection.
Actual read-only coverage confirms some exact import identities but also unresolved
account/transaction identities. Those remain explicit and outside authoritative
totals; no heuristic matching, false zero or complete-coverage claim is made.

Récurrents acceptance and remaining localization/physical-device limitations are
recorded separately in RECURRING-ACCEPTANCE.md. Projets navigation is not implemented.
