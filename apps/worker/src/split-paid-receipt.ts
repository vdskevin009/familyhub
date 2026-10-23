import type { ClaimPreparation } from "./claim-preparation.js";

const normal = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim();
const cents = (s: string) => Math.round(Number(s.replace(/[$,]/g, "")) * 100);
const money = "(\\$\\d+\\.\\d{2})";
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type ReceiptPractitioner = { practitioner: string; licence: string; provider: string; address: string; patient: string };
/** The saved portal label omits province/postcode. Match every remaining address token. */
export function receiptProviderOption(identity: ReceiptPractitioner | null | undefined, options: { value: string; label: string }[]) {
  if (!identity) return null;
  const name = (s: string) => normal(s).toLowerCase().replace(/,?\s+(?:rmt|r\.m\.t\.)$/, "");
  const address = (s: string) => normal(s).toLowerCase().replace(/[^\p{L}\d]/gu, "");
  const sourceAddress = identity.address.replace(/,\s*[A-Z]{2},\s*[A-Z]\d[A-Z] ?\d[A-Z]\d$/, "");
  const matching = options.filter(o => {
    const parts = o.label.split(/\s+-\s+/);
    return o.value && parts.length === 2 && name(parts[0]) === name(identity.practitioner) && address(parts[1]) === address(sourceAddress);
  });
  return matching.length === 1 ? matching[0].value : null;
}

/** One observed Jane receipt layout: two payers, one item, explicit zero balances.
 * Keep original amounts and identity untouched; ambiguous layouts abstain.
 */
export function splitPaidReceiptEvidence(text: string, dossier: ClaimPreparation) {
  const f = dossier.fields;
  if (dossier.blocked || dossier.insurer !== "blue-cross" || !f.provider || !f.patient || !f.practitioner
    || !f.service || !f.invoiceNumber || !f.serviceDate || f.originalAmount == null || f.otherInsurancePaid == null
    || f.otherInsurancePaid <= 0 || f.otherInsurancePaid >= f.originalAmount || text.length > 30_000
    || /\b(?:refund|reversed|void|unpaid|declined|balance due)\b/i.test(text)) return null;
  const date = new Date(f.serviceDate.slice(0, 10) + "T12:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== f.serviceDate.slice(0, 10)) return null;
  const printedDate = date.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
  const day = date.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long" });
  const lines = text.split(/\r?\n/).map(normal).filter(Boolean), compact = normal(text);
  const receipt = lines.indexOf("Receipt"), items = lines.indexOf("Items Details Subtotal Tax Total");
  const payments = lines.indexOf("Payments"), summary = lines.findIndex(l => l.startsWith("Summary As of "));
  if (lines[0] !== normal(f.provider) || !/^\d[\p{L}\d .'-]+, Suite [\p{L}\d-]+, [\p{L} .'-]+, [A-Z]{2}, [A-Z]\d[A-Z] ?\d[A-Z]\d$/u.test(lines[1] || "")
    || receipt < 3 || lines[receipt + 1] !== "Items" || items !== receipt + 2 || payments <= items || summary <= payments
    || (compact.match(/Invoice #/g) || []).length !== 1 || lines.filter(l => l === "Payments").length !== 1
    || lines.filter(l => l.startsWith("Summary As of ")).length !== 1) return null;
  const invoiceIndex = lines.findIndex(l => l.startsWith("Invoice #"));
  const identity = lines[invoiceIndex - 1]?.match(/^(.+), License #([A-Z0-9]+)$/);
  if (!identity || normal(identity[1]) !== normal(f.practitioner)) return null;
  const item = normal(lines.slice(items + 1, invoiceIndex - 1).join(" "));
  if (!new RegExp("^" + escape(printedDate) + " - \\d{1,2}:\\d{2}(?:am|pm), " + escape(normal(f.service)) + "$", "i").test(item)) return null;
  const invoice = new RegExp("^Invoice #" + escape(f.invoiceNumber) + " " + money + " " + money + " " + money + "$").exec(lines[invoiceIndex]);
  const gross = Math.round(f.originalAmount * 100), other = Math.round(f.otherInsurancePaid * 100), patient = gross - other;
  if (!invoice || cents(invoice[1]) + cents(invoice[2]) !== gross || cents(invoice[3]) !== gross) return null;
  const body = lines.slice(invoiceIndex + 1, payments);
  if (body[0] !== "DESJARDINS INSURANCE (TELUS eClaims)" || body.filter(l => /^1x /.test(l)).length !== 1) return null;
  const amountNotCovered = body.filter(l => l.startsWith("Amount not covered: "));
  const adjustment = body.filter(l => /^-\$/.test(l));
  const adjustmentValues = adjustment.length === 1 ? new RegExp("^-" + money + " -" + money + " -" + money + "$").exec(adjustment[0]) : null;
  const subtotal = body.filter(l => /^Subtotal /.test(l)), tax = body.filter(l => /^GST /.test(l)), total = body.filter(l => /^Total /.test(l));
  if (amountNotCovered.length !== 1 || amountNotCovered[0] !== "Amount not covered: $" + (patient / 100).toFixed(2)
    || !adjustmentValues || cents(adjustmentValues[1]) + cents(adjustmentValues[2]) !== other || cents(adjustmentValues[3]) !== other
    || subtotal.length !== 1 || tax.length !== 1 || total.length !== 1
    || !/^Subtotal \$\d+\.\d{2}$/.test(subtotal[0]) || !/^GST \$\d+\.\d{2}$/.test(tax[0]) || !/^Total \$\d+\.\d{2}$/.test(total[0])
    || cents(subtotal[0].slice(9)) + cents(tax[0].slice(4)) !== patient || cents(total[0].slice(6)) !== patient) return null;
  const paymentText = normal(lines.slice(payments + 1, summary).join(" "));
  const paymentDate = escape(day + " " + printedDate) + " - \\d{1,2}:\\d{2}(?:am|pm)";
  const paymentPattern = new RegExp("^Date Details Payment Amount Payment Applied " + paymentDate
    + " Payment #[A-Z0-9-]+ - DESJARDINS INSURANCE, Direct Deposit -" + money + " " + paymentDate
    + " Payment #[A-Z0-9-]+ - ([\\p{L} .'-]+), Visa " + money + " -" + money + "$", "u");
  const paid = paymentPattern.exec(paymentText);
  if (!paid || cents(paid[1]) !== other || cents(paid[3]) !== patient || cents(paid[4]) !== patient
    || paid[2].split(/\s+/).length < 2 || paid[2].split(/\s+/)[0].toLowerCase() !== f.patient.toLowerCase()
    || lines.slice(2, receipt).filter(l => l === paid[2]).length !== 1) return null;
  const summaryText = normal(lines.slice(summary).join(" "));
  const heading = "Patient Total Invoiced Patient Total Paid Patient Balance Other Payers Total Invoiced Other Payers Total Paid Other Payers Balance Total Invoiced Total Applied Balance";
  const summaryMatch = new RegExp("^Summary As of " + escape(day + " " + printedDate) + " at (\\d{1,2}:\\d{2}(?:am|pm)) "
    + heading + " " + Array(9).fill(money).join(" ") + " (.+) -- 1 of 1 --$").exec(summaryText);
  if (!summaryMatch || ![patient, patient, 0, other, other, 0, gross, gross, 0].every((n, i) => cents(summaryMatch[i + 2]) === n)
    || !summaryMatch[11].startsWith(normal(f.provider) + " - ")
    || !summaryMatch[11].endsWith("Printed at: " + printedDate + " - " + summaryMatch[1])) return null;
  return { practitioner: identity[1], licence: identity[2], provider: lines[0], address: lines[1], patient: paid[2] };
}
