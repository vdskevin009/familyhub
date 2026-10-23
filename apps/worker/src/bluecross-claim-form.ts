import type { ClaimPreparation } from "./claim-preparation.js";
import { memberName, calendarDate } from "./healthcare-evidence.js";

export const blueCrossComboFields = [
  { suffix: "cmbCoveredLife_Input", kind: "patient", label: "Claimant" },
  { suffix: "cmbBenefit_Input", kind: "benefit", label: "Benefit" },
  { suffix: "cmbExpenseType_Input", kind: "service", label: "Type of expense" },
  { suffix: "cmbOtherInsurancePlan_Input", kind: "otherInsurance", label: "Has this expense been submitted to another insurance plan?" }
] as const;

export function blueCrossTextField(id: string) {
  if (id.endsWith("calServiceDate_calcalServiceDate_dateInput")) return { kind: "serviceDate", label: "Date of purchase/service (MM/DD/YYYY)" };
  if (id.endsWith("_txtAmount")) return { kind: "originalAmount", label: "Total amount of expense" };
  if (id.endsWith("_txtOtherPlanAmt")) return { kind: "otherInsurancePaid", label: "Amount paid by another insurance plan" };
  if (id.endsWith("_txtIllness")) return { kind: "natureOfIllness", label: "Nature of illness/injury" };
  return null;
}
const normalize = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
/** Classify the receipt's known healthcare service independently of portal options. */
export function supportedHealthcareService(service: string | null) {
  return /^(?:20 min chiropractic return(?: \(20 minutes\))?|physiotherapy - 30 min follow up visit(?: \(30 minutes\))?|rmt - follow up massage \(60 min\)(?: \(60 minutes\))?)$/.test(normalize(service || ""));
}
export function blueCrossSuggestion(kind: string, dossier: ClaimPreparation, options: { value: string; label: string }[] = []) {
  const unique = (match: (s: string) => boolean) => {
    const found = options.filter(o => o.value && match(o.label));
    return found.length === 1 ? found[0].value : null;
  };
  const service = normalize(dossier.fields.service || "");
  if (kind === "patient") return unique(label => memberName(label.split(/\s+-\s+/)[0]) === dossier.fields.patient);
  if (kind === "benefit") return /chiropr/.test(service) ? unique(label => normalize(label) === "chiropractor")
    : /^physiotherapy\b/.test(service) ? unique(label => normalize(label) === "physiotherapist")
    : /^rmt - follow up massage \(60 min\)(?: \(60 minutes\))?$/.test(service) ? unique(label => normalize(label) === "massage") : null;
  // This exact original service was confirmed in the portal walkthrough. Other
  // visit modes, initial visits and clinical professions remain unmapped.
  if (kind === "service") {
    if (/^20 min chiropractic return(?: \(20 minutes\))?$/.test(service)) return unique(label => normalize(label) === "chiropractic - in person - subsequent treatment");
    if (/^physiotherapy - 30 min follow up visit(?: \(30 minutes\))?$/.test(service)) return unique(label => normalize(label) === "physiotherapy treatment - 30 minutes");
    if (/^rmt - follow up massage \(60 min\)(?: \(60 minutes\))?$/.test(service)) return unique(label => normalize(label) === "registered massage 60 minutes and up - subsequent visit");
    return null;
  }
  if (kind === "otherInsurance") return dossier.fields.otherInsurance === "Yes" ? unique(label => normalize(label) === "yes") : null;
  if (kind === "serviceDate") {
    const date = calendarDate(dossier.fields.serviceDate?.slice(0, 10));
    return date ? `${date.slice(5, 7)}/${date.slice(8, 10)}/${date.slice(0, 4)}` : null;
  }
  if (kind === "natureOfIllness") return null; // An operator answer, never an extracted diagnosis.
  if (kind === "practitioner") {
    const name = (s: string) => {
      const value = normalize(s).replace(/^dr\.?\s+/, "").replace(/,?\s+(?:dc|d\.c\.|pt)$/, "");
      return /^rmt - follow up massage \(60 min\)(?: \(60 minutes\))?$/.test(service) ? value.replace(/,?\s+(?:rmt|r\.m\.t\.)$/, "") : value;
    };
    return dossier.fields.practitioner ? unique(label => name(label.split(/\s+-\s+/)[0]) === name(dossier.fields.practitioner!)) : null;
  }
  const value = dossier.fields[kind as keyof typeof dossier.fields];
  return value == null ? null : typeof value === "number" ? value.toFixed(2) : String(value);
}
