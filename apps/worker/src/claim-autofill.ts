import type { Field } from "./claim-browser.js";
import type { ClaimPreparation } from "./claim-preparation.js";

/** Only source-backed current options. Model proposals and uncertain money stay manual. */
export function automaticClaimValues(fields: Field[], dossier: ClaimPreparation) {
  return Object.fromEntries(fields.filter(f => f.kind && f.type !== "file" && f.suggested != null
    && f.suggested !== "" && f.suggestionSource !== "codex" && (f.kind !== "natureOfIllness" || f.suggestionSource === "confirmed-answer")
    && !(dossier.reviewableWarnings.length && ["originalAmount", "otherInsurancePaid"].includes(f.kind))
    && (!f.options.length || f.options.filter(o => o.value === f.suggested).length === 1))
    .map(f => [f.key, f.suggested!]));
}
