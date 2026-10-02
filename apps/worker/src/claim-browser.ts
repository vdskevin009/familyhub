import { createHash, randomUUID } from "node:crypto";
import { chromium, type Browser, type Page, type Locator } from "playwright";
import { join } from "node:path";
import { dataDirectory, loadPrivate } from "./private-store.js";
import type { ClaimPreparation } from "./claim-preparation.js";
import { exactServiceOption } from "./claim-preparation.js";
import { blueCrossComboFields, blueCrossSuggestion, blueCrossTextField } from "./bluecross-claim-form.js";
import { blueCrossSessionMarker } from "./bluecross-collector.js";

export type Field = { key: string; label: string; type: string; options: { value: string; label: string }[];
  suggested: string | null; kind: string | null };
type Session = { id: string; browser: Browser; page: Page; dossier: ClaimPreparation; createdAt: number;
  fields: Map<string, { locator: Locator; field: Field; signature: string; initialValue: string; dropdown?: Locator; providers?: Locator }>; attemptedAttachments: Set<string>; busy: boolean; revision: string; inspectedUrl: string };
let session: Session | undefined;
const allowed = (url: string, insurer: ClaimPreparation["insurer"]) => {
  const u = new URL(url);
  return u.protocol === "https:" && (insurer === "blue-cross" ? u.hostname === "service.pac.bluecross.ca"
    : u.hostname === "www.agea-gbim.dsf-dfs.com");
};
function current(id: unknown): Session {
  if (!session || id !== session.id || Date.now() - session.createdAt > 30 * 60_000 || session.page.isClosed()) throw new Error("Claim preparation expired. Open a new preparation session.");
  return session;
}
export async function openClaimBrowser(dossier: ClaimPreparation, historyReviewed: unknown, warningsReviewed: unknown = false,
  launch: () => Promise<Browser> = () => chromium.launch({ headless: false, channel: process.platform === "win32" ? dossier.insurer === "desjardins" ? "msedge" : "chrome" : undefined })) {
  if (dossier.blocked) throw new Error("Resolve the recorded or possible duplicate and source conflicts before preparing a claim.");
  if (historyReviewed !== true) throw new Error("Review the insurer's current history for this invoice before opening preparation.");
  if (dossier.reviewableWarnings.length && warningsReviewed !== true) throw new Error("Review the original PDF and confirm the shown gross expense and other-insurer payment before preparing this claim.");
  if (session && !session.page.isClosed()) {
    if (session.dossier.expenseId === dossier.expenseId && session.dossier.insurer === dossier.insurer
      && JSON.stringify(session.dossier.fields) === JSON.stringify(dossier.fields)) return { sessionId: session.id, status: "resumed", submitAllowed: false };
    throw new Error("A claim preparation window is already open. Close it before preparing another invoice.");
  }
  const browser = await launch();
  try {
    const context = await browser.newContext();
    // Reuse only previously authorized insurer cookies; no new credentials are saved.
    try {
      const auth = await loadPrivate<{ cookies?: import("playwright").Cookie[]; session?: { origin: string; value: string } }>(join(dataDirectory, dossier.insurer === "blue-cross" ? "bluecross" : "desjardins", "auth-state.dpapi"));
      const domains = dossier.insurer === "blue-cross" ? /(?:^|\.)pac\.bluecross\.ca$/i : /(?:^|\.)(?:dsf-dfs\.com|desjardins\.com)$/i;
      if (auth.cookies) await context.addCookies(auth.cookies.filter(c => domains.test(c.domain.replace(/^\./, ""))));
      if (dossier.insurer === "blue-cross") {
        const marker = blueCrossSessionMarker(auth.session?.origin || "", auth.session?.value);
        if (marker) await context.addInitScript(value => {
          if (location.origin === "https://service.pac.bluecross.ca" && !sessionStorage.getItem("pbcMemberProfileData")) sessionStorage.setItem("pbcMemberProfileData", value);
        }, marker);
      }
    } catch { /* A normal visible login remains available. */ }
    const page = await context.newPage();
    await page.goto(dossier.portalUrl, { waitUntil: "domcontentloaded" });
    session = { id: randomUUID(), browser, page, dossier, createdAt: Date.now(), fields: new Map(), attemptedAttachments: new Set(), busy: false, revision: "", inspectedUrl: "" };
    const timer = setTimeout(() => { if (session?.browser === browser) { session = undefined; void browser.close(); } }, 30 * 60_000);
    timer.unref();
    browser.on("disconnected", () => { clearTimeout(timer); if (session?.browser === browser) session = undefined; });
    return { sessionId: session.id, status: "opened", submitAllowed: false };
  } catch (error) { await browser.close(); throw error; }
}

function fieldKind(label: string): string | null {
  const name = label.toLowerCase().replace(/[\s:*]+/g, " ").trim();
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
  if (!allowed(s.page.url(), s.dossier.insurer) || await s.page.locator('input[type="password"]').isVisible().catch(() => false)) return { status: "login-required", fields: [], revision: "", submitAllowed: false };
  const body = (await s.page.locator("body").innerText()).slice(0, 30_000);
  const completed = /your claim has been (?:processed|submitted)|réclamation a été (?:transmise|soumise)/i.test(body);
  const atReview = completed || /review (?:your )?claim|claim summary|I confirm all the information above is correct and I have read and agree|vérifi(?:ez|cation).*réclamation|résumé de (?:la|votre) réclamation/i.test(body);
  s.fields.clear();
  s.revision = randomUUID();
  s.inspectedUrl = s.page.url();
  if (completed) return { status: "complete", fields: [], revision: s.revision, submitAllowed: false };
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
  const locators = await s.page.locator("input:not([type=hidden]):not([type=password]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]), select, textarea").all();
  const fields: Field[] = [];
  for (const locator of locators) {
    if (!await locator.isVisible() || !await locator.isEnabled()) continue;
    const metadata = await locator.evaluate((el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) => ({
      label: Array.from(el.labels || []).map(l => l.textContent?.trim()).filter(Boolean).join(" ") || el.getAttribute("aria-label") || "",
      type: el instanceof HTMLSelectElement ? "select" : el instanceof HTMLTextAreaElement ? "textarea" : el.type,
      options: el instanceof HTMLSelectElement ? Array.from(el.options).filter(o => !o.disabled).map(o => ({ value: o.value, label: o.text.trim() })) : [],
      value: el.value, signature: JSON.stringify([el.tagName, el.id, el.getAttribute("name"), el.getAttribute("type"), Array.from(el.labels || []).map(l => l.textContent?.trim()), el.getAttribute("aria-label")])
    }));
    // Never overwrite a value the operator already entered, except placeholder selects.
    if (metadata.type !== "select" && metadata.type !== "file" && metadata.value) continue;
    if (metadata.type === "select" && metadata.value && !/^(?:select|please select|choose|choisir|sélectionnez)/i.test(metadata.options.find(o => o.value === metadata.value)?.label || "")) continue;
    if (atReview && metadata.type !== "file") continue;
    if ([...s.fields.values()].some(f => f.locator === locator)) continue;
    const id = await locator.getAttribute("id") || "";
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
    s.fields.set(field.key, { locator, field, signature: metadata.signature, initialValue: metadata.value }); fields.push(field);
  }
  const allFields = [...s.fields.values()].map(f => f.field);
  return { status: atReview ? "review" : allFields.length ? "fields" : "navigate", fields: allFields, revision: s.revision, submitAllowed: false };
}
export async function fillClaimStep(id: unknown, revision: unknown, values: unknown, attachment: unknown,
  loadAttachment: (id: string, attachmentId: string) => Promise<{ bytes: Buffer; name: string }>) {
  const s = current(id);
  if (s.busy || revision !== s.revision || !s.fields.size || s.page.url() !== s.inspectedUrl || !allowed(s.page.url(), s.dossier.insurer)) throw new Error("The portal step changed. Inspect it again before filling.");
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("Provide reviewed field values.");
  s.busy = true;
  try {
    const entries = Object.entries(values);
    for (const [key, value] of entries) {
      const target = s.fields.get(key);
      if (!target || !target.field.kind || typeof value !== "string" || value.length > 500 || target.field.type === "file") throw new Error("Invalid reviewed field.");
      if (["select", "combo", "provider"].includes(target.field.type) && value && !target.field.options.some(o => o.value === value)) throw new Error("The selected portal option is not available.");
    }
    let filled = 0;
    // Fill stable text first; each dropdown can replace the form via postback.
    // Stop after one dropdown selection instead of touching stale controls.
    const order = (key: string) => s.fields.get(key)!.field.type === "combo" ? 2 : s.fields.get(key)!.field.type === "provider" ? 1 : 0;
    const ordered = entries.slice().sort(([a], [b]) => order(a) - order(b));
    for (const [key, value] of ordered) {
      if (!value) continue;
      const target = s.fields.get(key)!;
      if (target.providers) {
        const now = await target.providers.evaluateAll((els: HTMLInputElement[]) => els.map(el => ({ id: el.id, name: el.name, label: Array.from(el.labels || []).map(l => l.textContent?.trim()).filter(Boolean).join(" "), checked: el.checked })));
        if (JSON.stringify(now) !== target.signature || s.page.url() !== s.inspectedUrl || !allowed(s.page.url(), s.dossier.insurer)) throw new Error("Provider choices changed. Read the form again.");
        const choice = s.page.locator(`[id="${value}"]`);
        if (!await choice.isVisible() || !await choice.isEnabled()) throw new Error("The selected provider is unavailable.");
        await choice.check(); filled++;
        continue;
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
        await option.click(); filled++;
        return { status: "filled", filled, message: "The selected option updates the Blue Cross form. Read its fields again to prepare the remaining details.", submitAllowed: false };
      } else if (target.field.type === "select") await target.locator.selectOption(value as string);
      else { await target.locator.fill(value as string); if (target.field.kind === "serviceDate") await target.locator.press("Tab"); }
      filled++;
    }
    if (attachment != null) {
      if (typeof attachment !== "string") throw new Error("Choose an invoice PDF.");
      const selected = s.dossier.attachments.find(a => `${a.documentId}:${a.attachmentId}` === attachment);
      const targets = [...s.fields.values()].filter(f => f.field.type === "file");
      if (!selected || targets.length !== 1) throw new Error("Select the correct supporting-document field in the portal.");
      const file = await loadAttachment(selected.documentId, selected.attachmentId);
      const hash = createHash("sha256").update(file.bytes).digest("hex");
      if (s.attemptedAttachments.has(hash)) throw new Error("This PDF upload was already attempted. Check its status in Blue Cross; FamilyHub will not repeat an uncertain permanent upload.");
      const target = targets[0];
      const current = await target.locator.evaluate((el: HTMLInputElement) => ({ value: el.value,
        signature: JSON.stringify([el.tagName, el.id, el.getAttribute("name"), el.getAttribute("type"), Array.from(el.labels || []).map(l => l.textContent?.trim()), el.getAttribute("aria-label")]) }));
      if (s.page.url() !== s.inspectedUrl || current.signature !== target.signature || current.value !== target.initialValue
        || !await target.locator.isVisible() || !await target.locator.isEnabled()) throw new Error("The attachment field changed. Inspect again before attaching.");
      if (s.page.url() !== s.inspectedUrl || !allowed(s.page.url(), s.dossier.insurer)) throw new Error("The portal changed before attaching. Read the form again.");
      s.attemptedAttachments.add(hash);
      await targets[0].locator.setInputFiles({ name: file.name, mimeType: "application/pdf", buffer: file.bytes });
      filled++;
    }
    return { status: "filled", filled, message: attachment != null ? "The PDF was placed in the portal's upload field. Verify the successful-upload indicator in Blue Cross before consent or submission." : "Review these fields in the insurer window, then choose Next yourself. FamilyHub never clicks Next or Submit.", submitAllowed: false };
  } finally { s.fields.clear(); s.revision = ""; s.busy = false; }
}
export function claimSessionExpense(id: unknown) { return current(id).dossier; }
export async function closeClaimBrowser(id: unknown) {
  const s = current(id);
  if (s.busy) throw new Error("Wait for the current preparation action to finish.");
  session = undefined;
  await s.browser.close();
  return { status: "closed", submitAllowed: false };
}
