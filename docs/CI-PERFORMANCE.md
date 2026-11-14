# CI performance and release gates

The workflow creates one plugin-only PWA/worker artifact for browser acceptance and publication, then runs unit/integration checks, retained .NET domain regressions and four browser shards on isolated GitHub runners. Browser commands are expanded from the existing package scripts; no scenario, assertion or security gate is removed. Unsupported commands and invalid shard parameters fail closed. The standalone theme and Blue Cross history navigation checks remain included.

## Artifact and gate contract

- A committed npm lockfile and `npm ci` make all jobs install the same dependency graph. Only npm's package-download cache is reused; built output, private state and credentials are not cached.
- The build tar is uploaded with `upload-artifact@v4` under this run ID and attempt. Consumers download only within that run, check its commit identity and verify every built file's SHA-256 checksum.
- Pages publication uses the same PWA bytes that the browser shards tested. It does not rebuild after validation or consume an artifact from another PR/run. Pages compatibility files are added before tests.
- The existing `build` check remains a final aggregate gate. It requires compile, unit, every browser shard and domain tests to succeed. Failure, cancellation or skipping cannot produce a successful gate. Matrix fail-fast is disabled so other shards retain diagnostics after a failure.
- Deployment still requires main, a non-PR event, the successful `build` gate and the existing github-pages environment. Write/OIDC permissions remain confined to deployment. Retained unit scripts may rebuild the worker locally in their isolated job; browser tests and Pages publication use the compiled artifact. No branch protection, environment protection, credentials, runtime, private data, schedules or security settings are changed.
- PR and main both retain full validation. Similar source trees alone do not prove equivalent dependency resolution, merge contents, build identity or execution provenance. Cross-run promotion is deliberately not introduced.

## Measurement

The supplied baseline for PR #280 and its main run was about 19m25 each; browser steps occupied 16m19, including 8m37 for claims. Treat these as baseline observations, not a promised speedup. Compare successful complete runs, including runner queue time, build/install overhead and the slowest shard. Parallel jobs can reduce elapsed time while increasing runner minutes. Record exact run links and results before claiming a measured improvement. Private installed-runtime activation is separate from this GitHub workflow.

## Maintenance and verification

Run `node --test tests/ci-browser-shard.test.mjs`, normal typecheck/build and all workflow gates. Add browser scenarios to the existing package scripts; the partitioner picks them up automatically. If a suite needs a new command syntax, deliberately extend the validator and its tests. Evidence is uploaded separately per shard with the original synthetic evidence directories and seven-day retention.

## Candidate verification (2026-11-14)

Base: main `24a676f1d17bd327953e28b640e258f5609107ac`; candidate worktree branch `perf/parallel-ci`. [Baseline PR run 654](https://github.com/vdskevin009/familyhub/actions/runs/43626322324) passed before this change. Its logs show serial browser suites and a combined claims step lasting roughly 8m34; whole-run wall time includes setup/cleanup in addition to step durations.

Local Windows/Node 24 validation is not a substitute for the Linux/Node 22 workflow. Typecheck, plugin-only build and five CI contract tests passed. Savings and Courses had initial transient filesystem/history failures and passed on unchanged reruns. The Invoices Node suite passed 449/450: its existing Windows PowerShell setup fixture was blocked by the machine's script execution policy. The independent TypeScript portion passed 85/85. No policy was changed or bypassed. Retained .NET regression execution remains unverified locally because the SDK is unavailable. All 49 browser commands passed across the four partitions (13/12/12/12), run sequentially on the same Windows host. Their local durations were 363/265/457/388 seconds; these are not measurements of concurrent Linux CI and no CI speedup has been measured.

Independent review confirmed complete scenario/gate coverage and identified partial-rerun artifact naming. The fix exports compile's artifact name as a job output; successful compile outputs remain the source for consumers when failed jobs are rerun. Evidence artifacts include the current attempt so failed-run evidence is retained without collision. Static review also found no cross-script generated-state dependency among the 49 browser commands. Fresh-runner and live rerun validation remain pending. Workflow contract tests passed; actionlint was not executed.

Branch protection settings could not be read with the available connector; the browser settings page requires GitHub sign-in. No settings were changed. The owner authorized publication of this candidate branch and opening a draft PR. Full GitHub CI and measured before/after results remain required; merge/deployment require separate authorization.
