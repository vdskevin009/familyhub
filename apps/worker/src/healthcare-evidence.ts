import type { Classification, Invoice, Mail } from "./invoice-model.js";

export type Insurer = "desjardins" | "blue-cross";
export type EvidenceState = "confirmed" | "reconstructed" | "inferred" | "unknown";
export type HealthcareEvidence = {
  OriginalBilledAmount?: number | null; PatientPaid?: number | null; PatientBalance?: number | null;
  AmountNotCovered?: number | null; SubmittedAmount?: number | null; EligibleAmount?: number | null;
  Provider?: string | null; Practitioner?: string | null; ServiceType?: string | null;
  InvoiceNumber?: string | null; ClaimReference?: string | null;
  ServiceDate?: string | null; StatementDate?: string | null; PaymentDate?: string | null;
  ProcessedInsurers?: Insurer[]; InsurerPayments?: Partial<Record<Insurer, number | null>>;
  FieldSources?: Record<string, "email" | "attachment" | "extraction" | "structured">;
  FieldStates?: Record<string, EvidenceState>;
  Conflicts?: string[];
};

export const healthcareMoney = ["OriginalBilledAmount", "PatientPaid", "PatientBalance", "AmountNotCovered", "SubmittedAmount", "EligibleAmount"] as const;
export const healthcareText = ["Provider", "Practitioner", "ServiceType", "InvoiceNumber", "ClaimReference", "ServiceDate", "StatementDate", "PaymentDate"] as const;
export const healthcareSchema = {
  type: "object", additionalProperties: false,
  required: [...healthcareMoney, ...healthcareText, "ProcessedInsurers", "InsurerPayments"],
  properties: {
    ...Object.fromEntries(healthcareMoney.map(key => [key, { type: ["number", "null"], minimum: 0, maximum: 999999999 }])),
    ...Object.fromEntries(healthcareText.map(key => [key, { type: ["string", "null"] }])),
    ProcessedInsurers: { type: "array", items: { type: "string", enum: ["desjardins", "blue-cross"] } },
    InsurerPayments: { type: "object", additionalProperties: false, required: ["desjardins", "blue-cross"],
      properties: { desjardins: { type: ["number", "null"], minimum: 0 }, "blue-cross": { type: ["number", "null"], minimum: 0 } } }
  }
};

export function calendarDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}
export const memberName = (value: string): Invoice["Member"] =>
  /^(?:visa\s+)?kevin(?: henri)?(?: vanderstraeten)?$/i.test(value.trim()) ? "Kevin"
    : /^(?:visa\s+)?jas(?:mine)?(?: wing)?$/i.test(value.trim()) ? "Jasmine"
      : /^(?:visa\s+)?nathan(?: vanderstraeten)?$/i.test(value.trim()) ? "Nathan" : "unknown";
export const validMoney = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1e9;

/** The forwarding sender is not the clinic. Only a labelled receipt identifies it. */
export function receiptProvider(subject: string): string | null {
  const provider = subject.replace(/^(?:(?:fwd?|re):\s*)+/i, "").match(/^Your Receipt\s*-\s*(.{1,160})$/i)?.[1]?.trim();
  return provider && memberName(provider) === "unknown" ? provider : null;
}

export function validateHealthcare(value: HealthcareEvidence): HealthcareEvidence {
  for (const field of healthcareMoney) if (value[field] != null && !validMoney(value[field])) throw new Error(`Invalid ${field}.`);
  for (const field of healthcareText) if (value[field] != null && (typeof value[field] !== "string" || value[field]!.length > 240)) throw new Error(`Invalid ${field}.`);
  for (const field of ["ServiceDate", "StatementDate", "PaymentDate"] as const) if (value[field] != null && !calendarDate(value[field])) throw new Error(`Invalid ${field}.`);
  if (value.ProcessedInsurers && (!Array.isArray(value.ProcessedInsurers) || value.ProcessedInsurers.some(x => !["desjardins", "blue-cross"].includes(x)))) throw new Error("Invalid processed insurer.");
  for (const [insurer, amount] of Object.entries(value.InsurerPayments || {})) if (!["desjardins", "blue-cross"].includes(insurer) || amount != null && !validMoney(amount)) throw new Error("Invalid insurer payment.");
  return value;
}

/** Only small structured facts survive; email/PDF text stays transient. */
export function extractHealthcareEvidence(mail: Mail, result: Classification): HealthcareEvidence {
  const output: HealthcareEvidence = { ...result.healthcare, FieldSources: {}, FieldStates: {} };
  for (const field of [...healthcareMoney, ...healthcareText]) if (output[field] != null) {
    output.FieldSources![field] = "extraction"; output.FieldStates![field] = "confirmed";
  }
  const amountAfter = (text: string, label: string) => {
    const match = text.match(new RegExp(`(?:${label})\\s*[:=-]?\\s*(?:CAD\\s*)?\\$?\\s*([0-9]{1,7}(?:,[0-9]{3})*\\.[0-9]{2})`, "i"));
    return match ? Number(match[1].replace(/,/g, "")) : null;
  };
  const directInsurerPayment = (text: string, insurer: Insurer): number | null => {
    const insurerPattern = insurer === "desjardins" ? /desjardins/i : /blue\s*cross|croix\s*bleue/i;
    const match = insurerPattern.exec(text);
    if (!match || match.index == null) return null;
    const tail = text.slice(match.index + match[0].length);
    const nextInsurer = tail.search(/desjardins|blue\s*cross|croix\s*bleue/i);
    // Card payments and upcoming appointments after the totals are not insurer adjustments.
    const window = text.slice(match.index, nextInsurer >= 0 ? match.index + match[0].length + nextInsurer : Math.min(text.length, match.index + 700))
      .split(/\b(?:subtotal|payer total|payments|upcoming appointments)\b/i)[0];
    const values = [...window.matchAll(/-\s*(?:CAD\s*)?\$?\s*([0-9]{1,7}(?:,[0-9]{3})*\.[0-9]{2})/gi)]
      .map(item => Number(item[1].replace(/,/g, ""))).filter(validMoney);
    return values.length ? Math.max(...values) : null;
  };
  // Detailed attachment fields take precedence over a brief email; contradictions stay visible.
  for (const [source, text] of [["email", mail.text], ["attachment", mail.attachmentText || ""]] as const) {
    const fields: Array<[typeof healthcareMoney[number], string]> = [
      ["AmountNotCovered", "amount not covered|patient portion|patient responsibility|balance after insurance|montant non couvert|part du patient|reste à charge"],
      ["PatientPaid", "patient paid|paid by patient|total paid|payment of|paiement du patient"],
      ["OriginalBilledAmount", "original (?:billed )?amount|invoice total|total charges|total factur[eé]|prix total"],
      ["SubmittedAmount", "amount (?:claimed|submitted)|submitted amount|montant soumis|montant r[eé]clam[eé]"],
      ["EligibleAmount", "eligible amount|montant admissible"]
    ];
    for (const [field, pattern] of fields) {
      const amount = amountAfter(text, pattern);
      if (amount == null) continue;
      if (output[field] != null && Math.abs(output[field]! - amount) > .005) output.Conflicts = [...(output.Conflicts || []), `${field} differs between extracted evidence (${output[field]}) and ${source} (${amount}).`];
      output[field] = amount; output.FieldSources![field] = source; output.FieldStates![field] = "confirmed";
    }
    if (result.documentRole === "expense") for (const insurer of ["desjardins", "blue-cross"] as const) {
      const payment = directInsurerPayment(text, insurer);
      if (payment == null) continue;
      const previous = output.InsurerPayments?.[insurer];
      if (previous != null && Math.abs(previous - payment) > .005) output.Conflicts = [...(output.Conflicts || []), `InsurerPayments.${insurer} differs between extracted evidence (${previous}) and ${source} (${payment}).`];
      output.InsurerPayments = { ...(output.InsurerPayments || {}), [insurer]: payment };
      output.ProcessedInsurers = [...new Set([...(output.ProcessedInsurers || []), insurer])];
      output.FieldSources![`InsurerPayments.${insurer}`] = source;
      output.FieldStates![`InsurerPayments.${insurer}`] = "confirmed";
    }
    const invoice = text.match(/(?:invoice|facture)\s*(?:number|no\.?|#|n[°º])\s*[:#-]?\s*([a-z0-9][a-z0-9-]{2,})/i)?.[1];
    if (invoice) { output.InvoiceNumber = invoice; output.FieldSources!.InvoiceNumber = source; }
    const date = text.match(/(?:service date|date (?:of service|du soin|de service))\s*[:=-]?\s*(\d{4}-\d{2}-\d{2})/i)?.[1];
    if (calendarDate(date)) { output.ServiceDate = date; output.FieldSources!.ServiceDate = source; }
    // Jane's item row labels the appointment, independently of payment/printed/received dates.
    if (receiptProvider(mail.subject) && /invoice\s*#/i.test(`${mail.text}\n${mail.attachmentText || ""}`)) {
      // The PDF reader flattens whitespace. "Items and Payments" is a header, not the payment section.
      const items = text.split(/\binvoice\s*#|\bupcoming appointments\b/i)[0];
      const appointments = [...items.matchAll(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\s*-\s*\d{1,2}:\d{2}\s*(?:am|pm),\s*([^\n]+)/gi)];
      if (appointments.length === 1) {
        const row = appointments[0];
        const month = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].indexOf(row[1].toLowerCase()) + 1;
        const serviceDate = calendarDate(`${row[3]}-${String(month).padStart(2, "0")}-${row[2].padStart(2, "0")}`);
        if (serviceDate) {
          if (output.ServiceDate && output.ServiceDate !== serviceDate) output.Conflicts = [...(output.Conflicts || []), `ServiceDate differs from labelled appointment (${output.ServiceDate} vs ${serviceDate}).`];
          output.ServiceDate = serviceDate; output.FieldSources!.ServiceDate = source; output.FieldStates!.ServiceDate = "confirmed";
          const service = row[4].split(/\s+(?:Dr\.\s|[A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+(?:RMT|DC|PT))?,?\s*License\b)/)[0].trim().slice(0, 240);
          output.ServiceType = service; output.FieldSources!.ServiceType = source; output.FieldStates!.ServiceType = "confirmed";
        }
      }
    }
  }
  const all = `${mail.sender}\n${mail.subject}\n${mail.text}\n${mail.attachmentText || ""}`;
  if (/qubecore/i.test(all)) { output.Provider = "QubeCore Sports & Rehab"; output.FieldSources!.Provider = /qubecore/i.test(mail.attachmentText || "") ? "attachment" : "email"; }
  output.Provider ||= receiptProvider(mail.subject);
  if (output.Provider && memberName(output.Provider) !== "unknown") output.Provider = null;
  // Some Jane receipts label the final patient total after GST instead of "Amount not covered".
  // This becomes a residual only when an explicit insurer adjustment also exists.
  if (receiptProvider(mail.subject) && output.PatientBalance == null && output.AmountNotCovered == null
    && Object.values(output.InsurerPayments || {}).some(validMoney)) {
    for (const [source, text] of [["email", mail.text], ["attachment", mail.attachmentText || ""]] as const) {
      const total = text.match(/\bGST\s*[:=]?\s*\$?\s*\d+\.\d{2}\s+(?:Payer\s+)?Total\s*[:=]?\s*\$?\s*(\d+\.\d{2})/i)?.[1];
      if (total) {
        output.PatientBalance = Number(total); output.FieldSources!.PatientBalance = source; output.FieldStates!.PatientBalance = "confirmed";
      }
    }
  }
  const residual = output.PatientBalance ?? output.AmountNotCovered;
  if (residual != null) {
    if (receiptProvider(mail.subject) && output.AmountNotCovered != null) output.PatientBalance = output.AmountNotCovered;
    if (receiptProvider(mail.subject)) for (const insurer of ["desjardins", "blue-cross"] as const) {
      if (directInsurerPayment(mail.text, insurer) == null && directInsurerPayment(mail.attachmentText || "", insurer) == null) {
        // A processor mention proves processing, not a payment; reject an unsupported AI amount.
        if (output.InsurerPayments?.[insurer] != null) output.Conflicts = [...(output.Conflicts || []), `InsurerPayments.${insurer} has no labelled insurer adjustment in the receipt.`];
        if (output.InsurerPayments) delete output.InsurerPayments[insurer];
        delete output.FieldSources![`InsurerPayments.${insurer}`];
        output.FieldStates![`InsurerPayments.${insurer}`] = "unknown";
      }
    }
    output.PatientBalance ??= residual;
    const processed = new Set(output.ProcessedInsurers || []);
    if (/desjardins/i.test(all)) processed.add("desjardins");
    if (/blue\s*cross|croix\s*bleue/i.test(all)) processed.add("blue-cross");
    // TELUS is a processor, not enough by itself to name an insurer.
    output.ProcessedInsurers = [...processed];
    const explicitPayments = Object.entries(output.InsurerPayments || {}).filter(([, amount]) => validMoney(amount));
    if (result.documentRole === "expense" && explicitPayments.length) {
      const reconstructed = Math.round((residual + explicitPayments.reduce((sum, [, amount]) => sum + Number(amount), 0)) * 100) / 100;
      if (output.OriginalBilledAmount != null && Math.abs(output.OriginalBilledAmount - reconstructed) > .005) {
        output.Conflicts = [...(output.Conflicts || []), `OriginalBilledAmount differs from direct-insurance arithmetic (${output.OriginalBilledAmount} vs ${reconstructed}).`];
      }
      output.OriginalBilledAmount = reconstructed;
      const paymentSources = explicitPayments.map(([insurer]) => output.FieldSources?.[`InsurerPayments.${insurer}`]).filter(Boolean);
      output.FieldSources!.OriginalBilledAmount = paymentSources.includes("attachment") ? "attachment" : paymentSources.includes("email") ? "email" : "extraction";
      output.FieldStates!.OriginalBilledAmount = "reconstructed";
    }
    // A residual proves what the patient still owes after processing; it does not prove the gross expense.
    // If the source never labels a gross/original total and no explicit insurer payment lets us reconstruct it,
    // discard any classifier/stale-index amount instead of promoting a subtotal or patient payment.
    else if (!/(?:original (?:billed )?amount|invoice total|total charges|total factur[eé]|prix total)/i.test(all)) {
      output.OriginalBilledAmount = null;
      delete output.FieldSources!.OriginalBilledAmount;
      output.FieldStates!.OriginalBilledAmount = "unknown";
    }
  }
  output.ServiceDate ??= result.serviceDate;
  return validateHealthcare(output);
}

/** Versioned adapter for old imports; no raw documents are re-read or modified here. */
export function healthcareEvidence(item: Invoice): HealthcareEvidence {
  const h = { ...item.Healthcare, FieldSources: { ...item.Healthcare?.FieldSources }, FieldStates: { ...item.Healthcare?.FieldStates } };
  h.ServiceDate ??= calendarDate(item.ServiceDate);
  h.StatementDate ??= calendarDate(item.StatementDate);
  h.ServiceType ??= item.ClaimedService;
  if (!h.Provider && memberName(item.Provider) === "unknown" && item.AccountLabel !== "Local Desjardins import" && !item.StructuredSource) h.Provider = item.Provider;
  h.Provider ||= receiptProvider(item.Subject);
  if (h.Provider && memberName(h.Provider) !== "unknown") h.Provider = null;
  const residual = h.AmountNotCovered != null || h.PatientBalance != null;
  if (!("OriginalBilledAmount" in h) && !residual && item.DocumentRole === "expense") h.OriginalBilledAmount = item.BilledAmount;
  if (item.StructuredSource === "blue-cross-portal") {
    h.SubmittedAmount ??= item.BilledAmount;
    h.FieldSources.SubmittedAmount = "structured";
  }
  if (item.AccountLabel === "Local Desjardins import") {
    // Historical imports stored a service label in Provider. Preserve it as service, not a clinic.
    h.ServiceType ||= item.Provider.replace(/^Desjardins\s*·\s*/, "");
    if (h.ServiceType === item.Provider || item.Provider.startsWith("Desjardins ·")) h.Provider = null;
    const submitted = item.Notes.match(/Submitted (\d+\.\d{2})/i)?.[1];
    const eligible = item.Notes.match(/admissible (\d+\.\d{2})/i)?.[1];
    h.SubmittedAmount ??= submitted ? Number(submitted) : null;
    h.EligibleAmount ??= eligible ? Number(eligible) : null;
    h.PaymentDate ??= calendarDate(item.ReceivedAt?.slice(0, 10));
    h.FieldSources.SubmittedAmount = "structured";
    h.FieldSources.EligibleAmount = "structured";
    h.FieldSources.ServiceType = "structured";
    h.FieldStates.ServiceType = "confirmed";
  }
  return h;
}
