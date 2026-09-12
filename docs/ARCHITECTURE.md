# Architecture

## Decision

Use standalone Blazor WebAssembly and .NET 11 for C# domain logic with zero-server hosting. This favors low operating cost and an easy portfolio deployment. Server-dependent features are deferred explicitly rather than embedding credentials in the client.

## Components

FamilyState owns entry validation and recurrence. BrowserStore is the persistence adapter. Add an IFamilyRepository abstraction when introducing an authenticated ASP.NET Core API. Use family-scoped authorization, optimistic concurrency and audit records for real sharing. Add a notification scheduler with explicit timezones and idempotent delivery; store notification subscriptions only server-side.

Browser UI → C# domain → browser storage. Downloaded backups and issue links are user-initiated data exits. Domain code has no network dependencies.

## Privacy and persistence

Entries are private to the current browser profile, not encrypted or protected by application sign-in. No automatic cross-device sharing; use private backup transfer. Reminders are in-app only. The public site and repository contain no personal entries.

Local storage is best-effort, subject to quotas and browser deletion. Errors surface in the UI. App-specific storage keys and cache prefixes avoid accidental collisions, but all apps on one github.io origin can access the same origin storage. Future sensitive data requires an authenticated backend and server-side authorization.

## Testing

The executable harness tests domain boundaries and known scenarios. Release publish verifies Razor compilation, trimming and static assets. Browser smoke checks cover the primary workflow. Tests and publish run before the deploy job; pull requests cannot deploy.

## Deployment

GitHub Actions builds a versioned Pages artifact. A separate job uses pages:write and id-token:write only after build success. Main deploys through the github-pages environment. Pull requests get read-only permissions. Dependency versions are pinned; review updates to .NET RC versions before merging.

## Roadmap

1. Authenticated family sync
2. household membership and permissions
3. push reminders
4. conflict-safe offline sync
5. optional meal-planning AI.

No paid hosting or external AI calls without Kevin's approval.
