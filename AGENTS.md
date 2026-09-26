# FamilyHub

Read `REQUIREMENTS.md` first. It is the canonical product-requirements source. Then read `README.md` and `docs/ARCHITECTURE.md` before changing the product.

For every accepted product change:
- reconcile the request with the current code before implementation;
- add or update the affected requirement in `REQUIREMENTS.md`;
- keep status truthful (`Implemented`, `Planned`, `Needs verification`, or `Superseded`);
- after implementation, update the requirement and validation notes in the same PR;
- never use chat history as the only durable record of product behavior.

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
