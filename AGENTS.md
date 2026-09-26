# FamilyHub

## Requirements source of truth

Read `REQUIREMENTS.md` before planning or changing the product. Treat it as the canonical source for product intent and requirement status.

For every user-requested product change:
- identify the affected requirement IDs, or add a new stable ID before/with implementation;
- do not mark a request implemented merely because it was discussed;
- update the requirement status and implementation notes together with the code change;
- if a newer explicit decision conflicts with an older requirement, keep the old item and mark it `Superseded`;
- record unresolved ambiguity under **Open questions / Needs confirmation** instead of inventing behavior;
- after merge/verification, update the requirement code reference so the document stays aligned with the repository.

Read README.md and docs/ARCHITECTURE.md before changing the product.

The deployed UI is React + TypeScript + Vite in `apps/web`. The optional local Codex worker is in `apps/worker`. The older .NET/Blazor projects under `src` are retained during migration and their executable regression tests still run in CI.

Product rule: a feature should save time, prevent an important miss, or reduce avoidable spending. Prefer a proactive app-like Today experience over adding dashboard clutter.

Run:
- `npm install`
- `npm run typecheck`
- `npm run build`
- `dotnet run --project tests/Core.Tests -c Release`

Work on a feature branch and use a PR with behavior, validation, limitations and privacy/security implications.

Never commit secrets, Google tokens, pairing keys, real family information, bank exports or financial account data. No paid service without Kevin's explicit approval.

Keep the static PWA deployable to GitHub Pages under `/familyhub/`. Preserve existing local-storage schema compatibility unless a documented migration is included.

External actions must be truthful. Never represent a simulated operation, heuristic, AI suggestion or planned action as a completed live integration. Keep irreversible/sensitive actions behind explicit confirmation.

The local worker must bind to localhost by default and must not be made publicly reachable by a code change. Phone access should use a private network/HTTPS path supplied by the operator.
