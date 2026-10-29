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
    <summary>Compléter cette ligne</summary>
    <p>La confirmation concerne uniquement le produit et le format de cette ligne d'achat. Le ticket, ses montants et les autorisations de substitution restent inchangés.</p>
    {!candidates.length && <p>{state ? "Aucun candidat documenté pour cette ligne. Consultez les sources du ticket pour retrouver le produit et son format." : "Les candidats ne sont pas vérifiables. Reconnectez le PC puis actualisez le comparatif."}</p>}
    {candidates.map(c => { const reason = purchaseCandidateReason(c, record), decision = state?.decisions[c.id], link = grocerySourceLink(c.sourceUrl), active = decision?.state === "confirmed"; return <section tabIndex={-1} className="grocery-resolution-candidate" key={c.id}>
      <h5>{c.brand ? c.brand + " — " : ""}{c.product}</h5>
      <p><strong>{active ? "Confirmation enregistrée" : "Correspondance candidate — à confirmer"}</strong></p>
      <p>Format proposé : <strong>{c.formatLabel}</strong>. Référence {c.productId}.</p>
      <p>{c.formatBasis === "household-assumption" ? "Format fourni par le foyer, non vérifié comme poids officiel." : "Format actuellement affiché par la source publique ; il ne prouve pas le format de cet ancien achat."}</p>
      <p>Preuve datée du {new Date(c.observedAt).toLocaleDateString("fr-CA")} : {c.note}</p>
      {active && decision.evidence && <p>Validation enregistrée le {new Date(decision.evidence.at).toLocaleString("fr-CA")} : {decision.evidence.source}</p>}
      {link && <p><a href={link.href} target="_blank" rel="noreferrer">Examiner la fiche source</a></p>}
      {reason && <p role="status">{reason}</p>}
      {!c.size || !c.unit ? <p>Format insuffisant pour comparer : retrouvez le poids ou le nombre d'unités du paquet.</p> : active ? <>
        <p>Retirer cette confirmation rétablit l'état précédent du comparatif, sans effacer la preuve candidate.</p>
        <button type="button" className="button secondary" disabled={busy || !available} onClick={event => { const target = event.currentTarget.closest("section"); void onDecision(c.id, "unconfirm").then(() => target?.focus()); }}>Retirer cette confirmation</button>
      </> : <fieldset disabled={busy || !available || !!reason || !!confirmed}>
        <legend>Vérification de l'achat</legend>
        <label className="grocery-resolution-check"><input type="checkbox" checked={checked === c.id} onChange={e => setChecked(e.target.checked ? c.id : null)} />Je confirme que ce produit et ce format correspondent à cette ligne de l'achat.</label>
        <button type="button" className="button" disabled={checked !== c.id} onClick={event => { const target = event.currentTarget.closest("section"); void onDecision(c.id, "confirm").then(() => { setChecked(null); target?.focus(); }); }}>Confirmer ce produit et ce format</button>
      </fieldset>}
      {!available && <><p>{error || "Confirmation indisponible : actualisez avec le PC connecté et à jour."}</p><button type="button" className="button secondary" disabled={busy || !canRefresh} onClick={onRefresh}>Réessayer la lecture des confirmations</button></>}
    </section>; })}
    <div className="grocery-resolution-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => { setChecked(null); setOpen(false); requestAnimationFrame(() => details.current?.querySelector("summary")?.focus()); }}>Annuler</button><button type="button" className="text-action" disabled={busy} onClick={onReview}>Consulter les sources du ticket</button><a href="?view=groceries&tab=needs">Gérer les prix et correspondances</a></div>
  </details>;
}
