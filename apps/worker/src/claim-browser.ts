import { createHash, randomUUID } from "node:crypto";
import { chromium, type Browser, type Page, type Locator } from "playwright";
import { join } from "node:path";
import { dataDirectory, loadPrivate } from "./private-store.js";
import type { ClaimPreparation } from "./claim-preparation.js";
import { exactServiceOption } from "./claim-preparation.js";
import { blueCrossComboFields, blueCrossSuggestion, blueCrossTextField } from "./bluecross-claim-form.js";
import { blueCrossSessionMarker } from "./bluecross-collector.js";
import { isBlueCrossMemberPage, openBlueCrossClaimEntry } from "./bluecross-claim-navigation.js";
import { savedServiceChoice, rememberServiceChoice, forgetServiceChoices, serviceChoiceScope } from "./claim-service-choices.js";
import { codexServiceRunner, validatedServiceProposals, type ServiceRunner } from "./claim-service-suggestions.js";
import { checkedField, uploadEvidence, type ApprovedField, type ObservedField } from "./claim-field-verification.js";
import { acquirePortalLock, classifyLoginScreen, type LoginReason } from "./portal-login.js";
import { loginForClaim, authenticatedClaimPages, preserveBlueCrossClaimSession } from "./claim-login.js";
import { automaticClaimValues } from "./claim-autofill.js";
import { desjardinsRadioField } from "./desjardins-claim-form.js";
import { reserveClaimUpload, reserveClaimUploadRetry } from "./claim-upload-guard.js";
import { confirmedInvoicePractitioner } from "./claim-practitioner-answers.js";
import { confirmedInvoiceIllness } from "./claim-invoice-answers.js";
import { blueCrossReceiptCheckbox, verifyDetailedReceipt } from "./bluecross-receipt-checklist.js";
import { advanceBlueCrossDetails, advanceBlueCrossExpenses } from "./bluecross-claim-progress.js";
import { isBlueCrossClaimCausePage, openBlueCrossClaimCause } from "./bluecross-claim-cause.js";
import { isBlueCrossClaimKindPage, openBlueCrossHealthcareClaim } from "./bluecross-claim-kind.js";
import { blueCrossReceiptFile, blueCrossReceiptMatches, openBlueCrossReceiptUpload, blueCrossReceiptAlreadyListed, blueCrossReceiptUploadEvidence, blueCrossReceiptUploadAvailable } from "./bluecross-claim-upload.js";

export type Field = { key: string; label: string; type: string; options: { value: string; label: string }[];
  suggested: string | null; kind: string | null; suggestionSource?: "confirmed-choice" | "confirmed-answer" | "invoice" | "codex"; suggestionReason?: string; autoAttachment?: boolean; optional?: boolean };
type Target = { locator: Locator; field: Field; signature: string; initialValue: string; dropdown?: Locator; providers?: Locator };
type ApprovedSnapshot = { revision: string; url: string; entries: { target: Target; approved: ApprovedField; filled: boolean }[]; attachment?: { name: string; selected: boolean; blocked?: boolean } };
type Session = { id: string; browser: Browser; page: Page; dossier: ClaimPreparation; createdAt: number;
  fields: Map<string, Target>; attemptedAttachments: Set<string>; busy: boolean; revision: string; inspectedUrl: string; approved?: ApprovedSnapshot;
  authenticate?: typeof loginForClaim; autonomous?: boolean; loginRefreshAttempted?: boolean; authPersistenceAttempted?: boolean; authReason?: LoginReason; release?: () => Promise<void>; claimEntryAttempted?: boolean; claimKindAttempted?: boolean; claimCauseAttempted?: boolean; detailsNextAttempted?: boolean; detailsReadBackVerified?: boolean; detailsNextVerified?: boolean; summaryNextAttempted?: boolean; receiptRetryUsed?: boolean; authorizedRetryHash?: string; uploadEntryAttempted?: boolean };
let session: Session | undefined;
let opening = false;
const allowed = (url: string, insurer: ClaimPreparation["insurer"]) => {
  const u = new URL(url);
  return !u.username && !u.password && u.origin === (insurer === "blue-cross" ? "https://service.pac.bluecross.ca"
    : "https://www.agea-gbim.dsf-dfs.com");
};
function current(id: unknown): Session {
  if (!session || id !== session.id || Date.now() - session.createdAt > 30 * 60_000 || session.page.isClosed()) throw new Error("Claim preparation expired. Open a new preparation session.");
  return session;
}
export async function openClaimBrowser(dossier: ClaimPreparation, historyReviewed: unknown, warningsReviewed: unknown = false,
  launch?: () => Promise<Browser>, autonomous = false, authenticate: typeof loginForClaim = loginForClaim) {
  if (opening) throw new Error("A preparation window is already opening. Wait before resuming it.");
  opening = true;
  try { return await openBrowser(dossier, historyReviewed, warningsReviewed, launch, autonomous, authenticate); }
  finally { opening = false; }
}
async function openBrowser(dossier: ClaimPreparation, historyReviewed: unknown, warningsReviewed: unknown,
  launch: () => Promise<Browser> = () => chromium.launch({ headless: false, channel: process.platform === "win32" ? dossier.insurer === "desjardins" ? "msedge" : "chrome" : undefined }), autonomous = false, authenticate: typeof loginForClaim = loginForClaim) {
  if (dossier.blocked) throw new Error(dossier.coordination?.message || "Resolve the recorded or possible duplicate and source conflicts before preparing a claim.");
  if (!autonomous && historyReviewed !== true) throw new Error("Review the insurer's current history for this invoice before opening preparation.");
  if (!autonomous && dossier.reviewableWarnings.length && warningsReviewed !== true) throw new Error("Review the original PDF and confirm the shown gross expense and other-insurer payment before preparing this claim.");
  if (session && !session.page.isClosed()) {
    if (session.dossier.expenseId === dossier.expenseId && session.dossier.insurer === dossier.insurer
      && JSON.stringify(session.dossier.fields) === JSON.stringify(dossier.fields)) return { sessionId: session.id, status: "resumed", step: await inspectClaimStep(session.id), submitAllowed: false };
    throw new Error("A claim preparation window is already open. Close it before preparing another invoice.");
  }
  const unlock = await acquirePortalLock(dossier.insurer === "blue-cross" ? "bluecross" : "desjardins");
  let released: Promise<void> | undefined;
  const release = () => released ||= unlock();
  let browser: Browser;
  try { browser = await launch(); } catch { await release(); throw new Error("The insurer preparation browser could not open."); }
  try {
    const context = await browser.newContext();
    // Reuse only previously authorized insurer cookies; no new credentials are saved.
    try {
      const auth = await loadPrivate<{ cookies?: import("playwright").Cookie[]; session?: { origin: string; value?: string; values?: Record<string, string> } }>(join(dataDirectory, dossier.insurer === "blue-cross" ? "bluecross" : "desjardins", "auth-state.dpapi"));
      const domains = dossier.insurer === "blue-cross" ? /(?:^|\.)pac\.bluecross\.ca$/i : /(?:^|\.)(?:dsf-dfs\.com|desjardins\.com)$/i;
      if (auth.cookies) await context.addCookies(auth.cookies.filter(c => domains.test(c.domain.replace(/^\./, ""))));
      if (dossier.insurer === "blue-cross") {
        const marker = blueCrossSessionMarker(auth.session?.origin || "", auth.session?.value);
        if (marker) await context.addInitScript(value => {
          if (location.origin === "https://service.pac.bluecross.ca" && !sessionStorage.getItem("pbcMemberProfileData")) sessionStorage.setItem("pbcMemberProfileData", value);
        }, marker);
      } else if (auth.session?.origin === "https://www.agea-gbim.dsf-dfs.com" && auth.session.values
        && Object.keys(auth.session.values).length <= 100 && JSON.stringify(auth.session.values).length <= 100_000) {
        await context.addInitScript(values => {
          if (location.origin !== "https://www.agea-gbim.dsf-dfs.com") return;
          for (const [key, value] of Object.entries(values))
            if (typeof value === "string" && !sessionStorage.getItem(key)) sessionStorage.setItem(key, value);
        }, auth.session.values);
      }
    } catch { /* A normal visible login remains available. */ }
    let page = await context.newPage();
    await page.goto(dossier.preparationUrl || dossier.portalUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const authReason = autonomous ? await authenticate(page, dossier.insurer) : undefined;
    if (autonomous) {
      const authenticated = await authenticatedClaimPages(page, dossier.insurer);
      if (authenticated.length > 1) throw new Error("Several authenticated insurer tabs are open.");
      if (authenticated.length === 1) page = authenticated[0];
    }
    session = { id: randomUUID(), browser, page, dossier, createdAt: Date.now(), fields: new Map(), attemptedAttachments: new Set(), busy: false, revision: "", inspectedUrl: "", authReason, release, autonomous, authenticate };
    const timer = setTimeout(() => { if (session?.browser === browser) { session = undefined; void browser.close(); } }, 30 * 60_000);
    timer.unref();
    browser.on("disconnected", () => { clearTimeout(timer); if (session?.browser === browser) session = undefined; void release().catch(() => {}); });
    const step = await inspectClaimStep(session.id);
    return { sessionId: session.id, status: "opened", step, submitAllowed: false };
  } catch { await browser.close(); await release(); throw new Error("Preparation could not open safely. Check the insurer window or retry status; credentials are never returned."); }
}

function fieldKind(label: string): string | null {
  const name = label.normalize("NFC").toLowerCase().replace(/[\s:*]+/g, " ").trim();
  if (/^(?:patient|claimant|covered person|personne assurée|bénéficiaire|personne concernée)$/.test(name)) return "patient";
  if (/^(?:service date|date of service|date du service|date des soins|date du traitement)$/.test(name)) return "serviceDate";
  if (/^(?:service|benefit|service type|type of service|type de service|catégorie de soins|type de soins)$/.test(name)) return "service";
  if (/^(?:amount|amount claimed|amount charged|cost|submitted amount|montant réclamé|montant des frais|coût)$/.test(name)) return "originalAmount";
  if (/^(?:provider|provider name|clinic|nom du fournisseur|professionnel de la santé)$/.test(name)) return "provider";
  if (/^(?:practitioner|practitioner name|nom du professionnel)$/.test(name)) return "practitioner";
  if (/^(?:invoice number|receipt number|numéro de facture|numéro du reçu)$/.test(name)) return "invoiceNumber";
  return null;
}
export async function inspectClaimStep(id: unknown) {
  const s = current(id);
  if (s.busy) throw new Error("The current step is being filled.");
  s.busy = true;
  try { return await inspect(s); } finally { s.busy = false; }
}
async function inspect(s: Session) {
  // A portal may open its form in a new tab. Never target another origin.
  const candidates = s.page.context().pages().filter(p => !p.isClosed() && allowed(p.url(), s.dossier.insurer));
  if (candidates.length) s.page = candidates[candidates.length - 1];
  s.fields.clear(); s.revision = "";
  if (!allowed(s.page.url(), s.dossier.insurer) || await s.page.locator('input[type="password"]').isVisible().catch(() => false)) return { status: s.authReason === "human-required" ? "human-required" : "login-required", authReason: s.authReason, fields: [], revision: "", submitAllowed: false };
  const body = (await s.page.locator("body").innerText()).slice(0, 30_000);
  if (classifyLoginScreen(body) === "human-required") return { status: "human-required", fields: [], revision: "", submitAllowed: false };
  if (s.autonomous && s.dossier.insurer === "blue-cross" && !s.authPersistenceAttempted
    && /\/ACESWeb\/Pages\/Claims\/eClaim\.aspx$/.test(new URL(s.page.url()).pathname)) {
    s.authPersistenceAttempted = true;
    await preserveBlueCrossClaimSession(s.page).catch(() => false);
  }
  if (s.dossier.insurer === "blue-cross" && /what kind of claim would you like to submit\?/i.test(body.replace(/\s+/g, " "))
    && await isBlueCrossClaimKindPage(s.page)) {
    if (!s.claimKindAttempted) {
      const opened = await openBlueCrossHealthcareClaim(s.page, s.dossier, () => { s.claimKindAttempted = true; }).catch(() => false);
      if (opened) return inspect(s);
    }
    return { status: "navigate", fields: [], revision: "", submitAllowed: false };
  }
  if (s.dossier.insurer === "blue-cross" && body.includes("The service or product provided is") && await isBlueCrossClaimCausePage(s.page)) {
    if (!s.claimCauseAttempted) {
      const opened = await openBlueCrossClaimCause(s.page, s.dossier, () => { s.claimCauseAttempted = true; }).catch(() => false);
      if (opened) return inspect(s);
    }
    return { status: "navigate", fields: [], revision: "", submitAllowed: false, answerWarning: "Choose the claim cause in the insurer window, or explicitly confirm its saved default." };
  }
  // Manual login can return to member home after the original open request.
  // Its search/preferences controls are not claim fields. Attempt only the
  // observed navigation tile, once per session, including uncertain outcomes.
  if (s.dossier.insurer === "blue-cross" && isBlueCrossMemberPage(s.page.url())) {
    if (!s.claimEntryAttempted) {
      const previousPage = s.page, previousUrl = s.page.url();
      await openBlueCrossClaimEntry(s.page, () => { s.claimEntryAttempted = true; }).catch(() => {});
      const pages = s.page.context().pages().filter(p => !p.isClosed() && allowed(p.url(), s.dossier.insurer));
      if (pages.length) s.page = pages[pages.length - 1];
      if (s.page !== previousPage || s.page.url() !== previousUrl) return inspect(s);
    }
    return { status: "navigate", fields: [], revision: "", submitAllowed: false };
  }
  const completed = /your claim has been (?:processed|submitted)|réclamation a été (?:transmise|soumise)/i.test(body);
  const atReview = completed || /review (?:your )?claim|claim summary|I confirm all the information above is correct and I have read and agree|vérifi(?:ez|cation).*réclamation|résumé de (?:la|votre) réclamation/i.test(body);
  s.fields.clear();
  s.revision = randomUUID();
  s.inspectedUrl = s.page.url();
  if (s.approved && s.approved.url !== s.inspectedUrl) s.approved = undefined;
  if (completed) return { status: "complete", fields: [], revision: s.revision, submitAllowed: false };
  if (atReview && body.includes("Additional Information Required") && s.dossier.insurer === "blue-cross" && !s.uploadEntryAttempted && !s.attemptedAttachments.size && !s.approved?.attachment) {
    const opened = await openBlueCrossReceiptUpload(s.page, s.dossier, () => { s.uploadEntryAttempted = true; }).catch(() => false);
    if (opened) return inspect(s);
  }
  const receiptFile = s.dossier.insurer === "blue-cross" && body.includes("Claim Documentation Required") ? await blueCrossReceiptFile(s.page) : null;
  if (s.dossier.insurer === "blue-cross" && /\/Claims\/eClaim\.aspx$/i.test(new URL(s.page.url()).pathname) && !atReview) {
    for (const definition of blueCrossComboFields) {
      const locator = s.page.locator(`input[id$="_${definition.suffix}"]`);
      if (await locator.count() !== 1 || !await locator.isVisible() || !await locator.isEnabled()) continue;
      const metadata = await locator.evaluate((el: HTMLInputElement) => ({ id: el.id, value: el.value, signature: JSON.stringify([el.tagName, el.id, el.name, el.type, [] , null]) }));
      // Preserve an operator selection. An empty combo is inspected by opening
      // its visible menu; no hidden Telerik model or remote calls are used.
      if (metadata.value.trim()) continue;
      const dropdown = s.page.locator(`[id="${metadata.id.replace(/_Input$/, "_DropDown")}"]`);
      await locator.click();
      try {
        if (!await dropdown.isVisible()) continue;
        const labels = await dropdown.locator("li").allTextContents();
        const options = labels.map(label => label.trim()).filter(Boolean).map(label => ({ label, value: label }));
        const field: Field = { key: randomUUID(), label: definition.label, kind: definition.kind, type: "combo", options,
          suggested: blueCrossSuggestion(definition.kind, s.dossier, options) };
        s.fields.set(field.key, { locator, field, signature: metadata.signature, initialValue: metadata.value, dropdown });
      } finally { await locator.press("Escape"); }
    }
    const providers = s.page.locator('input[type="radio"][id*="_repProvider_"][id$="_optProvider"]').filter({ visible: true });
    const providerMetadata = await providers.evaluateAll((els: HTMLInputElement[]) => els.map(el => ({ id: el.id, name: el.name, label: Array.from(el.labels || []).map(l => l.textContent?.trim()).filter(Boolean).join(" "), checked: el.checked })));
    if (providerMetadata.length && !providerMetadata.some(p => p.checked)) {
      const options = providerMetadata.filter(p => p.label).map(p => ({ label: p.label, value: p.id }));
      const field: Field = { key: randomUUID(), label: "Saved provider — verify name and address against the receipt", kind: "practitioner", type: "provider", options,
        suggested: blueCrossSuggestion("practitioner", s.dossier, options) };
      s.fields.set(field.key, { locator: providers.first(), providers, field, signature: JSON.stringify(providerMetadata), initialValue: "" });
    }
  }
  if (s.dossier.insurer === "desjardins" && !atReview) {
    const definition = desjardinsRadioField(new URL(s.page.url()).pathname);
    if (definition) {
      const choices = s.page.locator(`main input[type="radio"][name="${definition.name}"]`).filter({ visible: true });
      const metadata = await choices.evaluateAll((els: HTMLInputElement[]) => els.map(el => ({ id: el.id, name: el.name, label: Array.from(el.labels || []).map(l => l.textContent?.trim()).filter(Boolean).join(" "), checked: el.checked })));
      if (metadata.length && !metadata.some(o => o.checked)) {
        const options = metadata.filter(o => o.id && o.label).map(o => ({ value: o.id, label: o.label }));
        const field: Field = { key: randomUUID(), label: definition.label, kind: definition.kind, type: "radio", options, suggested: null };
        s.fields.set(field.key, { locator: choices.first(), providers: choices, field, signature: JSON.stringify(metadata), initialValue: "" });
      }
    }
  }
  const locators = await s.page.locator("input:not([type=hidden]):not([type=password]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]), select, textarea").all();
  const fields: Field[] = [];
  for (const locator of locators) {
    if (!await locator.isVisible() || !await locator.isEnabled()) continue;
    const metadata = await locator.evaluate((el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) => ({
      label: el.getAttribute("aria-label") || Array.from(el.labels || []).map(l => {
        const copy = l.cloneNode(true) as HTMLElement;
        copy.querySelectorAll("input,select,textarea").forEach(control => control.remove());
        return copy.textContent?.trim();
      }).filter(Boolean).join(" "),
      type: el instanceof HTMLSelectElement ? "select" : el instanceof HTMLTextAreaElement ? "textarea" : el.type,
      options: el instanceof HTMLSelectElement ? Array.from(el.options).filter(o => !o.disabled).map(o => ({ value: o.value, label: o.text.trim() })) : [],
      value: el.value, required: el.hasAttribute("required") || el.getAttribute("aria-required") === "true", signature: JSON.stringify([el.tagName, el.id, el.getAttribute("name"), el.getAttribute("type"), Array.from(el.labels || []).map(l => l.textContent?.trim()), el.getAttribute("aria-label")])
    }));
    // Never overwrite a value the operator already entered, except placeholder selects.
    if (metadata.type !== "select" && metadata.type !== "file" && metadata.value) continue;
    if (metadata.type === "select" && metadata.value && !/^(?:select|please select|choose|choisir|sélectionnez)/i.test(metadata.options.find(o => o.value === metadata.value)?.label || "")) continue;
    if (atReview && metadata.type !== "file") continue;
    if ([...s.fields.values()].some(f => f.locator === locator)) continue;
    const id = await locator.getAttribute("id") || "";
    // locator.all() captures positions. Dependent form fields can move those
    // positions after a postback; retain the observed unique control identity.
    const byId = id ? s.page.locator(`[id=${JSON.stringify(id)}]`) : undefined;
    const stableLocator = byId && await byId.count() === 1 ? byId : locator;
    if (s.dossier.insurer === "blue-cross" && blueCrossComboFields.some(f => id.endsWith(`_${f.suffix}`))) continue;
    const blueCross = s.dossier.insurer === "blue-cross" && /\/Claims\/eClaim\.aspx$/i.test(new URL(s.page.url()).pathname) ? blueCrossTextField(id) : null;
    const kind = blueCross?.kind || fieldKind(metadata.label);
    const source = kind ? s.dossier.fields[kind as keyof typeof s.dossier.fields] : null;
    let suggested = source == null ? null : String(source);
    if (blueCross) suggested = blueCrossSuggestion(blueCross.kind, s.dossier);
    if (metadata.type === "select") {
      const exact = metadata.options.filter(o => o.value && o.label.toLowerCase() === suggested?.toLowerCase());
      suggested = kind === "service" ? exactServiceOption(s.dossier.fields.service, metadata.options) : exact.length === 1 ? exact[0].value : null;
    }
    // Date text masks vary by portal. Only native date fields get an automatic date.
    if (kind === "serviceDate" && metadata.type !== "date" && !blueCross) suggested = null;
    if (metadata.type === "file") suggested = null;
    const field: Field = { key: randomUUID(), label: blueCross?.label || metadata.label || (metadata.type === "file" ? "Supporting document" : "Unlabelled field — fill in the portal"), type: metadata.type, options: metadata.options, kind, suggested };
    if (metadata.type === "file") field.autoAttachment = /invoice|receipt|supporting document|facture|reçu|pièce justificative/i.test(metadata.label)
      && !/explanation|benefit statement|other insurer|décompte|autre assureur|coordination/i.test(metadata.label);
    if (metadata.type === "file" && receiptFile && await receiptFile.getAttribute("id") === id) {
      field.label = "Original receipt — Blue Cross document uploader";
      field.autoAttachment = await blueCrossReceiptMatches(s.page, s.dossier)
        && !await blueCrossReceiptAlreadyListed(s.page, s.dossier.attachments[0].name);
    }
    if (s.dossier.insurer === "blue-cross" && !metadata.required && metadata.type === "text"
      && /^Amount paid by public or provincial plan\s*\$?$/i.test(metadata.label.trim())) field.optional = true;
    s.fields.set(field.key, { locator: stableLocator, field, signature: metadata.signature, initialValue: metadata.value }); fields.push(field);
  }
  if (s.dossier.insurer === "blue-cross" && !atReview) {
    const receipt = await blueCrossReceiptCheckbox(s.page);
    if (receipt && (!receipt.checked || !s.approved?.entries.some(e => e.filled && e.target.field.kind === "supportingReceipt" && e.target.signature === receipt.signature))) {
      const field: Field = { key: randomUUID(), label: "Detailed payment receipt available", type: "checkbox", kind: "supportingReceipt", options: [], suggested: null };
      s.fields.set(field.key, { locator: receipt.locator, field, signature: receipt.signature, initialValue: String(receipt.checked) });
    }
    for (const locator of await s.page.locator('input[type="checkbox"]').all()) {
      if (!await locator.isVisible() || !await locator.isEnabled() || await locator.isChecked()) continue;
      if (receipt && await locator.evaluate((el, known) => el === known, await receipt.locator.elementHandle())) continue;
      const label = await locator.evaluate((el: HTMLInputElement) => el.getAttribute("aria-label") || Array.from(el.labels || []).map(l => l.innerText).join(" "));
      const field: Field = { key: randomUUID(), label: label || "Portal confirmation", type: "checkbox", kind: null, options: [], suggested: null };
      s.fields.set(field.key, { locator, field, signature: "manual-checkbox", initialValue: "false" });
    }
  }
  const allFields = [...s.fields.values()].map(f => f.field);
  let confirmedPractitioner: Awaited<ReturnType<typeof confirmedInvoicePractitioner>> | undefined;
  try {
    if (s.dossier.insurer === "blue-cross") confirmedPractitioner = await confirmedInvoicePractitioner(s.dossier);
    for (const field of allFields.filter(f => f.kind === "practitioner" && f.type === "provider")) {
      const matching = !s.dossier.fields.practitioner ? field.options.filter(o => o.label.split(/\s+-\s+/)[0].trim() === confirmedPractitioner?.value) : [];
      if (matching.length === 1) { field.suggested = matching[0].value; field.suggestionSource = "confirmed-choice"; }
    }
  } catch { /* Corrupt practitioner answers never supply a suggestion. */ }
  let confirmedIllness: Awaited<ReturnType<typeof confirmedInvoiceIllness>> | undefined;
  let answerWarning: string | undefined;
  try {
    confirmedIllness = await confirmedInvoiceIllness(s.dossier);
    const illnessFields = allFields.filter(f => f.kind === "natureOfIllness" && ["text", "textarea"].includes(f.type));
    for (const field of illnessFields.length === 1 ? illnessFields : []) {
      if (confirmedIllness.value) {
        field.suggested = confirmedIllness.value; field.suggestionSource = "confirmed-answer";
        field.suggestionReason = confirmedIllness.source === "default"
          ? "Your explicitly confirmed default for all invoices. Review it for this claim."
          : "Your explicit answer for this exact invoice and insurer. It is not an inferred diagnosis.";
      }
    }
  } catch { answerWarning = "Saved invoice answers could not be read. Enter the answer yourself; nothing was inferred."; }
  let choiceWarning: string | null = null;
  for (const field of allFields.filter(f => ["select", "combo"].includes(f.type))) {
    try {
      const remembered = await savedServiceChoice(s.dossier, field.kind, field.options);
      if (remembered != null) { field.suggested = remembered; field.suggestionSource = "confirmed-choice"; }
    } catch { choiceWarning = "Saved service choices could not be read. Review the current options; nothing was inferred from them."; }
  }
  for (const field of allFields.filter(f => ["service", "benefit"].includes(f.kind || ""))) {
    field.suggestionReason = field.suggestionSource === "confirmed-choice"
      ? "Your confirmed choice for this insurer, clinic and exact invoice service. Review it for this claim."
      : field.suggested != null ? "Invoice service supports a unique option currently shown by the insurer. Review this suggestion."
        : "No unique option is supported by the invoice evidence. Choose from the current portal options or request a Codex suggestion.";
    if (field.suggested != null && !field.suggestionSource) field.suggestionSource = "invoice";
  }
  const portalStage = !atReview && s.dossier.insurer === "blue-cross" && !allFields.length && /\bYour Expenses\b/.test(body)
    && await s.page.getByRole("heading", { name: "Your Expenses", exact: true }).filter({ visible: true }).count() === 1 ? "expense-summary" as const : undefined;
  return { status: atReview ? "review" : allFields.length ? "fields" : "navigate", portalStage, fields: allFields, revision: s.revision, submitAllowed: false, confirmedIllness, confirmedPractitioner, answerWarning,
    serviceChoices: { available: true, scopeComplete: serviceChoiceScope(s.dossier) != null, warning: choiceWarning } };
}
export async function fillClaimStep(id: unknown, revision: unknown, values: unknown, attachment: unknown,
  loadAttachment: (id: string, attachmentId: string) => Promise<{ bytes: Buffer; name: string }>, rememberChoices: unknown = false) {
  const s = current(id);
  if (s.busy || revision !== s.revision || !s.fields.size || s.page.url() !== s.inspectedUrl || !allowed(s.page.url(), s.dossier.insurer)) throw new Error("The portal step changed. Inspect it again before filling.");
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("Provide reviewed field values.");
  s.busy = true;
  try {
    const entries = Object.entries(values);
    for (const [key, value] of entries) {
      const target = s.fields.get(key);
      if (!target || !target.field.kind || typeof value !== "string" || value.length > 500 || target.field.type === "file") throw new Error("Invalid reviewed field.");
      if (target.field.type === "checkbox" && (target.field.kind !== "supportingReceipt" || value !== "true")) throw new Error("Unsupported confirmation.");
      if (["select", "combo", "provider", "radio"].includes(target.field.type) && value && !target.field.options.some(o => o.value === value)) throw new Error("The selected portal option is not available.");
    }
    let filled = 0;
    const previous = s.approved?.url === s.inspectedUrl ? s.approved : undefined;
    const approvedEntries = entries.filter(([,value]) => !!value).map(([key,value]) => {
      const target = s.fields.get(key)!;
      return { target, filled: false, approved: { key, label: target.field.label, kind: target.field.kind, type: target.field.type, value: value as string,
        optionLabel: target.field.options.find(o => o.value === value)?.label } };
    });
    // Preserve the approved answers from earlier postbacks in this claim only.
    // Re-read every prior answer; a later fill must not erase an earlier mismatch.
    s.approved = { revision: randomUUID(), url: s.inspectedUrl,
      entries: [...(previous?.entries || []).filter(old => !approvedEntries.some(next => next.target.signature === old.target.signature)), ...approvedEntries],
      ...(previous?.attachment ? { attachment: previous.attachment } : {}) };
    if (attachment != null) {
      const selected = s.dossier.attachments.find(a => `${a.documentId}:${a.attachmentId}` === attachment);
      if (!selected || [...s.fields.values()].filter(t => t.field.type === "file").length !== 1) throw new Error("Select the correct supporting-document field in the portal.");
      s.approved.attachment = { name: selected.name, selected: false };
    }
    let choicesSaved = 0, choiceSaveWarning = false;
    const markFilled = (target: Target) => { const entry = s.approved!.entries.find(e => e.target === target); if (entry) entry.filled = true; };
    const remember = async (target: Target, value: string, verified: boolean) => {
      if (!verified) return;
      if (rememberChoices !== true || !["select", "combo"].includes(target.field.type)) return;
      try { if (await rememberServiceChoice(s.dossier, target.field.kind, target.field.options, value)) choicesSaved++; }
      catch { choiceSaveWarning = true; }
    };
    const finish = async (message: string) => {
      const verification = await verifySnapshot(s);
      for (const entry of s.approved!.entries) {
        const checked = verification.fields.find(f => f.key === entry.approved.key);
        if (entry.filled) await remember(entry.target, entry.approved.value, checked?.status === "match");
      }
      return { status: "filled", filled, choicesSaved, choiceSaveWarning, verification,
        message: message + (verification.readyForManualNext ? " All approved values were read back and match. Complete any manual fields before choosing Next yourself." : " Do not choose Next yet. Correct or re-read every unverified answer and upload.")
          + (choiceSaveWarning ? " A service preference could not be saved; do not repeat filling just to save it." : choicesSaved ? " Your verified, confirmed service choice was saved privately for this insurer, clinic and invoice service." : ""), submitAllowed: false };
    };
    // Fill stable text first; each dropdown can replace the form via postback.
    // Stop after one dropdown selection instead of touching stale controls.
    const order = (key: string) => ["combo", "select"].includes(s.fields.get(key)!.field.type) ? 2 : ["provider", "radio"].includes(s.fields.get(key)!.field.type) ? 1 : 0;
    const ordered = entries.slice().sort(([a], [b]) => order(a) - order(b));
    for (const [key, value] of ordered) {
      if (!value) continue;
      const target = s.fields.get(key)!;
      if (target.field.type === "checkbox") {
        // The same PDF checks also apply to manually supplied API values.
        const receipt = s.dossier.attachments.length === 1 ? s.dossier.attachments[0] : undefined;
        if (!receipt || !await verifyDetailedReceipt((await loadAttachment(receipt.documentId, receipt.attachmentId)).bytes, s.dossier))
          throw new Error("The original PDF does not establish every item in the receipt checklist. Review it in the portal.");
        const observed = await blueCrossReceiptCheckbox(s.page);
        if (!observed || observed.checked !== (target.initialValue === "true") || observed.signature !== target.signature || s.page.url() !== s.inspectedUrl)
          throw new Error("The receipt checklist changed. Read the form again.");
        if (!observed.checked) { await observed.locator.check(); filled++; }
        markFilled(target);
        return await finish(observed.checked ? "The existing detailed-receipt confirmation was verified against the original PDF." : "The detailed-receipt checklist was confirmed against the original PDF.");
      }
      if (target.providers) {
        const now = await target.providers.evaluateAll((els: HTMLInputElement[]) => els.map(el => ({ id: el.id, name: el.name, label: Array.from(el.labels || []).map(l => l.textContent?.trim()).filter(Boolean).join(" "), checked: el.checked })));
        if (JSON.stringify(now) !== target.signature || s.page.url() !== s.inspectedUrl || !allowed(s.page.url(), s.dossier.insurer)) throw new Error("Provider choices changed. Read the form again.");
        const choice = s.page.locator(`[id="${value}"]`);
        if (!await choice.isVisible() || !await choice.isEnabled()) throw new Error("The selected provider is unavailable.");
        await choice.check(); filled++; markFilled(target);
        return await finish("The selected choice may update the form. Read its fields again.");
      }
      // Refuse to follow postbacks/navigation with stale form locators.
      if (!await target.locator.isVisible() || !await target.locator.isEnabled()) throw new Error("Portal fields changed. Inspect the next step again.");
      const current = await target.locator.evaluate((el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) => ({ value: el.value,
        options: el instanceof HTMLSelectElement ? Array.from(el.options).filter(o => !o.disabled).map(o => ({ value: o.value, label: o.text.trim() })) : [],
        signature: JSON.stringify([el.tagName, el.id, el.getAttribute("name"), el.getAttribute("type"), Array.from(el.labels || []).map(l => l.textContent?.trim()), el.getAttribute("aria-label")]) }));
      if (current.signature !== target.signature || current.value !== target.initialValue || s.page.url() !== s.inspectedUrl) throw new Error("The form or an entered value changed. Inspect again before filling.");
      if (target.field.type === "select" && JSON.stringify(current.options) !== JSON.stringify(target.field.options)) throw new Error("The portal choices changed. Read the form again.");
      if (target.field.type === "combo") {
        await target.locator.click();
        const option = target.dropdown!.getByRole("listitem").filter({ hasText: new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) });
        if (await option.count() !== 1 || !await option.isVisible()) throw new Error("The portal options changed. Read the form again.");
        await option.click(); filled++; markFilled(target);
        return await finish("The selected option updates the Blue Cross form. Read its fields again to prepare the remaining details.");
      } else if (target.field.type === "select") await target.locator.selectOption(value as string);
      else { await target.locator.fill(value as string); if (target.field.kind === "serviceDate") await target.locator.press("Tab"); }
      filled++;
      markFilled(target);
      if (target.field.type === "select") return await finish("The selected option may update the form. Read its fields again.");
    }
    if (attachment != null) {
      if (typeof attachment !== "string") throw new Error("Choose an invoice PDF.");
      const selected = s.dossier.attachments.find(a => `${a.documentId}:${a.attachmentId}` === attachment);
      const targets = [...s.fields.values()].filter(f => f.field.type === "file");
      if (!selected || targets.length !== 1) throw new Error("Select the correct supporting-document field in the portal.");
      const file = await loadAttachment(selected.documentId, selected.attachmentId);
      s.approved.attachment = { name: file.name, selected: false };
      const hash = createHash("sha256").update(file.bytes).digest("hex");
      const retryHash = s.authorizedRetryHash;
      s.authorizedRetryHash = undefined;
      if (retryHash && retryHash !== hash) throw new Error("The original receipt bytes changed before recovery. No file was sent.");
      const explicitRetry = retryHash === hash;
      if (s.attemptedAttachments.has(hash) && !explicitRetry) throw new Error("This PDF upload was already attempted. Check its status in Blue Cross; FamilyHub will not repeat an uncertain permanent upload.");
      const target = targets[0];
      const current = await target.locator.evaluate((el: HTMLInputElement) => ({ value: el.value,
        signature: JSON.stringify([el.tagName, el.id, el.getAttribute("name"), el.getAttribute("type"), Array.from(el.labels || []).map(l => l.textContent?.trim()), el.getAttribute("aria-label")]) }));
      if (s.page.url() !== s.inspectedUrl || current.signature !== target.signature || current.value !== target.initialValue
        || !await target.locator.isVisible() || !await target.locator.isEnabled()) throw new Error("The attachment field changed. Inspect again before attaching.");
      if (s.page.url() !== s.inspectedUrl || !allowed(s.page.url(), s.dossier.insurer)) throw new Error("The portal changed before attaching. Read the form again.");
      s.attemptedAttachments.add(hash);
      try { if (explicitRetry) await reserveClaimUploadRetry(s.dossier, hash, { confirmed: true, scope: s.id }); else await reserveClaimUpload(s.dossier, hash); }
      catch (error) { s.approved.attachment.blocked = true; throw error; }
      await targets[0].locator.setInputFiles({ name: file.name, mimeType: "application/pdf", buffer: file.bytes });
      s.approved.attachment.selected = true;
      if (s.dossier.insurer === "blue-cross" && (await s.page.locator("body").innerText()).includes("Claim Documentation Required") && await blueCrossReceiptFile(s.page))
        await s.page.locator('[id$="_ucSubmitClaim_radAsyncUpload"] .ruUploadSuccess, [id$="_ucSubmitClaim_radAsyncUpload"] .ruUploadFailure')
          .filter({ hasText: file.name }).first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
      filled++;
    }
    return await finish(attachment != null ? "The PDF was placed in the portal's upload field; file selection alone is not proof of upload." : "Review the actual values below. Next after claim details and Submit remain manual.");
  } finally { s.fields.clear(); s.revision = ""; s.busy = false; }
}
/** One explicit recovery on this still-empty, source-matched preparation. */
export async function retryCurrentClaimReceipt(id: unknown, revision: unknown, receiptName: unknown, confirmed: unknown,
  loadAttachment: (id: string, attachmentId: string) => Promise<{ bytes: Buffer; name: string }>, assertFresh: () => void = () => {}) {
  const s = current(id), prior = s.approved;
  if (confirmed !== true || s.busy || s.receiptRetryUsed || !prior?.attachment?.blocked || prior.attachment.selected
    || revision !== prior.revision || receiptName !== prior.attachment.name || s.dossier.attachments.length !== 1)
    throw new Error("Review the earlier receipt attempt and explicitly authorize this empty preparation before recovery.");
  assertFresh();
  const file = await blueCrossReceiptFile(s.page);
  if (!file || !await blueCrossReceiptMatches(s.page, s.dossier) || await file.inputValue()
    || await blueCrossReceiptAlreadyListed(s.page, prior.attachment.name)) throw new Error("The upload page changed or already contains a receipt. Do not resend it.");
  const original = s.dossier.attachments[0], source = await loadAttachment(original.documentId, original.attachmentId);
  if (source.name !== receiptName || s.receiptRetryUsed) throw new Error("The receipt or recovery state changed.");
  s.receiptRetryUsed = true;
  s.authorizedRetryHash = createHash("sha256").update(source.bytes).digest("hex");
  try {
    const step = await inspectClaimStep(id);
    if (step.fields.filter(f => f.type === "file").length !== 1) throw new Error("The receipt field changed. Recovery was not sent.");
    await fillClaimStep(id, step.revision, {}, original.documentId + ":" + original.attachmentId, loadAttachment);
    return await prepareCurrentClaimStep(id, loadAttachment, assertFresh);
  } finally { s.authorizedRetryHash = undefined; }
}

export function claimSessionExpense(id: unknown) { return current(id).dossier; }
async function verifySnapshot(s: Session) {
  if (!s.approved) throw new Error("There are no filled, approved answers to verify.");
  const validPage = s.page.url() === s.approved.url && allowed(s.page.url(), s.dossier.insurer);
  const fields = [];
  for (const entry of s.approved.entries) {
    let observed: ObservedField | null = null;
    try {
      if (validPage && await entry.target.locator.isVisible()) {
        if (entry.target.field.type === "checkbox") {
          const receipt = await blueCrossReceiptCheckbox(s.page);
          if (receipt) observed = { value: String(receipt.checked), signatureMatches: receipt.signature === entry.target.signature };
        } else if (entry.target.providers) {
          const now = await entry.target.providers.evaluateAll((els: HTMLInputElement[]) => els.map(el => ({ id: el.id, name: el.name, label: Array.from(el.labels || []).map(l => l.textContent?.trim()).filter(Boolean).join(" "), checked: el.checked })));
          const structure = (values: typeof now) => values.map(({checked: _checked, ...rest}) => rest);
          const selected = now.filter(value => value.checked);
          observed = { value: selected.length === 1 ? selected[0].id : "", selectedLabel: selected[0]?.label,
            signatureMatches: JSON.stringify(structure(now)) === JSON.stringify(structure(JSON.parse(entry.target.signature))) };
        } else {
          const metadata = await entry.target.locator.evaluate((el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, combo: boolean) => ({ value: el.value,
            selectedLabel: el instanceof HTMLSelectElement ? el.selectedOptions[0]?.text.trim() : undefined,
            signature: JSON.stringify([el.tagName, el.id, el.getAttribute("name"), el.getAttribute("type"), combo ? [] : Array.from(el.labels || []).map(l => l.textContent?.trim()), el.getAttribute("aria-label")]) }), entry.target.field.type === "combo");
          observed = { value: metadata.value, selectedLabel: metadata.selectedLabel, signatureMatches: metadata.signature === entry.target.signature };
        }
      }
    } catch { /* A missing/stale/unreadable field never gets a green check. */ }
    fields.push(checkedField(entry.approved, observed, entry.filled));
  }
  let attachment: { name: string; status: "verified" | "unverified" | "failed"; selected?: boolean; blocked?: boolean } | null = null;
  if (s.approved.attachment) {
    let status: "verified" | "unverified" | "failed" = "unverified";
    try {
      if (validPage && s.approved.attachment.selected) {
        const visibleText = async (role: string) => s.page.locator(`[role="${role}"]`).evaluateAll(els => els.filter(el => el.getClientRects().length).map(el => (el.textContent || "").trim()));
        status = uploadEvidence(s.approved.attachment.name, await visibleText("status"), await visibleText("alert"));
        if (s.dossier.insurer === "blue-cross") {
          const receiptStatus = await blueCrossReceiptUploadEvidence(s.page, s.approved.attachment.name);
          if (status !== "failed" && receiptStatus !== "unverified") status = receiptStatus;
        }
      }
    } catch { /* Selecting a file is not a successful-upload indicator. */ }
    attachment = { name: s.approved.attachment.name, status, selected: s.approved.attachment.selected, blocked: s.approved.attachment.blocked };
  }
  const body = validPage ? await s.page.locator("body").innerText() : "";
  const receiptUploadAvailable = s.dossier.insurer === "blue-cross" && !attachment && !s.attemptedAttachments.size
    && !/your claim has been (?:processed|submitted)/i.test(body)
    && /Additional Information Required|Claim Documentation Required/.test(body)
    && await blueCrossReceiptUploadAvailable(s.page, s.dossier);
  return { revision: s.approved.revision, fields, attachment, receiptUploadAvailable,
    readyForManualNext: (fields.length > 0 || !!attachment) && fields.every(f => f.status === "match") && (!attachment || attachment.status === "verified"),
    scope: "Read-back against the values prepared from invoice evidence or your answers. This does not verify eligibility, coverage, current claim history or submission." };
}
export async function verifyClaimStep(id: unknown) {
  const s = current(id);
  if (s.busy) throw new Error("Wait for the current preparation action to finish.");
  s.busy = true;
  try { return await verifySnapshot(s); } finally { s.busy = false; }
}
export async function suggestClaimServiceChoices(id: unknown, revision: unknown, runner: ServiceRunner = codexServiceRunner) {
  const s = current(id);
  if (s.busy || revision !== s.revision || s.page.url() !== s.inspectedUrl || !allowed(s.page.url(), s.dossier.insurer)) throw new Error("The portal step changed. Inspect it again.");
  const service = s.dossier.fields.service;
  const fields = [...s.fields.values()].map(t => t.field).filter(f => ["service", "benefit"].includes(f.kind || "") && f.suggested == null && ["select", "combo"].includes(f.type) && f.options.length <= 100);
  if (!service || !fields.length) throw new Error("No unconfirmed service options are available to suggest.");
  s.busy = true;
  try {
    // Only service evidence and service-option labels reach the existing private
    // ephemeral Codex path. No identity, amounts, insurer answers or documents.
    const proposals = validatedServiceProposals(await runner(service, fields.map(({key, kind, options}) => ({key, kind, options}))), service, fields);
    if (s.page.url() !== s.inspectedUrl || revision !== s.revision) throw new Error("The portal changed during analysis. Inspect it again.");
    for (const p of proposals) { const field = s.fields.get(p.key)!.field; field.suggested = p.value; field.suggestionReason = p.value != null ? `Unconfirmed Codex suggestion: ${p.reason}` : p.reason; if (p.value != null) field.suggestionSource = "codex"; }
    return { status: "fields", revision: s.revision, fields: [...s.fields.values()].map(t => t.field), submitAllowed: false,
      serviceChoices: { available: true, scopeComplete: serviceChoiceScope(s.dossier) != null, warning: null } };
  } finally { s.busy = false; }
}
export async function forgetClaimServiceChoices(id: unknown) {
  const s = current(id);
  if (s.busy) throw new Error("Wait for the current preparation action to finish.");
  await forgetServiceChoices(s.dossier);
  return inspectClaimStep(id);
}
export async function closeClaimBrowser(id: unknown) {
  const s = current(id);
  if (s.busy) throw new Error("Wait for the current preparation action to finish.");
  session = undefined;
  await s.browser.close();
  await s.release?.();
  return { status: "closed", submitAllowed: false };
}

/** Bounded preparation with observed guarded intermediate Next; never consent or Submit. */
export async function prepareCurrentClaimStep(id: unknown,
  loadAttachment: (id: string, attachmentId: string) => Promise<{ bytes: Buffer; name: string }>,
  assertFresh: () => void = () => {}) {
  const s = current(id);
  let step: Awaited<ReturnType<typeof inspectClaimStep>> = { status: "inspect-required", fields: [], revision: "", submitAllowed: false };
  let verification: Awaited<ReturnType<typeof verifySnapshot>> | undefined;
  let warning: string | undefined;
  try {
    step = await inspectClaimStep(id);
    if (step.status === "fields") s.detailsReadBackVerified = false;
    // A restored SPA can briefly look authenticated before the server rejects
    // stale cookies. Recheck once, using the unchanged durable login gate.
    if (s.autonomous && s.dossier.insurer === "blue-cross" && step.status === "login-required" && !s.authReason && !s.loginRefreshAttempted
      && !s.approved && !s.claimKindAttempted && !s.claimCauseAttempted && !s.detailsNextAttempted) {
      s.loginRefreshAttempted = true;
      s.authReason = await (s.authenticate || loginForClaim)(s.page, s.dossier.insurer);
      if (!s.authReason && isBlueCrossMemberPage(s.page.url())
        && (await authenticatedClaimPages(s.page, s.dossier.insurer)).length === 1) s.claimEntryAttempted = false;
      step = await inspectClaimStep(id);
    }
    verification = s.approved ? await verifySnapshot(s) : undefined;
    for (let pass = 0; pass < 16 && ["fields", "review", "navigate"].includes(step.status); pass++) {
      assertFresh();
      if (step.status === "navigate" && (s.detailsNextVerified || s.detailsReadBackVerified) && !s.summaryNextAttempted) {
        const illness = s.approved?.entries.find(e => e.target.field.kind === "natureOfIllness" && e.filled)?.approved.value;
        const practitioner = s.approved?.entries.find(e => e.target.field.kind === "practitioner" && e.filled)?.approved.optionLabel;
        const advanced = await advanceBlueCrossExpenses(s.page, s.dossier, illness, () => { s.summaryNextAttempted = true; }, practitioner);
        if (!advanced) { warning = "The current expense summary could not be matched to this invoice and the verified prepared answers. Automatic continuation stopped."; break; }
        step = await inspectClaimStep(id); verification = s.approved ? await verifySnapshot(s) : undefined; continue;
      }
      // Never automatically retry a field whose previous write could not be verified.
      if (step.status !== "review" && verification?.fields.some(f => f.status !== "match")) break;
      const candidates = step.status === "review" ? {} as Record<string, string> : automaticClaimValues(step.fields, s.dossier);
      const receiptCheckboxes = step.fields.filter(f => f.kind === "supportingReceipt");
      if (receiptCheckboxes.length === 1) {
        const receipt = s.dossier.attachments.length === 1 ? s.dossier.attachments[0] : undefined;
        let verified = false;
        try { verified = !!receipt && await verifyDetailedReceipt((await loadAttachment(receipt.documentId, receipt.attachmentId)).bytes, s.dossier); }
        catch { /* Missing/unreadable source leaves the confirmation pending. */ }
        if (verified) candidates[receiptCheckboxes[0].key] = "true";
        else warning = "The detailed-receipt checklist needs review: the PDF could not establish every required detail.";
      }
      const texts = step.fields.filter(f => f.key in candidates && !["select", "combo", "provider", "radio"].includes(f.type));
      const chosen = texts.length ? texts : step.fields.filter(f => f.key in candidates).slice(0, 1);
      const values = Object.fromEntries(chosen.map(f => [f.key, candidates[f.key]]));
      const receipt = s.dossier.attachments.length === 1 ? s.dossier.attachments[0] : undefined;
      const attachment = !chosen.length && receipt && !s.attemptedAttachments.size && !s.approved?.attachment
        && step.fields.filter(f => f.type === "file").length === 1 && step.fields.some(f => f.type === "file" && f.autoAttachment)
        && (step.status !== "review" || s.dossier.insurer === "blue-cross" && await blueCrossReceiptMatches(s.page, s.dossier) && !!await blueCrossReceiptFile(s.page))
        ? `${receipt.documentId}:${receipt.attachmentId}` : null;
      if (!Object.keys(values).length && !attachment) {
        const required = ["patient", "benefit", "service", "serviceDate", "originalAmount", "natureOfIllness", "otherInsurance", "otherInsurancePaid", "practitioner", "supportingReceipt"];
        const prepared = new Set(s.approved?.entries.filter(e => e.filled).map(e => e.target.field.kind));
        const ready = step.status === "fields" && !!verification?.readyForManualNext && !step.fields.some(f => !f.optional)
          && required.every(kind => prepared.has(kind)) && s.dossier.attachments.length === 1 && !s.dossier.blocked;
        if (ready && s.dossier.insurer === "blue-cross") s.detailsReadBackVerified = true;
        if (s.dossier.insurer === "blue-cross" && !s.detailsNextAttempted
          && await advanceBlueCrossDetails(s.page, ready, () => { s.detailsNextAttempted = true; })) {
          s.detailsNextVerified = true; step = await inspectClaimStep(id); verification = s.approved ? await verifySnapshot(s) : undefined; continue;
        }
        break;
      }
      const before = step.fields.map(f => [f.label, f.type, f.suggested]);
      await fillClaimStep(id, step.revision, values, attachment, loadAttachment);
      await s.page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      step = await inspectClaimStep(id);
      verification = s.approved ? await verifySnapshot(s) : undefined;
      if (JSON.stringify(before) === JSON.stringify(step.fields.map(f => [f.label, f.type, f.suggested]))) break;
    }
  } catch {
    // A write may have happened. Return the session and read-back, never replay it.
    warning = s.approved?.attachment?.blocked ? "The receipt was not attached: an earlier upload attempt is already recorded, or its guard could not be saved. No automatic resend was made. Review the prior claim before authorizing one-time recovery to this empty preparation."
      : "Preparation stopped after the portal changed or a value could not be verified. Check the actual results before continuing; do not repeat an uncertain upload.";
    const knownUpload = s.approved?.attachment?.blocked && !!await blueCrossReceiptFile(s.page).catch(() => null);
    step = { status: knownUpload ? "review" : "inspect-required", fields: [], revision: "", submitAllowed: false };
    verification = s.approved ? await verifySnapshot(s).catch(() => undefined) : undefined;
  }
  return { sessionId: s.id, step, verification, warning, submitAllowed: false };
}
