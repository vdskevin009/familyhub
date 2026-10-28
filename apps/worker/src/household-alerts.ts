import { latestDecisionProfile } from "./mortgage-decision.js";
import { normalizeProduct, receiptSourceType, type GroceryLibrary } from "./grocery-model.js";
import { normalizedSize, type GroceryPlan } from "./grocery-planning.js";
import type { Candidate, NotificationEvidence } from "./notification-model.js";

export type Monitoring = { category: "policy" | "renewal" | "gic" | "grocery" | "claim-deadline"; status: "watching" | "missing" | "unavailable"; detail: string };
export type ClaimDeadline = { expenseId: string; insurer: "desjardins" | "blue-cross"; date: string; sourceDocumentId: string; sourceDate: string; sourceNote: string; confirmedAt: string };
const validDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d\d-\d\d$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const day = 86_400_000;
const age = (today: string, date: string) => (Date.parse(today + "T12:00:00Z") - Date.parse(date + "T12:00:00Z")) / day;
const expiry = (date: string, days: number) => new Date(Date.parse(date + "T12:00:00Z") + days * day).toISOString();
const money = (n: number, currency: string) => new Intl.NumberFormat("fr-CA", { style: "currency", currency }).format(n);
/** Frequency means two distinct reviewed paid receipts in 90 days; it never establishes consumption or current stock. */
export function groceryDropAssessment(library: GroceryLibrary, plan: GroceryPlan, today: string): { candidates: Candidate[]; comparable: number } {
  const paid = library.records.filter(r => r.status === "saved" && !r.duplicateOf && r.reviewedAt && r.receipt.sourceType === "final-receipt" && receiptSourceType(r) === "final-receipt" && validDate(r.receipt.date) && age(today, r.receipt.date) >= 0 && age(today, r.receipt.date) <= 90);
  const candidates: Candidate[] = []; let comparable = 0;
  for (const price of plan.prices) {
    const peers = plan.prices.filter(p => p.kind === "public" && p.itemId === price.itemId && p.retailerId === price.retailerId && normalizeProduct(p.product) === normalizeProduct(price.product) && validDate(p.evidence.date) && p.evidence.date <= today);
    const newestDate = peers.map(p => p.evidence.date).sort().at(-1);
    if (price.evidence.date !== newestDate) continue;
    const latestPeers = peers.filter(p => p.evidence.date === newestDate);
    if (latestPeers.some(p => p.price !== price.price || p.size !== price.size || p.unit !== price.unit || p.currency !== price.currency || p.mode !== price.mode || p.locality !== price.locality) || latestPeers.map(p => p.id).sort()[0] !== price.id) continue;
    const retailer = plan.retailers.find(r => r.id === price.retailerId), item = plan.items.find(i => i.id === price.itemId);
    let url: URL; try { url = new URL(price.evidence.url); } catch { continue; }
    if (!item?.active || !price.approved || price.substitution || price.available !== "yes" || !price.matchNote?.trim() || !price.localityConfirmed || !retailer?.areaConfirmed || retailer.enabled === false || price.locality !== retailer.locality || !price.mode || price.mode === "unknown" || price.mode !== retailer.mode || retailer.membershipStatus === "proposal" || retailer.membershipStatus === "unknown" || url.protocol !== "https:" || url.username || url.password || !validDate(price.evidence.date) || age(today, price.evidence.date) < 0 || age(today, price.evidence.date) > 7 || !price.evidence.until || price.evidence.until < today || price.kind !== "public" || !plan.areaConfirmed) continue;
    if (/coupon|loyal|membre|estimé|format.*(?:non confirmé|à confirmer)/i.test(price.matchNote)) continue;
    const rows = paid.flatMap(record => record.receipt.currency === price.currency ? record.receipt.items.filter(line => !line.uncertain && !!line.evidence.trim() && normalizeProduct(line.product || line.name) === normalizeProduct(price.product) && line.amount !== null && line.amount > 0 && line.quantity !== null && line.quantity > 0 && line.size !== null && line.size > 0 && line.unit).map(line => ({ record, line })) : []);
    if (new Set(rows.map(r => r.record.id)).size < 2 || new Set(rows.map(r => r.record.receipt.date)).size < 2 || new Set(rows.map(r => r.record.sources.map(s => s.hash).sort().join(":"))).size < 2) continue;
    const latest = rows.sort((a, b) => b.record.receipt.date!.localeCompare(a.record.receipt.date!))[0], line = latest.line;
    if (age(today, latest.record.receipt.date!) > 30) continue;
    const bought = normalizedSize(line.quantity! * line.size!, line.unit!), pack = normalizedSize(price.size, price.unit);
    if (bought.unit !== pack.unit || !Number.isFinite(bought.size) || bought.size <= 0 || pack.size <= 0) continue;
    const packs = price.weighed ? bought.size / pack.size : Math.ceil(bought.size / pack.size - 1e-10), outlay = Math.round(packs * price.price * 100) / 100;
    const unitDrop = 1 - price.price / pack.size / (line.amount! / bought.size), difference = Math.round((line.amount! - outlay) * 100) / 100;
    comparable++;
    // Both a 15% comparable-unit drop and 2 currency units on the actual buyable packs are required.
    if (unitDrop < .15 || difference < 2 || !Number.isFinite(outlay)) continue;
    candidates.push({ source: "groceries", kind: "grocery", key: `grocery-drop:${price.id}:${price.evidence.date}:${price.price}`, groupKey: `grocery-drop:${price.itemId}:${price.retailerId}`, evidenceKey: `${price.id}:${price.evidence.date}:${price.price}:${latest.record.id}:${line.amount}`, actionable: true, pushEligible: true, priority: 1, expiresAt: expiry(price.evidence.until, 1), title: "Baisse de prix sur un produit acheté régulièrement", detail: `${price.product} : ${money(outlay, price.currency)} pour ${packs} format(s), contre ${money(line.amount!, price.currency)} sur le reçu du ${latest.record.receipt.date}. Écart produits observé : ${money(difference, price.currency)} ; hors frais, taxes et déplacement, sans gain net ni besoin de rachat présumé. Vérifiez le prix local et les conditions avant le prochain achat.`, target: { view: "groceries", tab: "tickets", recordId: latest.record.id }, sourceDate: price.evidence.date, links: [{ label: "Voir le prix marchand daté", url: price.evidence.url }] });
  }
  return { candidates, comparable };
}

export function householdCandidates(e: NotificationEvidence, today: string, now: Date): { candidates: Candidate[]; ready: Candidate["source"][]; monitoring: Monitoring[] } {
  const candidates: Candidate[] = [], ready: Candidate["source"][] = [], monitoring: Monitoring[] = [];
  const p = e.policy, announcement = p?.announcement;
  const policyReady = p?.status === "ready" && Date.parse(p.checkedAt) <= now.getTime() && now.getTime() - Date.parse(p.checkedAt) <= 2 * 3_600_000;
  monitoring.push({ category: "policy", status: policyReady ? "watching" : "unavailable", detail: policyReady ? `Source officielle vérifiée le ${p.checkedAt.slice(0, 10)} ; première lecture silencieuse, changements suivants dédupliqués.` : "Source officielle non vérifiée récemment ; aucune nouvelle décision supposée." });
  if (policyReady) {
    ready.push("policy");
    if (announcement && announcement.change !== 0 && age(today, announcement.date) >= 0 && age(today, announcement.date) <= 7) {
      const profile = e.mortgageState && latestDecisionProfile((e.mortgageState.profiles ?? []).filter(v => Date.parse(v.recordedAt) <= now.getTime()));
      const fixed = profile?.rateType === "fixed" && profile.maturityDate && profile.maturityDate >= today && profile.currentRate !== null;
      const impact = fixed ? `Votre prêt enregistré reste fixe à ${profile.currentRate} % jusqu’au ${profile.maturityDate} : aucun changement immédiat de son taux contractuel.` : profile?.rateType === "variable" ? "Votre prêt est enregistré comme variable : vérifiez le prime du prêteur, le rabais et le mode de paiement ; aucun nouveau taux ni paiement n’est déduit." : "Le type et l’échéance du prêt doivent être confirmés pour préciser l’impact personnel ; aucun taux contractuel n’est recalculé.";
      candidates.push({ source: "policy", kind: "policy", key: `boc-policy:${announcement.date}`, groupKey: `boc-policy:${announcement.date}`, evidenceKey: `${announcement.rate}:${announcement.previousRate}:${announcement.change}:${announcement.effectiveDate}`, actionable: true, pushEligible: true, priority: 2, expiresAt: expiry(announcement.date, 8), title: "La Banque du Canada a modifié son taux directeur", detail: `Annonce du ${announcement.date} : ${announcement.previousRate} % → ${announcement.rate} % (${announcement.change > 0 ? "+" : ""}${announcement.change} point), effet le ${announcement.effectiveDate}. ${impact} Prochaine action : revoir les options variables avec le prime et le rabais contractuels documentés. Les devis historiques restent inchangés ; un taux directeur n’est pas un taux préférentiel ni une offre personnelle.`, sourceDate: announcement.date, target: { view: "mortgage" }, links: [{ label: "Décision officielle et date d’effet", url: announcement.sourceUrl }] });
    }
  }
  const datedContracts = e.contracts?.filter(c => c.renewal || c.commitmentEnd || c.promotionEnd?.date || c.insuranceReference?.records.some(r => r.kind === "policy" && r.effectiveTo)).length ?? 0;
  monitoring.push({ category: "renewal", status: !e.contracts ? "unavailable" : datedContracts ? "watching" : "missing", detail: !e.contracts ? "Contrats indisponibles ; anciens rappels conservés." : `${datedContracts}/${e.contracts.length} contrat(s) avec une échéance renseignée. Seules les dates documentées et non contradictoires déclenchent un rappel à 30, 7 et 1 jour ; autres dates à compléter.` });
  monitoring.push({ category: "gic", status: !e.finance?.data ? "unavailable" : e.finance.data.gics.length ? "watching" : "missing", detail: !e.finance?.data ? "Sources de placement indisponibles." : `${e.finance.data.gics.length} GIC daté(s) ; sources du ${e.finance.data.collectedOn}. Vérifiez les instructions de renouvellement ; aucune nouvelle offre ni rendement supposé.` });
  const grocery = e.groceries && groceryDropAssessment(e.groceries.library, e.groceries.plan, today);
  if (grocery) { ready.push("groceries"); candidates.push(...grocery.candidates); }
  const groceryCount = candidates.filter(c => c.kind === "grocery").length;
  monitoring.push({ category: "grocery", status: !grocery ? "unavailable" : grocery.comparable ? "watching" : "missing", detail: grocery?.comparable ? `${grocery.comparable} comparaison(s) étayée(s), ${groceryCount} baisse(s) atteignant les seuils 15 % et 2 unités monétaires sur les formats achetables. Hors frais, taxes et déplacement.` : "Il faut deux reçus finaux payés et revus en 90 jours, un achat récent, le même produit et un prix public local approuvé, disponible et encore valable. Aucune économie supposée." });
  const open = e.invoices?.reconciliations?.filter(c => c.WorkflowStatus === "open" && ["submit-primary", "submit-secondary"].includes(c.Action) && !c.HasUnresolvedReimbursementEvidence && !c.OriginalInvoiceMissing) ?? [];
  const rules = e.claimDeadlines;
  if (rules && e.invoices) {
    ready.push("claim-deadlines");
    for (const r of rules) {
      const claim = open.find(c => c.Id === r.expenseId && c.NextInsurer === (r.insurer === "desjardins" ? "Desjardins" : "Blue Cross")), remaining = age(r.date, today);
      const document = e.invoices.items.find(i => i.Id === r.sourceDocumentId && !i.IgnoredAt && !i.NeedsReview && i.Status !== 4);
      if (!claim || !document || !claim.DocumentIds?.includes(r.sourceDocumentId) || r.sourceDate > today || Date.parse(r.confirmedAt) > now.getTime() || remaining < 0 || remaining > 30 || !e.invoices.lastSuccess || now.getTime() - Date.parse(e.invoices.lastSuccess) > 7 * day) continue;
      const window = remaining <= 1 ? "1" : remaining <= 7 ? "7" : "30";
      candidates.push({ source: "claim-deadlines", kind: "claim-deadline", key: `claim-deadline:${r.expenseId}:${r.insurer}:${r.date}:${window}`, groupKey: `claim-deadline:${r.expenseId}:${r.insurer}`, evidenceKey: `${r.date}:${r.sourceDocumentId}:${r.sourceDate}`, actionable: true, pushEligible: true, priority: remaining <= 7 ? 3 : 2, expiresAt: expiry(r.date, 1), title: "Réclamation : date limite documentée à vérifier", detail: `Date limite enregistrée : ${r.date}, dans ${remaining} jour(s). Un dossier ouvert attend cette prochaine demande. Vérifiez la règle et la pièce source, puis préparez la demande ; aucune soumission ni admissibilité n’est présumée. Preuve revue : ${r.sourceNote}`, sourceDate: r.sourceDate, target: { view: "reimbursements", recordId: claim.Id } });
    }
  }
  const linkedRules = rules?.filter(r => open.some(c => c.Id === r.expenseId && c.DocumentIds?.includes(r.sourceDocumentId) && c.NextInsurer === (r.insurer === "desjardins" ? "Desjardins" : "Blue Cross")) && e.invoices?.items.some(i => i.Id === r.sourceDocumentId && !i.IgnoredAt && !i.NeedsReview && i.Status !== 4)).length ?? 0;
  monitoring.push({ category: "claim-deadline", status: !e.invoices || !rules ? "unavailable" : linkedRules ? "watching" : "missing", detail: !rules ? "Preuves de délais indisponibles ; aucun délai déduit." : `${linkedRules}/${open.length} dossier(s) ouvert(s) à soumettre avec une règle liée à sa pièce. Sans règle explicitement revue et source actuelle, aucune échéance n’est inventée.` });
  return { candidates, ready, monitoring };
}
