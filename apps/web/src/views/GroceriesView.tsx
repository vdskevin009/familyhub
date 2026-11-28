import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Plus, RefreshCw, ShoppingBasket, Trash2 } from "lucide-react";
import type { WorkerConfig } from "../types";
import { Notice, Sheet } from "../ui/primitives";
import { blankItem, monthlySummary, possibleDuplicates, receiptWarnings, unitPrice, type GroceryRecord, type GroceryReceipt, type GroceryItem } from "../../../worker/src/grocery-model";
import { fileSource, groceryRequest, importGroceries, loadGroceries, reviewGroceries, type UploadSource, type SourceBytes } from "../grocery-api";
import { groceryCache } from "../grocery-cache";
import "../grocery.css";
import GroceryPurchases from "./GroceryPurchases";
import GroceryMonthlySpending from "./GroceryMonthlySpending";
type Edit = { record: GroceryRecord; receipt: GroceryReceipt };
const amount = (s: string) => s === "" ? null : Number(s);
const money = (n: number, currency: string) => `${n.toFixed(2)} ${currency}`;
function Numeric({ label, value, onChange, step = "0.01" }: { label: string; value: number | null; onChange: (v: number | null) => void; step?: string }) {
  return <label>{label}<input type="number" inputMode="decimal" min="0" step={step} value={value ?? ""} placeholder="Unknown" onChange={e => onChange(amount(e.target.value))} /></label>;
}
export default function GroceriesView({ config, initialRecordId }: { config: WorkerConfig; initialRecordId?: string }) {
  const [records, setRecords] = useState<GroceryRecord[]>([]), [uploads, setUploads] = useState<UploadSource[]>([]);
  const [edit, setEdit] = useState<Edit | null>(null), [busy, setBusy] = useState(false), [ready, setReady] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [offline, setOffline] = useState(false);
  const [confirmed, setConfirmed] = useState(false), [distinct, setDistinct] = useState(false), [sources, setSources] = useState<SourceBytes[]>([]);
  const [month, setMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
  const fileInput = useRef<HTMLInputElement>(null), cameraInput = useRef<HTMLInputElement>(null);
  const actionLock = useRef(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const openedTarget = useRef<string | null>(null);
  const scope = config.Endpoint.trim().replace(/\/$/, "") || "unpaired";
  const paired = Boolean(config.Endpoint.trim() && config.ApiKey.trim());
  useEffect(() => { let active = true;
    setInitialLoadComplete(false); openedTarget.current = null;
    (async () => {
      try {
        const cached = await groceryCache<GroceryRecord[]>(scope + ":records"), pending = await groceryCache<UploadSource[]>("pending-upload");
        if (!active) return; setRecords(cached ?? []); setUploads(pending ?? []); setToolsOpen(Boolean(pending?.length)); setReady(true);
        if (paired) {
          try { const library = await loadGroceries(config); if (!active) return; setRecords(library.records); setOffline(false); await groceryCache(scope + ":records", library.records); }
          catch (e) { if (active) { setOffline(true); setError((e as Error).message); } }
        }
      } catch (e) { if (active) { setReady(true); setError((e as Error).message); } }
      finally { if (active) setInitialLoadComplete(true); }
    })();
    return () => { active = false; };
  // Pairing changes should load only the selected PC's cache.
  }, [scope, config.ApiKey]);
  useEffect(() => { if (ready) void groceryCache("pending-upload", uploads).catch(e => setError(e.message)); }, [uploads, ready, scope]);
  useEffect(() => { if (edit) { const timer = setTimeout(() => { void groceryCache(scope + ":edit:" + edit.record.id, edit).catch(e => setError(e.message)); }, 200); return () => clearTimeout(timer); } }, [edit, scope]);
  async function action(run: () => Promise<void>) { if (actionLock.current) return; actionLock.current = true; setBusy(true); setError(""); setNotice(""); try { await run(); } catch (e) { setError((e as Error).message); } finally { actionLock.current = false; setBusy(false); } }
  async function refresh() {
    const library = await loadGroceries(config); setRecords(library.records); setOffline(false); await groceryCache(scope + ":records", library.records);
    setNotice("Receipts refreshed from the PC. Your open edits are still shown.");
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
      setEdit(local); setError("The receipt changed on the PC. Compare your edits with the PC version before saving.");
    }
    setConfirmed(false); setDistinct(false); setSources([]);
  }
  useEffect(() => {
    if (!initialRecordId || !initialLoadComplete || openedTarget.current === initialRecordId) return;
    openedTarget.current = initialRecordId;
    const target = records.find(record => record.id === initialRecordId);
    if (target) void action(() => open(target));
    else setError("This receipt isn’t available in the current data. Refresh or look for it in Purchases.");
  }, [initialRecordId, initialLoadComplete, records, scope]);
  const patch = (value: Partial<GroceryReceipt>) => { setEdit(e => e && ({ ...e, receipt: { ...e.receipt, ...value } })); setConfirmed(false); setDistinct(false); };
  const patchItem = (index: number, value: Partial<GroceryItem>) => edit && patch({ items: edit.receipt.items.map((i, n) => n === index ? { ...i, ...value } : i) });
  async function addFiles(files: FileList | null) {
    if (!files) return;
    await action(async () => {
      const selected = await Promise.all(Array.from(files).map(fileSource));
      const next = [...new Map([...uploads, ...selected].map(s => [s.type + s.data, s])).values()];
      if (next.length > 8 || next.reduce((s, x) => s + x.data.length * .75, 0) > 20 * 1024 * 1024) throw new Error("Choose up to 8 photos and 20 MB per receipt.");
      await groceryCache("pending-upload", next); setUploads(next);
    });
    if (fileInput.current) fileInput.current.value = ""; if (cameraInput.current) cameraInput.current.value = "";
  }
  async function importTicket() {
    const result = await importGroceries(config, uploads); await replaceRecord(result.record); setUploads([]); await groceryCache("pending-upload", []);
    setNotice(result.duplicate ? "These sources are already saved. The existing receipt was opened." : "Sources saved on the PC. Extract the items or enter them manually.");
  }
  async function extract() {
    if (!edit) return;
    const record = await groceryRequest<GroceryRecord>(config, `/groceries/${edit.record.id}/extract`, { expectedRevision: edit.record.revision });
    await replaceRecord(record); setNotice("Extraction complete. Review the sources, line items and amounts before saving.");
  }
  async function save(save: boolean) {
    if (!edit) return;
    const record = await reviewGroceries(config, edit.record, edit.receipt, save, confirmed, distinct);
    await replaceRecord(record); setNotice(save ? "Purchase saved on the household PC." : "Draft saved on the PC.");
    if (save) setEdit(null);
  }
  async function showSources() {
    if (!edit) return;
    setSources(await Promise.all(edit.record.sources.map(s => groceryRequest<SourceBytes>(config, `/groceries/${edit.record.id}/sources/${s.hash}`))));
  }
  const summary = monthlySummary(records, month), duplicates = edit ? possibleDuplicates({ ...edit.record, receipt: edit.receipt }, records) : [];

  return <section className="view-stack grocery-view" aria-busy={!ready}>
    <div className="grocery-section-heading"><h2>Recent purchases</h2><button className="button secondary" disabled={busy || !paired} onClick={() => void action(refresh)}><RefreshCw size={16} />Refresh</button></div>
    {error && <Notice error onDismiss={() => setError("")}>{error}</Notice>}{notice && <Notice onDismiss={() => setNotice("")}>{notice}</Notice>}
    {busy && <p role="status">Working… Imported sources are kept.</p>}
    {offline && <p className="grocery-warning">This device shows cached history. Connect to the PC and refresh to see the latest purchases.</p>}
    <GroceryMonthlySpending records={records} offline={offline} />
    <GroceryPurchases config={config} records={records} onReview={r => void action(() => open(r))} /><details className="grocery-purchase-tools" open={toolsOpen} onToggle={event => setToolsOpen(event.currentTarget.open)}><summary>Sources and tools</summary><section id="grocery-ticket-import" className="grocery-import" aria-label="Add a receipt">
      <div><ShoppingBasket size={25} /><h2>One receipt, multiple photos if needed</h2><p>Take photos from top to bottom with a little overlap. Keep all photos for the same receipt together.</p></div>
      <input ref={cameraInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Take a photo of the receipt" onChange={e => void addFiles(e.target.files)} disabled={busy} />
      <input ref={fileInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,application/pdf,text/plain" multiple aria-label="Choose photos or a digital receipt" onChange={e => void addFiles(e.target.files)} disabled={busy} />
      <div className="grocery-actions"><button className="button" disabled={busy || !ready} onClick={() => cameraInput.current?.click()}><Camera size={18} />Take a photo</button><button className="button secondary" disabled={busy || !ready} onClick={() => fileInput.current?.click()}><ImagePlus size={18} />Photo library or receipt</button></div>
      {!paired && <p>Pair the PC under More → Settings and tools → Local AI. Selected photos stay on this device until then.</p>}
      {!!uploads.length && <><div className="grocery-thumbnails">{uploads.map((s, i) => <div key={i}>{s.type.startsWith("image/") && <img src={`data:${s.type};base64,${s.data}`} alt={`Receipt photo ${i + 1}`} />}<span>{i + 1}. {s.name}</span><button className="icon-button" disabled={busy} aria-label={`Remove source ${i + 1}`} onClick={() => setUploads(u => u.filter((_, n) => n !== i))}><Trash2 size={16} /></button></div>)}</div><p>{uploads.length} source(s) for this receipt. JPG, PNG and WebP up to 5 MB each. PDF and text files are also accepted.</p><button className="button" disabled={busy || !paired} onClick={() => void action(importTicket)}>Import this receipt</button></>}
    </section>
    <section className="grocery-month" aria-label="Monthly purchases"><div className="grocery-section-heading"><h2>Your purchases this month</h2><label>Month<input type="month" value={month} onChange={e => setMonth(e.target.value)} /></label></div>
      <p>Saved purchases do not measure actual consumption. Currencies are shown separately and unknown amounts are excluded.</p>
      {summary.incomplete > 0 && <p className="grocery-warning">{summary.incomplete} saved receipt(s) missing a date, currency or total.</p>}
      {!summary.currencies.length && <p className="grocery-empty">No dated purchases with a known currency this month. Import and review your first receipt.</p>}
      {summary.currencies.map(group => <div key={group.currency} className="grocery-currency"><h3>{group.count} purchase(s) · {money(group.total, group.currency)}</h3><p>Known delivery fees, service fees and tips : {money(group.fees, group.currency)}</p>
        <h3>Frequently purchased items and observed prices</h3>{group.products.slice(0, 12).map(p => {
          const units = [...new Set(p.observations.map(o => o.unit))];
          return <div className="grocery-product" key={p.name}><strong>{p.name}</strong><p>{p.count} receipt(s) · {money(p.spent, group.currency)} in known line items</p>
            {!p.observations.length && <small>Quantity or pack size unknown: unit price not calculated.</small>}
            {units.map(unit => { const obs = p.observations.filter(o => o.unit === unit).sort((a, b) => a.price - b.price), low = obs[0], high = obs[obs.length - 1];
              return <div key={unit}><p>{money(low.price, group.currency)}/{unit}{high.price > low.price && ` to ${money(high.price, group.currency)}/${unit}`}</p>
                {high.price > low.price && <p>Historical difference of {money(high.price - low.price, group.currency)}/{unit}. Check the brand, variant and availability before comparing.</p>}
                <button className="text-action" onClick={() => void action(() => open(records.find(r => r.id === low.receiptId)!))}>View the observed price at {low.store} on {low.date}</button>
              </div>;
            })}</div>;
        })}<p>These prices come from your receipts and are not current offers.</p></div>)}
    </section>
    </details>
    <Sheet open={Boolean(edit)} onClose={() => { if (!busy && edit) void action(async () => { await groceryCache(scope + ":edit:" + edit.record.id, edit); setEdit(null); }); }} title="Review receipt" description="Leave unknown fields blank. Correct the items, then confirm that you reviewed the sources." wide footer={<><button className="button secondary" disabled={busy || !edit || edit.record.status === "saved"} onClick={() => void action(() => save(false))}>Save draft</button><button className="button" disabled={busy || !confirmed} onClick={() => void action(() => save(true))}>Save purchase</button></>}>
      {edit && <div className="grocery-review">
        {error && <Notice error>{error}</Notice>}{notice && <Notice>{notice}</Notice>}{busy && <p role="status">Working…</p>}
        <div className="grocery-actions"><button className="button secondary" disabled={busy} onClick={() => void action(showSources)}>View {edit.record.sources.length} source(s)</button>
          <button className="button secondary" disabled={busy || edit.record.status !== "draft" || edit.receipt.items.length > 0 || edit.record.extraction === "running"} onClick={() => void action(extract)}>Extract items</button>
          <button className="text-action" disabled={busy} onClick={() => void action(refresh)}>Refresh receipts from the PC</button>
          <button className="text-action" disabled={busy} onClick={() => { const pc = records.find(r => r.id === edit.record.id); if (pc) void action(() => replaceRecord(pc)); }}>Reload the PC version</button></div>
        <p>{edit.record.extraction === "running" ? "Extraction in progress. Refresh when it finishes." : edit.record.extraction === "failed" ? "Extraction interrupted or unavailable. Your sources are still saved." : "Codex on your PC analyses the photos without searching the web. You can also enter items manually."}</p>
        <div className="grocery-sources">{sources.map((s, i) => <details key={s.hash}><summary>Source {i + 1} : {s.name}</summary>{s.type.startsWith("image/") ? <img src={`data:${s.type};base64,${s.data}`} alt={`Source ${i + 1} for receipt review`} /> : s.type === "text/plain" ? <pre>{new TextDecoder().decode(Uint8Array.from(atob(s.data), c => c.charCodeAt(0)))}</pre> : <p>Download the original PDF to review it.</p>}<a download={s.name} href={`data:${s.type};base64,${s.data}`}>Download original</a></details>)}</div>
        <fieldset disabled={busy} className="grocery-fields"><legend>Receipt</legend><label>Store<input value={edit.receipt.store} onChange={e => patch({ store: e.target.value })} /></label><label>Date<input type="date" value={edit.receipt.date ?? ""} onChange={e => patch({ date: e.target.value || null })} /></label><label>Currency (CAD, EUR…)<input maxLength={3} placeholder="Unknown" value={edit.receipt.currency ?? ""} onChange={e => patch({ currency: e.target.value.toUpperCase() || null })} /></label><label>Receipt reference<input value={edit.receipt.reference} onChange={e => patch({ reference: e.target.value })} /></label><label>Source type<select value={edit.receipt.sourceType ?? "unknown"} onChange={e => patch({ sourceType: e.target.value as GroceryReceipt["sourceType"] })}><option value="unknown">Needs review</option><option value="confirmation">Original confirmation</option><option value="final-receipt">Final receipt with verified payment</option></select></label><Numeric label="Amount on source" value={edit.receipt.total} onChange={v => patch({ total: v })} /></fieldset>
        <fieldset disabled={busy} className="grocery-fields"><legend>Fees and adjustments</legend>{(["delivery", "service", "tip", "tax", "discount"] as const).map((key, i) => <Numeric key={key} label={["Delivery", "Service", "Tip", "Tax", "Order discount"][i]} value={edit.receipt[key]} onChange={v => patch({ [key]: v })} />)}</fieldset>
        <h3>Items ({edit.receipt.items.length})</h3>
        {edit.receipt.items.map((item, index) => <fieldset className="grocery-line" key={index} disabled={busy}><legend>Item {index + 1}{item.uncertain ? "  · needs review" : ""}</legend>
          <div className="grocery-fields"><label>Receipt description<input value={item.name} onChange={e => patchItem(index, { name: e.target.value })} /></label><label>Comparable item (brand / variant)<input value={item.product} onChange={e => patchItem(index, { product: e.target.value })} placeholder="Use the same name for the same item" /></label><Numeric label="Line price" value={item.amount} onChange={v => patchItem(index, { amount: v })} /><Numeric label="Number of packs / measured weight" step="any" value={item.quantity} onChange={v => patchItem(index, { quantity: v })} /><Numeric label="Pack size" step="any" value={item.size} onChange={v => patchItem(index, { size: v })} /><label>Unit<select aria-label="Unit" value={item.unit ?? ""} onChange={e => patchItem(index, { unit: (e.target.value || null) as GroceryItem["unit"] })}><option value="">Unknown</option>{["g", "kg", "ml", "l", "each"].map(u => <option key={u} value={u}>{u === "each" ? "each" : u}</option>)}</select></label></div>
          <p>{unitPrice(item) ? `${unitPrice(item)!.price.toFixed(2)} ${edit.receipt.currency || "currency unknown"}/${unitPrice(item)!.unit}` : "Unit price is unavailable without a known quantity and pack size."}</p>
          {item.evidence && <p className="grocery-evidence">Extracted evidence : {item.evidence}</p>}
          <label className="grocery-check"><input type="checkbox" checked={!item.uncertain} onChange={e => patchItem(index, { uncertain: !e.target.checked })} />Line item checked against the source</label>
          <button className="text-action" onClick={() => patch({ items: edit.receipt.items.filter((_, n) => n !== index) })}>Remove this line</button>
        </fieldset>)}
        <button className="button secondary" disabled={busy} onClick={() => patch({ items: [...edit.receipt.items, blankItem()] })}><Plus size={16} />Add an item</button>
        {!!receiptWarnings(edit.receipt).length && <div className="grocery-warning"><strong>Needs review</strong><ul>{receiptWarnings(edit.receipt).map(w => <li key={w}>{w}</li>)}</ul><button className="text-action" disabled={busy} onClick={() => patch({ warnings: [] })}>Mark extraction warnings as reviewed</button></div>}
        {!!duplicates.length && <div className="grocery-warning"><strong>Similar purchase already saved</strong>{duplicates.map(d => <div key={d.id}><p>{d.receipt.store} · {d.receipt.date} · {d.receipt.total} {d.receipt.currency}</p><button className="text-action" disabled={busy} onClick={() => void action(() => open(d))}>Open the existing purchase</button>{edit.record.status === "draft" && <button className="button secondary" disabled={busy} onClick={() => void action(async () => { const draft = await reviewGroceries(config, edit.record, edit.receipt, false, false, false); await groceryRequest(config, `/groceries/${draft.id}/duplicate`, { expectedRevision: draft.revision, targetId: d.id }); await refresh(); setEdit(null); setNotice("Sources linked to the existing purchase. It is counted only once."); })}>Link these sources to this purchase</button>}</div>)}<label className="grocery-check"><input type="checkbox" checked={distinct} disabled={busy} onChange={e => setDistinct(e.target.checked)} />I’ve verified this is a separate purchase</label></div>}
        <label className="grocery-check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />I’ve reviewed the sources, items, fees and total. Any remaining unknowns are intentional.</label>
      </div>}
    </Sheet>
  </section>;
}
