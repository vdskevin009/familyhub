import { useState } from "react";
import { Check } from "lucide-react";
import { currency } from "../domain";
import { compareOffer, monthlyPrice, type SavingsContract, type SavingsOffer } from "../savings";
const price = (value: number | null) => value === null ? "Unknown" : currency.format(value);
export default function SavingsOfferCard({ contract, offer, decision, stale, onDecision }: {
  contract: SavingsContract; offer: SavingsOffer; decision: "review" | "shortlist" | "dismissed"; stale: boolean;
  onDecision: (value: "review" | "shortlist" | "dismissed") => void;
}) {
  const [reviewed, setReviewed] = useState(decision === "shortlist");
  const result = compareOffer(contract, offer, new Date(), reviewed);
  const complete = !stale && result.reasons.length === 0;
  const known = result.reasons.filter(reason => !reason.includes("Review all policy")).length === 0;
  return <article className={"surface savings-offer " + (decision === "dismissed" ? "dismissed" : "")}>
    <div className="savings-contract-heading"><div><small>{offer.currentProvider ? "Current-provider option" : "Alternative"} · Public estimate</small><h3>{offer.provider}: {offer.title}</h3></div>{decision === "shortlist" && <span className="status-pill"><Check size={14} />Shortlisted</span>}</div>
    <dl className="savings-costs">
      <div><dt>Current / month</dt><dd>{price(monthlyPrice(contract.price, contract.cycle))}</dd></div>
      <div><dt>Alternative / month</dt><dd>{price(offer.monthlyPrice)}</dd></div>
      <div><dt>After promotion / month</dt><dd>{price(offer.promoMonths ? offer.monthlyPriceAfterPromo : offer.monthlyPrice)}</dd></div>
      <div><dt>Promotion duration</dt><dd>{offer.promoMonths} months</dd></div>
      <div><dt>Cancellation + new fees</dt><dd>{contract.cancellationFee === null || offer.upfrontFees === null ? "Unknown" : price(contract.cancellationFee + offer.upfrontFees)}</dd></div>
      <div><dt>Annual discounts lost</dt><dd>{contract.annualLostDiscounts === null || offer.annualLostDiscounts === null ? "Unknown" : price(Math.max(contract.annualLostDiscounts, offer.annualLostDiscounts))}</dd></div>
    </dl>
    {contract.category === "mortgage" && <p>Public comparison rate: {offer.mortgageRate ?? "unknown"}% · {offer.termMonths ?? "?"} months. Savings compare interest, not payment size.</p>}
    <div className="savings-result"><strong>{result.firstYear === null || !known ? "Net savings need more information" : price(result.firstYear) + " estimated first-year " + (result.metric === "interest" ? "interest " : "") + "difference"}</strong><small>{complete ? "Reviewed public estimate; eligibility still needs confirmation." : "Provisional; excluded from combined totals."}</small>{result.firstYear !== null && known && <span>{price(result.firstYear / 12)} /month averaged over the first year</span>}{result.ongoingAnnual !== null && known && <span>{price(result.ongoingAnnual)} {result.metric === "interest" ? "second-year interest difference" : "annual difference after promotions end"}</span>}</div>
    {(offer.differences.length > 0 || result.reasons.length > 0) && <details open><summary>Coverage, service and missing facts</summary><ul>{[...offer.differences, ...result.reasons].map((reason, index) => <li key={index}>{reason}</li>)}</ul></details>}
    {offer.conditions.length > 0 && <details><summary>Eligibility and conditions</summary><ul>{offer.conditions.map((condition, index) => <li key={index}>{condition}</li>)}</ul></details>}
    <div className="savings-sources"><small>Checked {offer.checkedAt.slice(0, 10)}{offer.validUntil && " · Expires " + offer.validUntil}</small>{offer.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>)}</div>
    <label className="toggle-label"><input type="checkbox" checked={reviewed} disabled={stale} onChange={event => { setReviewed(event.target.checked); if (!event.target.checked && decision === "shortlist") onDecision("review"); }} />I reviewed my saved requirements: service, coverage and benefits match.</label>
    <div className="row-actions"><button className="button secondary" disabled={!complete || result.firstYear === null || result.firstYear <= 0} onClick={() => onDecision("shortlist")}>Shortlist estimate</button><button className="button secondary" onClick={() => onDecision(decision === "dismissed" ? "review" : "dismissed")}>{decision === "dismissed" ? "Restore for review" : "Dismiss"}</button>{decision === "shortlist" && <button className="button secondary" onClick={() => onDecision("review")}>Remove from shortlist</button>}</div>
    <p className="muted">Shortlisting saves a preference only. It does not authorize contacting a provider, sharing information, obtaining a quote or switching.</p>
  </article>;
}
