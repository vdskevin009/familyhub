import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, FileCheck2, RefreshCw } from "lucide-react";
import { claimDossierReadiness } from "../../../worker/src/claim-readiness";
import { claimAction, type ClaimPreparation } from "../worker";
import type { WorkerConfig } from "../types";
import { Notice, SkeletonList } from "../ui/primitives";

/** Reads the existing preview only: never opens a portal or starts preparation. */
export default function ClaimDossier({ expenseId, initialInsurer, config, remaining, sourceRevision, preparationAllowed, onPrepare }: {
  expenseId: string; initialInsurer?: "blue-cross" | "desjardins"; config: WorkerConfig;
  remaining?: number | null; sourceRevision: string; preparationAllowed: boolean; onPrepare: (insurer: "blue-cross" | "desjardins") => void;
}) {
  const [insurer, setInsurer] = useState(initialInsurer || "");
  const [loaded, setLoaded] = useState<{ key: string; dossier: ClaimPreparation }>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false), [retry, setRetry] = useState(0);
  const key = JSON.stringify([expenseId, insurer, config.Endpoint, config.ApiKey, sourceRevision]);
  const dossier = loaded?.key === key ? loaded.dossier : undefined;
  useEffect(() => {
    let active = true;
    setLoaded(undefined); setError("");
    if (!insurer || !config.Endpoint || !config.ApiKey) { setLoading(false); return; }
    setLoading(true);
    void claimAction<ClaimPreparation>(config, "preview", { expenseId, insurer }).then(value => {
      if (active) setLoaded({ key, dossier: value });
    }).catch(() => { if (active) setError("Le PC n’a pas pu relire ce dossier. Les preuves ne sont pas actualisées."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [key, retry]);
  // Derive from the received facts, including with a worker predating this view.
  const readiness = dossier && claimDossierReadiness(dossier);
  const money = (value: number | null | undefined) => {
    if (value == null || !Number.isFinite(value)) return "Inconnu";
    if (!dossier?.currency) return `${value.toFixed(2)} · devise inconnue`;
    try { return new Intl.NumberFormat("fr-CA", { style: "currency", currency: dossier.currency }).format(value); }
    catch { return `${value.toFixed(2)} · devise à vérifier`; }
  };
  const needs = readiness?.checks.filter(c => c.state === "missing" || c.state === "blocked") ?? [];
  return <section className="claim-dossier" aria-labelledby="claim-dossier-title" aria-busy={loading}>
    <div className="claim-dossier-heading"><FileCheck2 size={21} aria-hidden="true" /><div><h2 id="claim-dossier-title">Pièces et prochaine action</h2><p>Les faits connus, puis les vérifications du portail.</p></div></div>
    {!initialInsurer && <label>Assureur à examiner<select value={insurer} onChange={e => setInsurer(e.target.value)}><option value="">Choisir l’assureur</option><option value="blue-cross">Blue Cross</option><option value="desjardins">Desjardins</option></select></label>}
    {!config.Endpoint || !config.ApiKey ? <Notice>Connectez le PC pour relire les pièces. Les données conservées restent consultables.</Notice> : !insurer ? <Notice>L’ordre des assureurs n’est pas établi. Choisissez un dossier à examiner ; aucun ordre n’est déduit de ce choix.</Notice> : null}
    {loading && <SkeletonList label="Lecture des pièces du remboursement" />}
    {error && <Notice error>{error}<button type="button" className="button secondary" onClick={() => setRetry(x => x + 1)}><RefreshCw size={16} aria-hidden="true" />Relire les preuves</button></Notice>}
    {dossier && readiness && <>
      <div className="claim-dossier-facts" aria-label="Montants distincts du dossier"><div><span>{dossier.originalAmountEvidence?.confidence === "reconstructed" ? "Brut reconstruit" : "Brut du dossier"}</span><strong>{money(dossier.fields.originalAmount)}</strong></div><div><span>Autre assureur payé</span><strong>{money(dossier.fields.otherInsurancePaid)}</strong></div><div><span>Reste à examiner</span><strong>{money(remaining)}</strong></div></div>
      <p className="claim-dossier-limit">Le solde reste potentiel. Un montant inconnu ne vaut pas zéro.</p>
      <div className={`claim-dossier-state ${readiness.status === "blocked" ? "caution" : ""}`}><span>{readiness.status === "blocked" ? "Preuves à clarifier" : readiness.status === "needs-information" ? "Dossier à compléter" : "Faits disponibles"}</span><strong>{readiness.nextAction}</strong></div>
      {needs.length > 0 && <ul className="claim-dossier-needs">{needs.slice(0, 3).map(check => <li key={check.id}><AlertTriangle size={16} aria-hidden="true" /><span><strong>{check.label}</strong>{check.detail}</span></li>)}</ul>}
      <details className="claim-dossier-checks"><summary>Pièces, contrôles et sources · {readiness.checks.length}</summary><ul>{readiness.checks.map(check => <li key={check.id}><span className={`claim-check-state ${check.state}`}>{check.state === "available" ? <CheckCircle2 size={17} aria-hidden="true" /> : <AlertTriangle size={17} aria-hidden="true" />}{check.state === "available" ? "Connu" : check.state === "blocked" ? "Bloquant" : check.state === "missing" ? "À compléter" : "À vérifier"}</span><strong>{check.label}</strong>{check.value != null && <p className="claim-check-value">{check.value}</p>}<p>{check.detail}</p></li>)}</ul></details>
      <p className="claim-dossier-limit">Historique récent et demandes en attente non vérifiés. Les champs relus et l’ajout effectif des pièces doivent être confirmés dans le portail. Votre validation finale reste nécessaire.</p>
      {!preparationAllowed && <Notice>Ce dossier n’est plus ouvert. Ses décisions sont conservées ; aucune nouvelle préparation depuis cet aperçu.</Notice>}
      <button type="button" className="button" disabled={dossier.blocked || !preparationAllowed} onClick={() => onPrepare(insurer as "blue-cross" | "desjardins")}>{readiness.status === "needs-information" ? "Préparer les valeurs connues" : "Préparer sur le PC"}<ChevronRight size={17} aria-hidden="true" /></button>
    </>}
  </section>;
}
