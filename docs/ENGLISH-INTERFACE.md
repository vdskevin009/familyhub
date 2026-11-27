# Canadian English in FamilyHub

The first-party React PWA uses Canadian English independently of the browser locale. The registered plan names are **RRSP** and **RESP**. The language setting does not change the user's Dot conversations.

## Data boundary

* Render English navigation, workflows, controls, accessible names, help, error and empty states, and notification copy.
* Preserve Canadian dollars, amounts, source dates and their precision. Preserve original account labels, provider and retailer names, user notes, document titles, portal text, and quoted source evidence. These strings can legitimately be in another language.
* Leaving archived free-form records intact is intentional. Recognizable, old FamilyHub-generated messages may be presented in English without migrating stored text. Language corrections must not change event identity or notification eligibility. The project/reminder delivery diagnostics and monthly grocery exclusions use English without changing #321 or #317 behaviour. Today still distinguishes partial claim coverage and an unknown total from a verified zero, and gives the assistant only its existing bounded summary (#313).
* Lock-screen notices remain generic. Test the full notification in the app without exposing its contents on the lock screen.
* This change does not repair missing transactions, recalculate contribution targets, redesign contributions, change permissions or contact a provider.

## Local acceptance

Use the built PWA. Run `npm run build` and `npm run typecheck`, then `node apps/web/tests/english-entry-browser.mjs` with a Playwright Chromium installation. The test uses disposable browser storage and blocks the network outside its own fixture server. It opens every view (including the invoices alias) under English and French browser locales at phone widths, checks the page heading and known obsolete UI phrases, verifies the primary navigation by accessible name, and exercises a real tap-through and an unreachable-worker state. Screens at 320, 390 and 1280 pixels are saved locally under `artifacts/english`.

The entry smoke test does not prove that every dynamic string is English. Keep the domain suites: paired fixture data, history, notification consent, dialogs, finance source/error cases, and narrow screens exercise different paths. Test data must be fictional. Native push delivery requires a separate device check; a synthetic browser test is not proof of delivery.

The retired grocery planning/catalogue/weekly editor modules are not exported by the current grocery route, which opens Purchases even for old tab links. Do not re-enable those dormant editors until their remaining standalone labels are audited. System browser chrome and third-party screens are outside this first-party language contract.

Deploying the web bundle does not update an installed PC worker or rewrite older notices. Exact known historic messages are rendered in English where recognized; arbitrary historic free-form messages or optional external portal text may still appear in their original language.
