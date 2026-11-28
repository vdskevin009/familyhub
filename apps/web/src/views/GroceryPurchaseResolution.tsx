import { useRef, useState } from "react";
import type { GroceryRecord } from "../../../worker/src/grocery-model";
import { confirmedPurchaseFormat, purchaseCandidateReason, purchaseCandidatesForLine, type PurchaseResolution } from "../../../worker/src/grocery-purchase-resolution";
import { grocerySourceLink } from "../grocery-source-link";

export default function GroceryPurchaseResolution({ record, index, state, busy, available, error, canRefresh, onRefresh, onDecision, onReview }: {
  record: GroceryRecord; index: number; state?: PurchaseResolution; busy: boolean; available: boolean;
  error: string; canRefresh: boolean; onRefresh: () => void;
  onDecision: (id: string, action: "confirm" | "unconfirm") => Promise<void>; onReview: () => void;
}) {
  const [checked, setChecked] = useState<string | null>(null), [open, setOpen] = useState(false);
  const details = useRef<HTMLDetailsElement | null>(null);
  const candidates = purchaseCandidatesForLine(state, record, index), confirmed = confirmedPurchaseFormat(state, record, index);
  return <details ref={details} className="grocery-resolution" open={open} onToggle={event => { setOpen(event.currentTarget.open); if (!event.currentTarget.open) setChecked(null); }}>
    <summary>Complete this line item</summary>
    <p>Confirming improves the quality of verified comparisons. Estimates remain available without confirmation. This confirms only the item and pack size on this line. The receipt and substitution permissions do not change.</p>
    {!candidates.length && <p>{state ? "No candidate is documented for this line. Check the receipt sources for the product and pack size." : "Candidates couldn’t be verified. Reconnect the PC and refresh the comparison."}</p>}
    {candidates.map(c => { const reason = purchaseCandidateReason(c, record), decision = state?.decisions[c.id], link = grocerySourceLink(c.sourceUrl), active = decision?.state === "confirmed"; return <section tabIndex={-1} className="grocery-resolution-candidate" key={c.id}>
      <h5>{c.brand ? c.brand + " — " : ""}{c.product}</h5>
      <p><strong>{active ? "Confirmation saved" : "Candidate match requires confirmation"}</strong></p>
      <p>Suggested pack size: <strong>{c.formatLabel}</strong>. Reference: {c.productId}.</p>
      <p>{c.formatBasis === "household-assumption" ? "The household supplied this pack size. It does not establish the official weight." : "This is the pack size currently listed by the public source, not proof of the size bought in the past."}</p>
      <p>Evidence dated {new Date(c.observedAt).toLocaleDateString("en-CA")} : {c.note}</p>
      {active && decision.evidence && <p>Confirmation saved on {new Date(decision.evidence.at).toLocaleString("en-CA")} : {decision.evidence.source}</p>}
      {link && <p><a href={link.href} target="_blank" rel="noreferrer">View source listing</a></p>}
      {reason && <p role="status">{reason}</p>}
      {!c.size || !c.unit ? <p>Not enough pack information to compare. Find the weight or number of units per pack.</p> : active ? <>
        <p>Removing this confirmation restores the previous comparison without deleting the candidate evidence.</p>
        <button type="button" className="button secondary" disabled={busy || !available} onClick={event => { const target = event.currentTarget.closest("section"); void onDecision(c.id, "unconfirm").then(() => target?.focus()); }}>Remove this confirmation</button>
      </> : <fieldset disabled={busy || !available || !!reason || !!confirmed}>
        <legend>Verify the purchase</legend>
        <label className="grocery-resolution-check"><input type="checkbox" checked={checked === c.id} onChange={e => setChecked(e.target.checked ? c.id : null)} />I confirm the item and pack size match this purchase line.</label>
        <button type="button" className="button" disabled={checked !== c.id} onClick={event => { const target = event.currentTarget.closest("section"); void onDecision(c.id, "confirm").then(() => { setChecked(null); target?.focus(); }); }}>Confirm this item and pack size</button>
      </fieldset>}
      {!available && <><p>{error || "Confirmation unavailable. Connect to an up-to-date PC worker and refresh."}</p><button type="button" className="button secondary" disabled={busy || !canRefresh} onClick={onRefresh}>Retry loading confirmations</button></>}
    </section>; })}
    <div className="grocery-resolution-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => { setChecked(null); setOpen(false); requestAnimationFrame(() => details.current?.querySelector("summary")?.focus()); }}>Cancel</button><button type="button" className="text-action" disabled={busy} onClick={onReview}>View receipt sources</button><a href="?view=groceries&tab=needs">Manage prices and matches</a></div>
  </details>;
}
