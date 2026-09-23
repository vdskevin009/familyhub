import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDollarSign, ExternalLink, Link2, RefreshCw } from "lucide-react";
import { dateLabel } from "../domain";
import { googleBridge } from "../google";
import type { HubState } from "../state";
import { fetchInvoices } from "../worker";
import { ReimbursementItem, ReimbursementStatus, type ReconciliationCase } from "../types";

type Props = { hub: HubState };
type Focus = "open" | "unmatched" | "complete";

function mergeItems(existing: ReimbursementItem[], incoming: ReimbursementItem[]): ReimbursementItem[] {
  const map = new Map(existing.map(item => [`${item.AccountEmail.toLowerCase()}:${item.SourceMessageId}`, item]));
  for (const next of incoming) {
    const key = `${next.AccountEmail.toLowerCase()}:${next.SourceMessageId}`;
    const current = map.get(key);
    map.set(key, current ? {
      ...next,
      Notes: current.Notes,
      DriveFileId: current.DriveFileId,
      DrivePath: current.DrivePath,
      ArchivedAt: current.ArchivedAt
    } : next);
  }
  return [...map.values()];
}

function money(value: number | null | undefined, currencyCode = "CAD"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("en-CA", { style: "currency", currency: currencyCode || "CAD" }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currencyCode || "CAD"}`;
  }
}

function actionLabel(action: ReconciliationCase["Action"]): string {
  switch (action) {
    case "review-amount": return "Vérifier le montant";
    case "submit-primary": return "Soumettre au primaire";
    case "submit-secondary": return "Soumettre au secondaire";
    case "verify-balance": return "Vérifier le solde";
    case "complete": return "Réconcilié";
  }
}

function isReimbursementDocument(item: ReimbursementItem): boolean {
  if (item.Status === ReimbursementStatus.Ignored) return false;
  return item.DocumentRole === "expense"
    || item.DocumentRole === "insurer-statement"
    || item.ReimbursementEligibility === "possible"
    || item.DocumentType === "claim"
    || item.DocumentType === "invoice"
    || item.DocumentType === "receipt";
}

function itemAmount(item: ReimbursementItem): number | null {
  if (item.DocumentRole === "insurer-statement") return item.ReimbursedAmount ?? item.DetectedAmount ?? null;
  return item.BilledAmount ?? item.DetectedAmount ?? null;
}

export default function ReimbursementsView({ hub }: Props) {
  const [focus, setFocus] = useState<Focus>("open");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastSuccess, setLastSuccess] = useState<string | null>(null);
  const paired = Boolean(String(hub.worker.Endpoint || "").trim() && String(hub.worker.ApiKey || "").trim());

  async function refresh() {
    if (!paired) return;
    setBusy(true);
    setError("");
    try {
      const snapshot = await fetchInvoices(hub.worker);
      hub.setReimbursements(previous => ({
        ...previous,
        SchemaVersion: 2,
        Items: mergeItems(previous.Items, snapshot.items),
        Reconciliations: snapshot.reconciliations,
        CleanupSuggestions: snapshot.cleanupSuggestions,
        ImportantMail: snapshot.importantMail,
        LearningDecisions: Number(snapshot.learning?.decisions || 0)
      }));
      setLastSuccess(snapshot.lastSuccess || new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de récupérer les résultats du PC.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (paired) void refresh();
    // Sync once when the dedicated workspace opens; the PC remains the source of truth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paired, hub.worker.Endpoint, hub.worker.ApiKey]);

  const data = useMemo(() => {
    const cases = [...(hub.reimbursements.Reconciliations ?? [])];
    const open = cases.filter(item => item.Action !== "complete");
    const complete = cases.filter(item => item.Action === "complete");
    const matchedIds = new Set(cases.flatMap(item => item.DocumentIds));
    const candidates = hub.reimbursements.Items.filter(isReimbursementDocument);
    const unmatched = candidates
      .filter(item => !matchedIds.has(item.Id))
      .sort((a, b) => +new Date(b.ReceivedAt) - +new Date(a.ReceivedAt));
    const missingAmount = candidates
      .filter(item => itemAmount(item) === null)
      .sort((a, b) => +new Date(b.ReceivedAt) - +new Date(a.ReceivedAt));
    const potentialCad = open
      .filter(item => item.Currency === "CAD")
      .reduce((sum, item) => sum + (item.PotentialRemaining ?? 0), 0);
    return { open, complete, unmatched, missingAmount, potentialCad };
  }, [hub.reimbursements.Items, hub.reimbursements.Reconciliations]);

  const visibleCases = focus === "complete" ? data.complete : data.open;

  return (
    <div className="view-stack">
      <section className="view-hero compact">
        <div>
          <span className="eyebrow">Remboursements</span>
          <h1>Factures, remboursements et soldes à récupérer.</h1>
          <p>FamilyHub rapproche les factures avec les relevés des assureurs, montre ce qui est réconcilié et isole ce qui ne peut pas encore être rapproché.</p>
        </div>
        <span className="hero-icon"><CircleDollarSign size={26} /></span>
      </section>

      {error && <div className="banner error"><AlertTriangle size={17} />{error}</div>}
      {!paired && <div className="banner">Connecte le PC agent dans More → Local AI pour utiliser les résultats quotidiens comme source de vérité.</div>}

      <section className="surface">
        <div className="section-heading inline">
          <div><span className="eyebrow">Source</span><h2>Analyse du PC agent</h2></div>
          <button className="mini-button primary" disabled={!paired || busy} onClick={() => void refresh()}>
            <RefreshCw size={15} /> {busy ? "Actualisation…" : "Actualiser"}
          </button>
        </div>
        <p>{lastSuccess ? `Dernière synchronisation affichée : ${new Date(lastSuccess).toLocaleString()}` : "Les derniers résultats déjà synchronisés restent visibles ci-dessous."}</p>
      </section>

      <section className="metric-row">
        <article><small>Dossiers ouverts</small><strong>{data.open.length}</strong><span>à terminer</span></article>
        <article><small>Reste potentiel</small><strong>{money(data.potentialCad, "CAD")}</strong><span>CAD · à vérifier</span></article>
        <article><small>Non rapprochés</small><strong>{data.unmatched.length}</strong><span>documents</span></article>
        <article><small>Montant manquant</small><strong>{data.missingAmount.length}</strong><span>à corriger</span></article>
      </section>

      <section className="surface">
        <div className="section-heading inline">
          <div><span className="eyebrow">Réconciliation</span><h2>Dossiers</h2></div>
          <div className="inbox-actions">
            <button className={`mini-button ${focus === "open" ? "primary" : ""}`} onClick={() => setFocus("open")}>À faire · {data.open.length}</button>
            <button className={`mini-button ${focus === "unmatched" ? "primary" : ""}`} onClick={() => setFocus("unmatched")}>Non rapprochés · {data.unmatched.length}</button>
            <button className={`mini-button ${focus === "complete" ? "primary" : ""}`} onClick={() => setFocus("complete")}>Réconciliés · {data.complete.length}</button>
          </div>
        </div>

        {focus !== "unmatched" && visibleCases.length === 0 && <p>Aucun dossier dans cette catégorie.</p>}
        {focus !== "unmatched" && visibleCases.map(item => (
          <article key={item.Id} className="cleanup-row" style={{ alignItems: "start" }}>
            <div>
              <strong>{item.Provider || "Prestataire"} · {item.Member}</strong>
              <small>{item.ServiceDate ? dateLabel(item.ServiceDate) : "Date de soin à vérifier"} · confiance {Math.round(item.Confidence * 100)}%</small>
              <p>{item.Summary}</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <strong>{money(item.OriginalAmount, item.Currency)}</strong>
              <small>facturé</small>
            </div>
            <div style={{ textAlign: "right" }}>
              <strong>{money(item.ReimbursedAmount, item.Currency)}</strong>
              <small>remboursé</small>
            </div>
            <div style={{ textAlign: "right" }}>
              <strong>{money(item.PotentialRemaining, item.Currency)}</strong>
              <small>reste potentiel</small>
            </div>
            <span className={`attention-badge ${item.Action === "complete" ? "" : "action"}`}>
              {item.Action === "complete" ? <CheckCircle2 size={13} /> : <Link2 size={13} />} {actionLabel(item.Action)}{item.NextInsurer ? ` · ${item.NextInsurer}` : ""}
            </span>
          </article>
        ))}

        {focus === "unmatched" && data.unmatched.length === 0 && <p>Tous les documents de remboursement détectés sont actuellement reliés à un dossier.</p>}
        {focus === "unmatched" && data.unmatched.map(item => (
          <article key={item.Id} className="cleanup-row" style={{ alignItems: "start" }}>
            <div>
              <strong>{item.Provider || item.Subject || "Document"}</strong>
              <small>{item.Member || item.AccountLabel} · {dateLabel(item.ReceivedAt)}</small>
              <p>{item.DocumentRole === "insurer-statement" ? "Remboursement sans facture correspondante." : "Facture/reçu sans remboursement correspondant."}</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <strong>{money(itemAmount(item), item.Currency)}</strong>
              <small>{itemAmount(item) === null ? "montant non capturé" : "montant détecté"}</small>
            </div>
            <span className="attention-badge action">À rapprocher</span>
            <button className="mini-button" onClick={() => googleBridge.openMessage(item.AccountEmail, item.InternetMessageId, item.SourceMessageId)}>
              <ExternalLink size={14} /> Email
            </button>
          </article>
        ))}
      </section>

      <section className="surface">
        <div className="section-heading inline">
          <div><span className="eyebrow">Qualité des données</span><h2>Montants non capturés</h2></div>
          <span className="learning-count">{data.missingAmount.length} à vérifier</span>
        </div>
        {data.missingAmount.length === 0 ? <p>Aucun document de remboursement actif n’a un montant manquant.</p> : data.missingAmount.slice(0, 12).map(item => (
          <article key={item.Id} className="important-mail-row">
            <span className="attention-badge action">Montant</span>
            <div>
              <strong>{item.Provider || item.Subject || "Document"}</strong>
              <small>{item.Member || item.AccountLabel} · {dateLabel(item.ReceivedAt)}</small>
              <p>{item.AmountSource === "missing" ? "Le PC agent n’a pas trouvé de montant exploitable." : "Le montant facturé/remboursé manque dans les données structurées."}</p>
            </div>
            <button className="mini-button" onClick={() => googleBridge.openMessage(item.AccountEmail, item.InternetMessageId, item.SourceMessageId)}>
              <ExternalLink size={14} /> Email
            </button>
          </article>
        ))}
      </section>
    </div>
  );
}
