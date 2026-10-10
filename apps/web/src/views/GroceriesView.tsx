import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Plus, RefreshCw, ShoppingBasket, Trash2 } from "lucide-react";
import type { WorkerConfig } from "../types";
import { Notice, Sheet } from "../ui/primitives";
import { blankItem, monthlySummary, possibleDuplicates, receiptWarnings, unitPrice, type GroceryRecord, type GroceryReceipt, type GroceryItem } from "../../../worker/src/grocery-model";
import { fileSource, groceryRequest, importGroceries, loadGroceries, reviewGroceries, type UploadSource, type SourceBytes } from "../grocery-api";
import { groceryCache } from "../grocery-cache";
import "../grocery.css";
type Edit = { record: GroceryRecord; receipt: GroceryReceipt };
const amount = (s: string) => s === "" ? null : Number(s);
const money = (n: number, currency: string) => `${n.toFixed(2)} ${currency}`;
function Numeric({ label, value, onChange, step = "0.01" }: { label: string; value: number | null; onChange: (v: number | null) => void; step?: string }) {
  return <label>{label}<input type="number" inputMode="decimal" min="0" step={step} value={value ?? ""} placeholder="Inconnu" onChange={e => onChange(amount(e.target.value))} /></label>;
}
export default function GroceriesView({ config }: { config: WorkerConfig }) {
  const [records, setRecords] = useState<GroceryRecord[]>([]), [uploads, setUploads] = useState<UploadSource[]>([]);
  const [edit, setEdit] = useState<Edit | null>(null), [busy, setBusy] = useState(false), [ready, setReady] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [offline, setOffline] = useState(false);
  const [confirmed, setConfirmed] = useState(false), [distinct, setDistinct] = useState(false), [sources, setSources] = useState<SourceBytes[]>([]);
  const [month, setMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
  const fileInput = useRef<HTMLInputElement>(null), cameraInput = useRef<HTMLInputElement>(null);
  const actionLock = useRef(false);
  const scope = config.Endpoint.trim().replace(/\/$/, "") || "unpaired";
  const paired = Boolean(config.Endpoint.trim() && config.ApiKey.trim());
  useEffect(() => { let active = true;
    (async () => {
      try {
        const cached = await groceryCache<GroceryRecord[]>(scope + ":records"), pending = await groceryCache<UploadSource[]>("pending-upload");
        if (!active) return; setRecords(cached ?? []); setUploads(pending ?? []); setReady(true);
        if (paired) {
          try { const library = await loadGroceries(config); if (!active) return; setRecords(library.records); setOffline(false); await groceryCache(scope + ":records", library.records); }
          catch (e) { if (active) { setOffline(true); setError((e as Error).message); } }
        }
      } catch (e) { if (active) { setReady(true); setError((e as Error).message); } }
    })();
    return () => { active = false; };
  // Pairing changes should load only the selected PC's cache.
  }, [scope, config.ApiKey]);
  useEffect(() => { if (ready) void groceryCache("pending-upload", uploads).catch(e => setError(e.message)); }, [uploads, ready, scope]);
  useEffect(() => { if (edit) { const timer = setTimeout(() => { void groceryCache(scope + ":edit:" + edit.record.id, edit).catch(e => setError(e.message)); }, 200); return () => clearTimeout(timer); } }, [edit, scope]);
  async function action(run: () => Promise<void>) { if (actionLock.current) return; actionLock.current = true; setBusy(true); setError(""); setNotice(""); try { await run(); } catch (e) { setError((e as Error).message); } finally { actionLock.current = false; setBusy(false); } }
  async function refresh() {
    const library = await loadGroceries(config); setRecords(library.records); setOffline(false); await groceryCache(scope + ":records", library.records);
    setNotice("Tickets relus depuis le PC. Vos corrections ouvertes restent affichées.");
  }
  async function replaceRecord(record: GroceryRecord) {
    const next = records.some(r => r.id === record.id) ? records.map(r => r.id === record.id ? record : r) : [...records, record];
    setRecords(next); setEdit({ record, receipt: structuredClone(record.receipt) }); setConfirmed(false); setDistinct(false); setSources([]);
    await groceryCache(scope + ":records", next); await groceryCache(scope + ":edit:" + record.id, { record, receipt: record.receipt });
  }
  async function open(record: GroceryRecord) {
    const local = await groceryCache<Edit>(scope + ":edit:" + record.id);
    setEdit(local && local.record.revision === record.revision ? local : { record, receipt: structuredClone(record.receipt) });
    if (local && local.record.revision !== record.revision && JSON.stringify(local.receipt) !== JSON.stringify(record.receipt)) {
      setEdit(local); setError("Le ticket a changé sur le PC. Comparez vos corrections avec la version PC avant de l'enregistrer.");
    }
    setConfirmed(false); setDistinct(false); setSources([]);
  }
  const patch = (value: Partial<GroceryReceipt>) => { setEdit(e => e && ({ ...e, receipt: { ...e.receipt, ...value } })); setConfirmed(false); setDistinct(false); };
  const patchItem = (index: number, value: Partial<GroceryItem>) => edit && patch({ items: edit.receipt.items.map((i, n) => n === index ? { ...i, ...value } : i) });
  async function addFiles(files: FileList | null) {
    if (!files) return;
    await action(async () => {
      const selected = await Promise.all(Array.from(files).map(fileSource));
      const next = [...new Map([...uploads, ...selected].map(s => [s.type + s.data, s])).values()];
      if (next.length > 8 || next.reduce((s, x) => s + x.data.length * .75, 0) > 20 * 1024 * 1024) throw new Error("Choisissez au maximum 8 photos et 20 Mo pour un ticket.");
      await groceryCache("pending-upload", next); setUploads(next);
    });
    if (fileInput.current) fileInput.current.value = ""; if (cameraInput.current) cameraInput.current.value = "";
  }
  async function importTicket() {
    const result = await importGroceries(config, uploads); await replaceRecord(result.record); setUploads([]); await groceryCache("pending-upload", []);
    setNotice(result.duplicate ? "Ces sources sont déjà conservées. Le ticket existant a été ouvert." : "Sources conservées sur le PC. Lancez l'extraction ou saisissez les produits.");
  }
  async function extract() {
    if (!edit) return;
    const record = await groceryRequest<GroceryRecord>(config, `/groceries/${edit.record.id}/extract`, { expectedRevision: edit.record.revision });
    await replaceRecord(record); setNotice("Extraction terminée. Vérifiez les sources, les lignes et les montants avant enregistrement.");
  }
  async function save(save: boolean) {
    if (!edit) return;
    const record = await reviewGroceries(config, edit.record, edit.receipt, save, confirmed, distinct);
    await replaceRecord(record); setNotice(save ? "Achat enregistré sur le PC du foyer." : "Brouillon conservé sur le PC.");
    if (save) setEdit(null);
  }
  async function showSources() {
    if (!edit) return;
    setSources(await Promise.all(edit.record.sources.map(s => groceryRequest<SourceBytes>(config, `/groceries/${edit.record.id}/sources/${s.hash}`))));
  }
  const summary = monthlySummary(records, month), duplicates = edit ? possibleDuplicates({ ...edit.record, receipt: edit.receipt }, records) : [];
  const active = records.filter(r => !r.duplicateOf).sort((a, b) => (b.receipt.date || b.createdAt).localeCompare(a.receipt.date || a.createdAt));
  return <section className="view-stack grocery-view">
    <div className="grocery-section-heading"><h2>Tickets et dépenses</h2><button className="button secondary" disabled={busy || !paired} onClick={() => void action(refresh)}><RefreshCw size={16} />Actualiser</button></div>
    {error && <Notice error onDismiss={() => setError("")}>{error}</Notice>}{notice && <Notice onDismiss={() => setNotice("")}>{notice}</Notice>}
    {busy && <p role="status">Opération en cours… Les sources importées restent conservées.</p>}
    {offline && <p className="grocery-warning">Historique en cache sur cet appareil. Connectez le PC puis actualisez pour retrouver les derniers achats.</p>}
    <section className="grocery-import" aria-label="Ajouter un ticket">
      <div><ShoppingBasket size={25} /><h2>Un ticket, plusieurs photos si besoin</h2><p>Photographiez de haut en bas, avec un petit chevauchement. Gardez toutes les photos du même ticket ensemble.</p></div>
      <input ref={cameraInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Prendre une photo du ticket" onChange={e => void addFiles(e.target.files)} disabled={busy} />
      <input ref={fileInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,application/pdf,text/plain" multiple aria-label="Choisir les photos ou le reçu numérique" onChange={e => void addFiles(e.target.files)} disabled={busy} />
      <div className="grocery-actions"><button className="button" disabled={busy || !ready} onClick={() => cameraInput.current?.click()}><Camera size={18} />Prendre une photo</button><button className="button secondary" disabled={busy || !ready} onClick={() => fileInput.current?.click()}><ImagePlus size={18} />Galerie ou reçu</button></div>
      {!paired && <p>Appairez le PC dans Other → Settings & tools → Local AI. Les photos choisies restent sur cet appareil jusque-là.</p>}
      {!!uploads.length && <><div className="grocery-thumbnails">{uploads.map((s, i) => <div key={i}>{s.type.startsWith("image/") && <img src={`data:${s.type};base64,${s.data}`} alt={`Photo ${i + 1} du ticket`} />}<span>{i + 1}. {s.name}</span><button className="icon-button" disabled={busy} aria-label={`Retirer la source ${i + 1}`} onClick={() => setUploads(u => u.filter((_, n) => n !== i))}><Trash2 size={16} /></button></div>)}</div><p>{uploads.length} source(s) dans ce ticket. JPG, PNG, WebP jusqu'à 5 Mo ; PDF ou texte également acceptés.</p><button className="button" disabled={busy || !paired} onClick={() => void action(importTicket)}>Importer ce ticket</button></>}
    </section>
    <section className="grocery-month" aria-label="Achats du mois"><div className="grocery-section-heading"><h2>Vos achats du mois</h2><label>Mois<input type="month" value={month} onChange={e => setMonth(e.target.value)} /></label></div>
      <p>Les achats enregistrés ne mesurent pas la consommation réelle. Les devises restent séparées ; les montants inconnus sont exclus.</p>
      {summary.incomplete > 0 && <p className="grocery-warning">{summary.incomplete} ticket(s) enregistré(s) avec date, devise ou total manquant.</p>}
      {!summary.currencies.length && <p className="grocery-empty">Aucun achat daté avec une devise connue pour ce mois. Importez votre premier ticket et vérifiez-le.</p>}
      {summary.currencies.map(group => <div key={group.currency} className="grocery-currency"><h3>{group.count} achat(s) · {money(group.total, group.currency)}</h3><p>Livraison, service et pourboires connus : {money(group.fees, group.currency)}</p>
        <h3>Produits fréquents et prix observés</h3>{group.products.slice(0, 12).map(p => {
          const units = [...new Set(p.observations.map(o => o.unit))];
          return <div className="grocery-product" key={p.name}><strong>{p.name}</strong><p>{p.count} ticket(s) · {money(p.spent, group.currency)} en lignes connues</p>
            {!p.observations.length && <small>Quantité ou format manquant : prix unitaire non calculé.</small>}
            {units.map(unit => { const obs = p.observations.filter(o => o.unit === unit).sort((a, b) => a.price - b.price), low = obs[0], high = obs[obs.length - 1];
              return <div key={unit}><p>{money(low.price, group.currency)}/{unit}{high.price > low.price && ` à ${money(high.price, group.currency)}/${unit}`}</p>
                {high.price > low.price && <p>Écart historique de {money(high.price - low.price, group.currency)}/{unit}. Vérifiez même marque/variante et disponibilité avant de comparer.</p>}
                <button className="text-action" onClick={() => void action(() => open(records.find(r => r.id === low.receiptId)!))}>Voir le prix observé chez {low.store} le {low.date}</button>
              </div>;
            })}</div>;
        })}<p>Ces prix proviennent de vos tickets ; ils ne sont pas des offres actuelles.</p></div>)}
    </section>
    <section aria-label="Historique Courses"><h2>Tickets et brouillons</h2>{!active.length && <p className="grocery-empty">Vos tickets apparaîtront ici. Un brouillon ne compte pas dans les dépenses.</p>}
      <div className="grocery-history">{active.map(r => <button key={r.id} className="grocery-ticket" disabled={busy} onClick={() => void action(() => open(r))}><span><strong>{r.receipt.store || "Ticket à vérifier"}</strong><small>{r.receipt.date || "Date à préciser"} · {r.sources.length} source(s)</small></span><span>{r.receipt.total === null ? "Total inconnu" : `${r.receipt.total.toFixed(2)} ${r.receipt.currency || "devise ?"}`}<small>{r.status === "saved" ? "Enregistré" : "Brouillon"}</small></span></button>)}</div>
    </section>
    <Sheet open={Boolean(edit)} onClose={() => { if (!busy && edit) void action(async () => { await groceryCache(scope + ":edit:" + edit.record.id, edit); setEdit(null); }); }} title="Vérifier le ticket" description="Gardez les inconnues vides. Corrigez les produits, puis confirmez la revue des sources." wide footer={<><button className="button secondary" disabled={busy || !edit || edit.record.status === "saved"} onClick={() => void action(() => save(false))}>Conserver le brouillon</button><button className="button" disabled={busy || !confirmed} onClick={() => void action(() => save(true))}>Enregistrer l'achat</button></>}>
      {edit && <div className="grocery-review">
        {error && <Notice error>{error}</Notice>}{notice && <Notice>{notice}</Notice>}{busy && <p role="status">Opération en cours…</p>}
        <div className="grocery-actions"><button className="button secondary" disabled={busy} onClick={() => void action(showSources)}>Voir les {edit.record.sources.length} source(s)</button>
          <button className="button secondary" disabled={busy || edit.record.status !== "draft" || edit.receipt.items.length > 0 || edit.record.extraction === "running"} onClick={() => void action(extract)}>Extraire les produits</button>
          <button className="text-action" disabled={busy} onClick={() => void action(refresh)}>Actualiser les tickets PC</button>
          <button className="text-action" disabled={busy} onClick={() => { const pc = records.find(r => r.id === edit.record.id); if (pc) void action(() => replaceRecord(pc)); }}>Recharger la version PC</button></div>
        <p>{edit.record.extraction === "running" ? "Extraction en cours. Actualisez après son résultat." : edit.record.extraction === "failed" ? "Extraction interrompue ou indisponible. Les sources restent conservées." : "Les photos seront analysées par le même Codex déjà configuré sur votre PC, sans recherche web. Vous pouvez aussi saisir les produits."}</p>
        <div className="grocery-sources">{sources.map((s, i) => <details key={s.hash}><summary>Source {i + 1} : {s.name}</summary>{s.type.startsWith("image/") ? <img src={`data:${s.type};base64,${s.data}`} alt={`Source ${i + 1} du ticket à vérifier`} /> : s.type === "text/plain" ? <pre>{new TextDecoder().decode(Uint8Array.from(atob(s.data), c => c.charCodeAt(0)))}</pre> : <p>PDF : téléchargez la source pour la vérifier.</p>}<a download={s.name} href={`data:${s.type};base64,${s.data}`}>Télécharger l'original</a></details>)}</div>
        <fieldset disabled={busy} className="grocery-fields"><legend>Ticket</legend><label>Magasin<input value={edit.receipt.store} onChange={e => patch({ store: e.target.value })} /></label><label>Date<input type="date" value={edit.receipt.date ?? ""} onChange={e => patch({ date: e.target.value || null })} /></label><label>Devise (CAD, EUR…)<input maxLength={3} placeholder="Inconnue" value={edit.receipt.currency ?? ""} onChange={e => patch({ currency: e.target.value.toUpperCase() || null })} /></label><label>Référence du ticket<input value={edit.receipt.reference} onChange={e => patch({ reference: e.target.value })} /></label><Numeric label="Total payé" value={edit.receipt.total} onChange={v => patch({ total: v })} /></fieldset>
        <fieldset disabled={busy} className="grocery-fields"><legend>Frais et ajustements séparés</legend>{(["delivery", "service", "tip", "tax", "discount"] as const).map((key, i) => <Numeric key={key} label={["Livraison", "Service", "Pourboire", "Taxes", "Remise globale"][i]} value={edit.receipt[key]} onChange={v => patch({ [key]: v })} />)}</fieldset>
        <h3>Produits ({edit.receipt.items.length})</h3>
        {edit.receipt.items.map((item, index) => <fieldset className="grocery-line" key={index} disabled={busy}><legend>Produit {index + 1}{item.uncertain ? " · à vérifier" : ""}</legend>
          <div className="grocery-fields"><label>Libellé du ticket<input value={item.name} onChange={e => patchItem(index, { name: e.target.value })} /></label><label>Produit comparable (marque / variante)<input value={item.product} onChange={e => patchItem(index, { product: e.target.value })} placeholder="Même nom pour le même produit" /></label><Numeric label="Prix de la ligne" value={item.amount} onChange={v => patchItem(index, { amount: v })} /><Numeric label="Nombre de formats / poids mesuré" step="any" value={item.quantity} onChange={v => patchItem(index, { quantity: v })} /><Numeric label="Taille d'un format" step="any" value={item.size} onChange={v => patchItem(index, { size: v })} /><label>Unité<select aria-label="Unité" value={item.unit ?? ""} onChange={e => patchItem(index, { unit: (e.target.value || null) as GroceryItem["unit"] })}><option value="">Inconnue</option>{["g", "kg", "ml", "l", "each"].map(u => <option key={u} value={u}>{u === "each" ? "unité" : u}</option>)}</select></label></div>
          <p>{unitPrice(item) ? `${unitPrice(item)!.price.toFixed(2)} ${edit.receipt.currency || "devise ?"}/${unitPrice(item)!.unit}` : "Prix unitaire indisponible sans quantité et format connus."}</p>
          {item.evidence && <p className="grocery-evidence">Preuve extraite : {item.evidence}</p>}
          <label className="grocery-check"><input type="checkbox" checked={!item.uncertain} onChange={e => patchItem(index, { uncertain: !e.target.checked })} />Ligne vérifiée dans la source</label>
          <button className="text-action" onClick={() => patch({ items: edit.receipt.items.filter((_, n) => n !== index) })}>Retirer cette ligne</button>
        </fieldset>)}
        <button className="button secondary" disabled={busy} onClick={() => patch({ items: [...edit.receipt.items, blankItem()] })}><Plus size={16} />Ajouter un produit</button>
        {!!receiptWarnings(edit.receipt).length && <div className="grocery-warning"><strong>À vérifier</strong><ul>{receiptWarnings(edit.receipt).map(w => <li key={w}>{w}</li>)}</ul><button className="text-action" disabled={busy} onClick={() => patch({ warnings: [] })}>Marquer les avertissements d'extraction comme traités</button></div>}
        {!!duplicates.length && <div className="grocery-warning"><strong>Achat similaire déjà enregistré</strong>{duplicates.map(d => <div key={d.id}><p>{d.receipt.store} · {d.receipt.date} · {d.receipt.total} {d.receipt.currency}</p><button className="text-action" disabled={busy} onClick={() => void action(() => open(d))}>Ouvrir l'achat existant</button>{edit.record.status === "draft" && <button className="button secondary" disabled={busy} onClick={() => void action(async () => { const draft = await reviewGroceries(config, edit.record, edit.receipt, false, false, false); await groceryRequest(config, `/groceries/${draft.id}/duplicate`, { expectedRevision: draft.revision, targetId: d.id }); await refresh(); setEdit(null); setNotice("Sources rattachées à l'achat existant. Il compte une seule fois."); })}>Rattacher ces sources à cet achat</button>}</div>)}<label className="grocery-check"><input type="checkbox" checked={distinct} disabled={busy} onChange={e => setDistinct(e.target.checked)} />J'ai vérifié : c'est un achat distinct</label></div>}
        <label className="grocery-check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />J'ai revu les sources, produits, frais et total. Les inconnues restantes sont volontairement conservées.</label>
      </div>}
    </Sheet>
  </section>;
}
