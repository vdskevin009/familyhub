import { useState, type FormEvent } from "react";
import { Plus, FileText, Download } from "lucide-react";
import { Notice } from "../ui/primitives";
import { categories, publicProviders, type SavingsContract } from "../savings";
import { saveContractDocument, downloadContractDocument } from "../contract-documents";
import ContractServicesForm from "./ContractServicesForm";
import { validateContract } from "../../../worker/src/savings-sharing-model";
const numericKeys = ["price", "cancellationFee", "annualLostDiscounts", "priceAfterPromo", "currentPromoMonths", "liabilityLimit", "collisionDeductible", "comprehensiveDeductible", "dataGb", "downloadMbps", "lines", "mortgageBalance", "mortgageRate", "amortizationYears", "termMonths"] as const;
type NumericKey = typeof numericKeys[number];

export default function SavingsContractForm({ initial, onSave, onClose }: {
  initial: SavingsContract; onSave: (contract: SavingsContract) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial), [error, setError] = useState(""), [uploading, setUploading] = useState(false);
  const update = (key: keyof SavingsContract, value: unknown) => setDraft(previous => ({ ...previous, [key]: value }));
  const numberField = (label: string, key: NumericKey, extra: { max?: number; min?: number; step?: string } = {}) =>
    <label>{label}<input type="number" min={extra.min ?? 0} max={extra.max} step={extra.step ?? "any"} value={draft[key] ?? ""}
      onChange={event => update(key, event.target.value === "" ? (key === "currentPromoMonths" ? 0 : key === "lines" ? 1 : null) : Number(event.target.value))} /></label>;
  function save(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim() || numericKeys.some(key => draft[key] !== null && (!Number.isFinite(draft[key]) || Number(draft[key]) < 0))) { setError("Enter a name and valid nonnegative amounts."); return; }
    if (!Number.isInteger(draft.currentPromoMonths) || draft.currentPromoMonths > 120 || !Number.isInteger(draft.lines) || draft.lines < 1 || draft.lines > 100) { setError("Check the promotion duration and number of lines."); return; }
    try { onSave(validateContract({ ...draft, name: draft.name.trim(), updatedAt: new Date().toISOString() })); }
    catch (e) { setError(e instanceof Error ? e.message : "Vérifiez les services et la période de facturation."); }
  }
  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true); setError("");
    try { const document = await saveContractDocument(file); setDraft(previous => ({ ...previous, documents: [...previous.documents, document] })); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not attach document."); }
    finally { setUploading(false); }
  }
  return <form className="form-surface savings-form" onSubmit={save}>
    {error && <Notice error>{error}</Notice>}
    <div className="form-grid">
      <label>Name<input required maxLength={120} value={draft.name} onChange={event => update("name", event.target.value)} placeholder="Home internet" /></label>
      <label>Category<select value={draft.category} onChange={event => update("category", event.target.value)}>{Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Current provider<input maxLength={100} list="savings-providers" value={draft.provider} onChange={event => update("provider", event.target.value)} /><datalist id="savings-providers">{publicProviders.map(provider => <option value={provider} key={provider} />)}</datalist></label>
      <label>Province / territory<select value={draft.province} onChange={event => update("province", event.target.value)}>{["BC", "AB", "SK", "MB", "ON", "QC", "NB", "NS", "PE", "NL", "YT", "NT", "NU"].map(province => <option key={province}>{province}</option>)}</select></label>
      {draft.category !== "mortgage" && <>{!draft.billing && numberField("Current price (CAD, all-in)", "price")}
        <label>{draft.billing ? "Historical comparison cycle" : "Billing cycle"}<select value={draft.cycle} onChange={event => update("cycle", event.target.value)}><option value="monthly">Monthly</option><option value="annual">Annual</option><option value="weekly">Weekly</option></select></label>
        <label className="span-two">Price includes taxes and recurring fees?<select value={draft.taxesIncluded === null ? "unknown" : String(draft.taxesIncluded)} onChange={event => update("taxesIncluded", event.target.value === "unknown" ? null : event.target.value === "true")}><option value="unknown">Not confirmed</option><option value="true">Yes, all-in total</option><option value="false">No, update price before comparing</option></select></label></>}
      <label>Renewal / review date<input type="date" value={draft.renewal} onChange={event => update("renewal", event.target.value)} /></label>
      <label>Commitment ends<input type="date" value={draft.commitmentEnd} onChange={event => update("commitmentEnd", event.target.value)} /></label>
      {numberField("Cancellation / break penalty (CAD)", "cancellationFee")}
      {numberField("Annual discounts lost if switching (CAD)", "annualLostDiscounts")}
    </div>
    <label>Service, coverage and usage requirements<textarea maxLength={3000} rows={3} value={draft.needs} onChange={event => update("needs", event.target.value)} placeholder="Required coverage, rental car protection, plan benefits or usage. No account numbers or passwords." /></label>
    {draft.category === "telecom" && <div className="form-grid">{numberField("Mobile data required (GB / line)", "dataGb")}{numberField("Internet speed required (Mbps)", "downloadMbps")}{numberField("Number of lines", "lines", { min: 1, max: 100, step: "1" })}</div>}
    {draft.category === "car-insurance" && <div className="form-grid">{numberField("Liability limit (CAD)", "liabilityLimit")}{numberField("Collision deductible (CAD)", "collisionDeductible")}{numberField("Comprehensive deductible (CAD)", "comprehensiveDeductible")}<p className="muted">Keep every endorsement in your requirements. In BC, note Basic and Optional premiums separately; an Optional discount is not a discount on the full premium.</p></div>}
    {draft.category === "mortgage" && <div className="form-grid">{numberField("Remaining balance (CAD)", "mortgageBalance")}{numberField("Current rate (%)", "mortgageRate", { max: 30 })}{numberField("Remaining amortization (years)", "amortizationYears", { min: 1, max: 40 })}{numberField("Comparison term (months)", "termMonths", { min: 1, max: 120, step: "1" })}<label>Rate type<select value={draft.rateType} onChange={event => update("rateType", event.target.value)}><option value="fixed">Fixed</option><option value="variable">Variable</option></select></label></div>}
    <ContractServicesForm draft={draft} onChange={setDraft} />
    <details><summary>Promotions, discounts and notes</summary>
      <div className="form-grid">{numberField("Months left on current promotion", "currentPromoMonths", { max: 120, step: "1" })}{numberField("All-in price after promotion (same billing cycle)", "priceAfterPromo")}</div>
      <label>Existing discounts / bundle terms<textarea maxLength={3000} value={draft.discounts} onChange={event => update("discounts", event.target.value)} /></label>
      <label>Private notes<textarea maxLength={3000} value={draft.notes} onChange={event => update("notes", event.target.value)} /></label>
    </details>
    <div className="savings-documents"><h3>Supporting documents</h3><p className="muted">PDF, JPG, PNG or text, up to 5 MB each. Saved locally and included in complete backups. Read the document and enter its facts above; attachment alone does not complete the checklist.</p>
      {draft.documents.map(document => <div className="savings-candidate" key={document.id}><span><FileText size={15} />{document.name}</span><button type="button" className="button secondary" onClick={() => void downloadContractDocument(document).catch(err => setError(err.message))}><Download size={15} />Download</button></div>)}
      <label className="button secondary file-button"><Plus size={16} />{uploading ? "Saving document…" : "Attach document"}<input type="file" disabled={uploading} accept="application/pdf,image/jpeg,image/png,text/plain" onChange={event => { void upload(event.target.files?.[0]); event.target.value = ""; }} /></label>
    </div>
    <div className="row-actions"><button type="button" className="button secondary" disabled={uploading} onClick={onClose}>Close</button><button className="button" disabled={uploading}>Save contract</button></div>
  </form>;
}
