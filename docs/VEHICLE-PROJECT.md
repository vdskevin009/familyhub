# Vehicle shortlist (FH-VEHICLE-001)

Historical preparation notes below. Source PR #298 is merged; issue #299 records controlled activation/intake and browser acceptance. Existing research-automation handoff, future natural runs and physical-phone acceptance remain distinct open gates. The committee of 19 November did not inspect the installed worker or private observations. Its evidence-presentation draft is documented in COMMITTEE-2026-11-19.md.

Projets > Voiture follows the same compact sourced-card pattern as Nouveau bien. Scope: used family SUV in Greater Vancouver, target CAD 23,000–30,000 before tax. Lower-than-target prices are not rejected. AWD is preferred, not mandatory. No universal mileage/year cutoff is invented. CR-V, Forester, Rogue, Tucson, CX-5, RAV4 and Sorento are examples, not an exclusive whitelist.

GET /vehicle-project returns immutable observations, current cards and independent owner follow history. Paired POST observations preserves stable listing identity; the same observation ID/content is a duplicate, changed content conflicts. Each changed listing gets a new observation ID. A missing listing or failed page is unknown, never sold. Cross-site identities require verified VIN or explicit adjudication; never merge by similar title/photo alone.

Each known fact requires HTTPS source URL and checked timestamp. Unknown is null, never zero. Price means asking price before taxes; monthly finance payments cannot be imported as price. Year and mileage are independent evidence. Seller accident claims are evidence text, not verified accident-free conclusions; no invented CARFAX or inspection. Opportunity remains unscored without comparable vehicles and condition evidence. Source photo optional and attributed, display only when permission is established.

Owner following is revision-protected and separate from collector data. Refresh cannot alter follow choices. Comparison distinguishes asking price, budget headroom and observed price reduction, not realized savings. Tax, mandatory dealer fees, insurance, financing and maintenance remain unknown unless separately established. No purchase, contact, test drive or external account actions.

Collector handoff: prepare a private JSON array, run scripts/vehicle-ingest.mjs --file <file> for preview. Apply only with the existing private endpoint and key file. The helper requires vehicle-project-v1 health, baseline conflict validation and independent readback; uncertain response is never blindly repeated. Parent owns updating an existing schedule, no parallel schedule is installed.

Acceptance: typechecks, model/store/HTTP/CLI tests, browser mobile/desktop interrupted/repeated flows, aggregate CI and production readback are separate gates. Synthetic data only in source repository.
