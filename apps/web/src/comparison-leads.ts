import { baselineKey, compareOffer, contractMonthly, contractTaxes, type SavingsContract, type SavedSavingsReview } from "./savings";

export type ComparisonLead = { jobId: string; offerIndex: number; firstYear: number | null };
type LocalReview = SavedSavingsReview & { localKey?: string };

/** Presentation only. Never contributes to paid totals or promotes a public candidate to eligibility. */
export function comparisonLead(contract: SavingsContract, review: LocalReview | undefined, now = new Date()): ComparisonLead | null {
    if (!review || review.job.contractId !== contract.id || review.job.status !== "complete" || !review.job.report || review.localKey !== baselineKey(contract)) return null;
    const current = contractMonthly(contract);
    for (const [index, offer] of review.job.report.offers.entries()) {
        const checked = Date.parse(offer.checkedAt), expires = offer.validUntil ? Date.parse(offer.validUntil + "T23:59:59Z") : null;
        if (review.decisions[String(index)] === "dismissed" || !offer.comparable || !contract.needs.trim() || !offer.sources.some(s => /^https?:\/\//i.test(s.url)) ||
            !Number.isFinite(checked) || checked > now.getTime() || now.getTime() - checked > 30 * 86400000 ||
            (expires !== null && (!Number.isFinite(expires) || expires < now.getTime())) || offer.affectedContractIds.some(id => id !== contract.id)) continue;
        const reviewed = review.decisions[String(index)] === "shortlist";
        const result = compareOffer(contract, offer, now, reviewed);
        // A cheaper monthly candidate is only a lead when tax bases match. Unknown fees/eligibility stay qualitative.
        const cheaper = contract.category !== "mortgage" && (contract.billing?.currency ?? "CAD") === "CAD" && contractTaxes(contract) === true && offer.taxesIncluded &&
            current !== null && offer.monthlyPrice !== null && offer.monthlyPrice < current;
        if (!(result.firstYear !== null && result.firstYear > 0) && !cheaper) continue;
        // Known non-positive net savings are not promoted merely because the headline monthly price is lower.
        if (result.firstYear !== null && result.firstYear <= 0) continue;
        // The saved schema does not confirm personal eligibility. Even an empty conditions array
        // cannot establish it, so badges remain qualitative; the full dated calculation stays in the comparison.
        return { jobId: review.job.id, offerIndex: index, firstYear: null };
    }
    return null;
}
