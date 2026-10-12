# FH-UX-002 — Neutral in-app visual theme

Work item: #201. Scope approved 2026-10-12. Implementation and exact release evidence are tracked in the implementation PR and Issue #201; installed-device acceptance is separate.

Use neutral canvas #F5F6F8, white surfaces #FFFFFF, anthracite text #202124, secondary text #62676F, decorative dividers #DEE1E6 and one blue action/focus accent #2463D3. Hover and selected tints derive from that accent. Form boundaries need sufficient non-text contrast. Keep system-native typography, compact 20px page titles and 16px section titles, aligned tabular amounts, 16px mobile gutters, and generous existing touch targets (shared primary controls 48px). Never shrink interactive targets merely to fit a row.

Success, warning and error retain distinct semantic colors with text. Category/series colors with business meaning and user-selected colors remain intact. Ordinary numeric totals use text color, not action blue. Green minimum-price labels remain a labelled semantic state, distinct from actions.

This explicitly supersedes the earlier deep-green **in-app theme** described in FH-UX-001 product-design notes and any reading of FH-PWA-002 that requires forest/cream across application surfaces. FH-PWA-002 launcher SVG/PNG/maskable artwork and identity remain unchanged. Existing light-only `color-scheme` remains explicit under either system preference; no untested dark palette is introduced.

Frontend CSS/tokens and matching neutral browser/splash chrome, plus synthetic tests and scoped documentation. Refresh the shell cache version so existing installations receive the changed presentation; preserve icons, notification handling and cache policy. Preserve Claims-first navigation, dialogs, focus return, loading/empty/error states, financial and grocery calculations, named sources, manual decisions, local storage, API and worker behavior. Do not access or mutate private household data.

Acceptance: full repository CI and relevant browser suites; new theme/navigation checks at 320/390/768/1440, both system color preferences, palette/contrast/focus, repeated dialog and navigation flows; visual inspection of synthetic Claims/source/Finance/Savings/Courses/Notifications screenshots; exact main/Pages release and public smoke. Record passed, blocked and unverified stages separately.
