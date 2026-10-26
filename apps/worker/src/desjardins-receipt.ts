import { PDFParse } from "pdf-parse";
import type { ClaimPreparation } from "./claim-preparation.js";
import type { ReceiptPractitioner } from "./split-paid-receipt.js";
const normal = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Single-item paid patient-share receipt, corroborated by the imported primary
 * adjudication. Its amount is the patient share, never the original gross. */
export function desjardinsReceiptEvidence(text: string, dossier: ClaimPreparation): ReceiptPractitioner | null {
  const f = dossier.fields;
  if (dossier.insurer !== "desjardins" || dossier.blocked || !dossier.coordination?.importedStatementAvailable
    || !f.patient || !f.practitioner || !f.provider || !f.invoiceNumber || !f.serviceDate || !f.service
    || f.originalAmount == null || f.otherInsurancePaid == null || f.otherInsurancePaid <= 0 || f.originalAmount <= f.otherInsurancePaid
    || text.length > 30000 || /\b(?:refund|reversed|void|unpaid|declined|balance due)\b/i.test(text)) return null;
  const lines = text.split(/\r?\n/).map(normal).filter(Boolean), receipt = lines.indexOf("Receipt"), items = lines.indexOf("Items Details Amount");
  const invoices = lines.filter(l => l.startsWith("Invoice #")), payments = lines.filter(l => / Credit Card /.test(l));
  const patient = payments.length === 1 ? payments[0].split(" Credit Card ")[1] : "";
  const amount = "$" + ((Math.round(f.originalAmount * 100) - Math.round(f.otherInsurancePaid * 100)) / 100).toFixed(2);
  const date = new Date(f.serviceDate.slice(0, 10) + "T12:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== f.serviceDate.slice(0, 10)) return null;
  const printedDate = date.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
  const invoice = lines.indexOf(invoices[0]), item = normal(lines.slice(items + 1, invoice).join(" "));
  const detail = new RegExp("^" + escape(printedDate) + " - \\d{1,2}:\\d{2}(?:am|pm), " + escape(normal(f.service))
    + " " + escape(normal(f.practitioner)) + ", License #([A-Z0-9]+), Pacific Blue Cross PROVIDERnet #[A-Z0-9]+$").exec(item);
  const unique = (prefix: string, expected: string) => lines.filter(l => l.startsWith(prefix)).length === 1 && lines.includes(expected);
  if (lines[0] !== normal(f.provider) || !/^\d[\p{L}\d .,#'-]+, [\p{L} .'-]+, [A-Z]{2}, [A-Z]\d[A-Z] ?\d[A-Z]\d$/u.test(lines[1] || "")
    || receipt < 3 || items !== receipt + 2 || lines[receipt + 1] !== "Items and Payments" || !detail
    || invoices.length !== 1 || invoices[0] !== "Invoice #" + f.invoiceNumber
    || patient.split(/\s+/).length < 2 || patient.split(/\s+/)[0].toLowerCase() !== f.patient.toLowerCase()
    || lines.slice(2, receipt).filter(l => l === patient).length !== 1
    || !unique("Amount not covered:", "Amount not covered: " + amount) || !unique("Subtotal ", "Subtotal " + amount)
    || !unique("Payer Total ", "Payer Total " + amount) || !unique("Amount:", "Amount: " + amount)
    || !unique("Status:", "Status: authorized succeeded") || lines.filter(l => l === "Payments").length !== 1) return null;
  return { patient, practitioner: f.practitioner, provider: f.provider, address: lines[1], licence: detail[1] };
}
export async function readDesjardinsReceipt(bytes: Buffer, dossier: ClaimPreparation) {
  if (bytes.length > 2000000 || !bytes.subarray(0,5).equals(Buffer.from("%PDF-"))) return null;
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try { const result = await parser.getText(); return result.total === 1 ? desjardinsReceiptEvidence(result.text, dossier) : null; }
  catch { return null; } finally { await parser.destroy(); }
}
