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
const money = (n: number, currency: string) => new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(n);
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
    candidates.push({ source: "groceries", kind: "grocery", key: `grocery-drop:${price.id}:${price.evidence.date}:${price.price}`, groupKey: `grocery-drop:${price.itemId}:${price.retailerId}`, evidenceKey: `${price.id}:${price.evidence.date}:${price.price}:${latest.record.id}:${line.amount}`, actionable: true, pushEligible: true, priority: 1, expiresAt: expiry(price.evidence.until, 1), title: "Price drop on a regular purchase", detail: `${price.product}: ${money(outlay, price.currency)} for ${packs} package${packs === 1 ? "" : "s"}, versus ${money(line.amount!, price.currency)} on the receipt dated ${latest.record.receipt.date}. Observed product-price difference: ${money(difference, price.currency)}, excluding fees, taxes and travel. Net savings and need to repurchase are not assumed. Check local price and terms before buying.`, target: { view: "groceries", tab: "tickets", recordId: latest.record.id }, sourceDate: price.evidence.date, links: [{ label: "View dated retailer price", url: price.evidence.url }] });
  }
  return { candidates, comparable };
}

export function householdCandidates(e: NotificationEvidence, today: string, now: Date): { candidates: Candidate[]; ready: Candidate["source"][]; monitoring: Monitoring[] } {
  const candidates: Candidate[] = [], ready: Candidate["source"][] = [], monitoring: Monitoring[] = [];
  const p = e.policy, announcement = p?.announcement;
  const policyReady = p?.status === "ready" && Date.parse(p.checkedAt) <= now.getTime() && now.getTime() - Date.parse(p.checkedAt) <= 2 * 3_600_000;
  monitoring.push({ category: "policy", status: policyReady ? "watching" : "unavailable", detail: policyReady ? `Official source checked on ${p.checkedAt.slice(0, 10)}. The first reading is silent, and subsequent changes alert only once.` : "The official source has not been checked recently. No new decision is assumed." });
  if (policyReady) {
    ready.push("policy");
    if (announcement && announcement.change !== 0 && age(today, announcement.date) >= 0 && age(today, announcement.date) <= 7) {
      const profile = e.mortgageState && latestDecisionProfile((e.mortgageState.profiles ?? []).filter(v => Date.parse(v.recordedAt) <= now.getTime()));
      const fixed = profile?.rateType === "fixed" && profile.maturityDate && profile.maturityDate >= today && profile.currentRate !== null;
      const impact = fixed ? `Your saved mortgage remains fixed at ${profile.currentRate}% until ${profile.maturityDate}. There is no immediate change to its contractual rate.` : profile?.rateType === "variable" ? "Your mortgage is saved as variable. Check the lender’s prime rate, discount and payment structure. No new rate or payment is inferred." : "Confirm the mortgage type and maturity to assess the impact on your loan. No contractual rate has been recalculated.";
      candidates.push({ source: "policy", kind: "policy", key: `boc-policy:${announcement.date}`, groupKey: `boc-policy:${announcement.date}`, evidenceKey: `${announcement.rate}:${announcement.previousRate}:${announcement.change}:${announcement.effectiveDate}`, actionable: true, pushEligible: true, priority: 2, expiresAt: expiry(announcement.date, 8), title: "Bank of Canada changed its policy rate", detail: `Announcement on ${announcement.date}: ${announcement.previousRate}% to ${announcement.rate}% (${announcement.change > 0 ? "+" : ""}${announcement.change} percentage points), effective on ${announcement.effectiveDate}. ${impact} Review variable-rate options using the documented prime rate and contractual discount. Historical quotes are unchanged. The policy rate is not a lender’s prime rate or a personal offer.`, sourceDate: announcement.date, target: { view: "mortgage" }, links: [{ label: "Official decision and effective date", url: announcement.sourceUrl }] });
    }
  }
  const datedContracts = e.contracts?.filter(c => c.renewal || c.commitmentEnd || c.promotionEnd?.date || c.insuranceReference?.records.some(r => r.kind === "policy" && r.effectiveTo)).length ?? 0;
  monitoring.push({ category: "renewal", status: !e.contracts ? "unavailable" : datedContracts ? "watching" : "missing", detail: !e.contracts ? "Contracts unavailable. Existing reminders are preserved." : `${datedContracts} of ${e.contracts.length} contracts have a recorded deadline. Only documented, non-conflicting dates trigger reminders at 30, 7 and 1 day. Other dates still need confirmation.` });
  monitoring.push({ category: "gic", status: !e.finance?.data ? "unavailable" : e.finance.data.gics.length ? "watching" : "missing", detail: !e.finance?.data ? "Investment sources unavailable." : `${e.finance.data.gics.length} GICs have recorded dates. Sources collected on ${e.finance.data.collectedOn}. Check renewal instructions. No new offer or return is assumed.` });
  const grocery = e.groceries && groceryDropAssessment(e.groceries.library, e.groceries.plan, today);
  if (grocery) { ready.push("groceries"); candidates.push(...grocery.candidates); }
  const groceryCount = candidates.filter(c => c.kind === "grocery").length;
  monitoring.push({ category: "grocery", status: !grocery ? "unavailable" : grocery.comparable ? "watching" : "missing", detail: grocery?.comparable ? `${grocery.comparable} comparisons supported by evidence. ${groceryCount} price drops meet both the 15% unit-price and 2-unit currency thresholds for purchasable packages. Fees, taxes and travel are excluded.` : "Requires two reviewed final receipts within 90 days, a recent purchase, the same product and an approved, current local public price on an available product. No savings are assumed." });
  const open = e.invoices?.reconciliations?.filter(c => c.WorkflowStatus === "open" && ["submit-primary", "submit-secondary"].includes(c.Action) && !c.HasUnresolvedReimbursementEvidence && !c.OriginalInvoiceMissing) ?? [];
  const rules = e.claimDeadlines;
  if (rules && e.invoices) {
    ready.push("claim-deadlines");
    for (const r of rules) {
      const claim = open.find(c => c.Id === r.expenseId && c.NextInsurer === (r.insurer === "desjardins" ? "Desjardins" : "Blue Cross")), remaining = age(r.date, today);
      const document = e.invoices.items.find(i => i.Id === r.sourceDocumentId && !i.IgnoredAt && !i.NeedsReview && i.Status !== 4);
      if (!claim || !document || !claim.DocumentIds?.includes(r.sourceDocumentId) || r.sourceDate > today || Date.parse(r.confirmedAt) > now.getTime() || remaining < 0 || remaining > 30 || !e.invoices.lastSuccess || now.getTime() - Date.parse(e.invoices.lastSuccess) > 7 * day) continue;
      const window = remaining <= 1 ? "1" : remaining <= 7 ? "7" : "30";
      candidates.push({ source: "claim-deadlines", kind: "claim-deadline", key: `claim-deadline:${r.expenseId}:${r.insurer}:${r.date}:${window}`, groupKey: `claim-deadline:${r.expenseId}:${r.insurer}`, evidenceKey: `${r.date}:${r.sourceDocumentId}:${r.sourceDate}`, actionable: true, pushEligible: true, priority: remaining <= 7 ? 3 : 2, expiresAt: expiry(r.date, 1), title: "Claim: check the documented deadline", detail: `Recorded deadline: ${r.date}, in ${remaining} day${remaining === 1 ? "" : "s"}. An open claim is waiting for its next submission. Check the rule and source document, then prepare the claim. Submission and eligibility have not been confirmed. Reviewed evidence: ${r.sourceNote}`, sourceDate: r.sourceDate, target: { view: "reimbursements", recordId: claim.Id } });
    }
  }
  const linkedRules = rules?.filter(r => open.some(c => c.Id === r.expenseId && c.DocumentIds?.includes(r.sourceDocumentId) && c.NextInsurer === (r.insurer === "desjardins" ? "Desjardins" : "Blue Cross")) && e.invoices?.items.some(i => i.Id === r.sourceDocumentId && !i.IgnoredAt && !i.NeedsReview && i.Status !== 4)).length ?? 0;
  monitoring.push({ category: "claim-deadline", status: !e.invoices || !rules ? "unavailable" : linkedRules ? "watching" : "missing", detail: !rules ? "Deadline evidence unavailable. No deadline is inferred." : `${linkedRules} of ${open.length} open claims awaiting submission have a rule linked to their source document. A reviewed rule and current source are required to establish a deadline.` });
  return { candidates, ready, monitoring };
}
