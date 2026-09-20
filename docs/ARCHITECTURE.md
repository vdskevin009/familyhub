# Architecture

## Decision

Use standalone Blazor WebAssembly and .NET 11 for C# domain logic with zero-server hosting. This favors low operating cost and an easy portfolio deployment. Server-dependent features are deferred explicitly rather than embedding credentials in the client.

## Components

FamilyState owns entry validation and recurrence. BrowserStore is the persistence adapter. Add an IFamilyRepository abstraction when introducing an authenticated ASP.NET Core API. Use family-scoped authorization, optimistic concurrency and audit records for real sharing. Add a notification scheduler with explicit timezones and idempotent delivery; store notification subscriptions only server-side.

Browser UI → C# domain → browser storage. Downloaded backups and issue links are user-initiated data exits. Domain code has no network dependencies. Optional Gmail reimbursement ingestion is isolated in the Web project: JavaScript obtains short-lived Google OAuth tokens and calls Gmail read-only APIs, then passes normalized message metadata to deterministic Core classification rules.

## Privacy and persistence

Entries are private to the current browser profile, not encrypted or protected by application sign-in. No automatic cross-device sharing; use private backup transfer. Reminders are in-app only. The public site and repository contain no personal entries.

Local storage is best-effort, subject to quotas and browser deletion. Errors surface in the UI. App-specific storage keys and cache prefixes avoid accidental collisions, but all apps on one github.io origin can access the same origin storage. Sensitive data should normally move to an authenticated backend with server-side authorization. The optional reimbursement feature is an explicit local-only exception: it persists only an index of detected message metadata/statuses, never Gmail access tokens, full message bodies or attachment bytes. Users are warned not to use it on shared browser profiles.

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


## Gmail reimbursement bridge

The static Pages deployment cannot safely store a Google client secret or refresh token. FamilyHub therefore uses Google Identity Services' browser token flow with a public OAuth web client ID. Each household account is connected separately and receives its own short-lived `gmail.readonly` access token in JavaScript memory. Tokens are not serialized to browser storage.

The browser queries Gmail for likely reimbursement-related messages, fetches matching message payloads, normalizes text/headers/attachment metadata, and sends those transient candidates to Core. `ReimbursementDetector` deterministically classifies likely health-benefit, travel or other receipt documents and extracts a possible amount. Only the resulting local index is persisted. Re-scans upsert by Gmail account + message ID and preserve the user's claim status.

This design supports the current zero-server constraint but does not provide background scanning, refresh-token persistence, encrypted local storage, cross-device synchronization or unattended automation. Those require an authenticated backend.
