import { PDFParse } from "pdf-parse";
import type { Page } from "playwright";
import type { ClaimPreparation } from "./claim-preparation.js";

// Exact visible checklist supplied by the operator. Extra requirements abstain.
export const receiptChecklist = "Please check the box to confirm you have the following: If you don’t have your documents or receipts ready to upload please gather the necessary documents and try again later. Your claim cannot be processed without documents being uploaded (You will be asked to upload copies of these during this claim submission) Copy of the detailed payment receipt (no cashier tapes accepted). A detailed payment receipt must include the providers name & address, patients full name, date of purchase/service, amount charged and confirmation the item/service has been paid in full.";
const normalize = (text: string) => text.normalize("NFKC").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
export async function blueCrossReceiptCheckbox(page: Page) {
  const url = new URL(page.url());
  if (url.origin !== "https://service.pac.bluecross.ca" || !/\/Claims\/eClaim\.aspx$/i.test(url.pathname)) return null;
  const matches = [];
  for (const locator of await page.locator('input[type="checkbox"]').all()) {
    if (!await locator.isVisible() || !await locator.isEnabled()) continue;
    const metadata = await locator.evaluate((el: HTMLInputElement, expected: string) => {
      const normalize = (text: string) => text.normalize("NFKC").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
      let node: HTMLElement | null = el.parentElement;
      for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
        if (normalize(node.innerText) === expected && node.querySelectorAll('input[type="checkbox"]').length === 1)
          return { checked: el.checked, signature: JSON.stringify([el.id, el.name, expected]) };
      }
      return null;
    }, normalize(receiptChecklist));
    if (metadata) matches.push({ locator, ...metadata });
  }
  return matches.length === 1 ? matches[0] : null;
}

/** Recognizes only the observed single-item, fully paid card-receipt format.
 * No diagnosis, eligibility or payment is inferred from a filename or invoice total.
 */
export function detailedReceiptEvidence(text: string, dossier: ClaimPreparation): boolean {
  const f = dossier.fields;
  if (dossier.blocked || !f.provider || !f.patient || !f.invoiceNumber || !f.serviceDate || !f.practitioner
    || f.originalAmount == null || f.originalAmount <= 0 || text.length > 30_000) return false;
  const lines = text.split(/\r?\n/).map(normalize).filter(Boolean);
  const date = new Date(`${f.serviceDate.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return false;
  const printedDate = date.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
  const invoice = lines.filter(line => /^Invoice #/.test(line));
  const totals = lines.filter(line => /^Payer Total /.test(line));
  const amounts = lines.filter(line => /^Amount: /.test(line));
  const statuses = lines.filter(line => /^Status: /.test(line));
  const money = `$${f.originalAmount.toFixed(2)}`;
  const payer = lines.filter(line => line.includes(" Credit Card "));
  const fullName = payer.length === 1 ? payer[0].split(" Credit Card ")[1] : "";
  const receiptIndex = lines.indexOf("Receipt"), itemIndex = lines.indexOf("Items Details Amount");
  return lines[0] === normalize(f.provider)
    && /^#?\d[\w .,#-]+, [\p{L} .'-]+, [A-Z]{2}, [A-Z]\d[A-Z] ?\d[A-Z]\d$/u.test(lines[1] || "")
    && receiptIndex > 2 && lines.includes("Items and Payments") && itemIndex > receiptIndex
    && fullName.split(/\s+/).length >= 2 && fullName.split(/\s+/)[0].toLowerCase() === f.patient.toLowerCase()
    && lines.slice(2, receiptIndex).filter(line => line === fullName).length === 1
    && lines[itemIndex + 1]?.startsWith(`${printedDate} - `)
    && lines[itemIndex + 2]?.startsWith(`${normalize(f.practitioner)}, License #`)
    && invoice.length === 1 && invoice[0] === `Invoice #${f.invoiceNumber} ${money}`
    && totals.length === 1 && totals[0] === `Payer Total ${money}`
    && amounts.length === 1 && amounts[0] === `Amount: ${money}`
    && statuses.length === 1 && statuses[0] === "Status: authorized succeeded"
    && lines.includes("Payments") && !/\b(?:refund|reversed|void|unpaid|declined|balance due)\b/i.test(text);
}
export async function verifyDetailedReceipt(bytes: Buffer, dossier: ClaimPreparation): Promise<boolean> {
  if (bytes.length > 2_000_000 || !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) return false;
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    const result = await parser.getText();
    return result.total === 1 && detailedReceiptEvidence(result.text, dossier);
  } catch { return false; }
  finally { await parser.destroy(); }
}
