import { useEffect, useState } from "react";
import type { WorkerConfig } from "../types";
import { claimAction, viewWorkerAttachment, downloadWorkerAttachment, type ClaimPreparation, type ClaimStep, type ClaimVerification } from "../worker";
import { Notice, Sheet } from "../ui/primitives";

export default function PrepareClaim({ expenseId, initialInsurer = "blue-cross", config, onClose }: { expenseId: string; initialInsurer?: "blue-cross" | "desjardins"; config: WorkerConfig; onClose: () => void }) {
  const [insurer, setInsurer] = useState<"blue-cross" | "desjardins">(initialInsurer);
  const [dossier, setDossier] = useState<ClaimPreparation>();
  const [reviewed, setReviewed] = useState(false);
  const [warningsReviewed, setWarningsReviewed] = useState(false), [uploadConfirmed, setUploadConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [step, setStep] = useState<ClaimStep>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [attachment, setAttachment] = useState("");
  const [answersReviewed, setAnswersReviewed] = useState(false), [rememberServiceChoices, setRememberServiceChoices] = useState(true);
  const [verification, setVerification] = useState<ClaimVerification>();
  const [ownerAmount, setOwnerAmount] = useState(""), [ownerReason, setOwnerReason] = useState(""), [ownerReviewed, setOwnerReviewed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    setDossier(undefined); setReviewed(false); setWarningsReviewed(false); setReason(""); setStep(undefined); setError(""); setBusy(true);
    claimAction<ClaimPreparation>(config, "preview", { expenseId, insurer }).then(value => { if (active) { setDossier(value); setOwnerAmount(value.coordination?.ownerConfirmation ? String(value.coordination.ownerConfirmation.amount) : ""); setOwnerReason(value.coordination?.ownerConfirmation?.reason || ""); setOwnerReviewed(false); } })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : "Preparation failed."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [expenseId, insurer, config.Endpoint, config.ApiKey]);
  async function run(action: () => Promise<void>) { setBusy(true); setError(""); setMessage(""); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Preparation failed."); } finally { setBusy(false); } }
  async function inspect() {
    const next = await claimAction<ClaimStep>(config, "inspect", { sessionId });
    acceptStep(next);
  }
  function acceptStep(next: ClaimStep, retainVerification = false) {
    setStep(next); setValues(Object.fromEntries(next.fields.filter(f => f.suggested != null || f.kind === "natureOfIllness" && reason).map(f => [f.key, f.suggested ?? reason]))); setAttachment(""); setUploadConfirmed(false); setAnswersReviewed(false); if (!retainVerification) setVerification(undefined);
  }
  const pendingFields = step?.status === "fields" && step.fields.some(f => f.type !== "file");
  function receiptSource(a: ClaimPreparation["attachments"][number]) { return { Id: a.documentId, Attachments: [{ Id: a.attachmentId, FileName: a.name, MimeType: "application/pdf", Size: 0 }] }; }
  return <Sheet open onClose={onClose} title={insurer === "blue-cross" ? "Prepare Blue Cross claim" : "Prepare Desjardins claim"} description="Review the receipt and amounts, then fill the insurer form on your PC.">
    <div className="prepare-claim">
      <label>Insurer<select value={insurer} disabled={busy || !!sessionId} onChange={e => setInsurer(e.target.value as typeof insurer)}><option value="blue-cross">Blue Cross</option><option value="desjardins">Desjardins</option></select></label>
      {error && <Notice error>{error}</Notice>}{message && <Notice>{message}</Notice>}
      {busy && <p role="status">Checking…</p>}
      {dossier && <>
        {dossier.coordination?.message && <p role="note" className="privacy-note">Warning: {dossier.coordination.message}</p>}
        {!sessionId && dossier.coordination?.required && <details><summary>Review / correct your other-insurer response</summary>
          {dossier.coordination.ownerConfirmation && <p>Owner-confirmed {dossier.coordination.primaryInsurer}: {dossier.coordination.ownerConfirmation.amount.toFixed(2)} {dossier.currency}. Reason: {dossier.coordination.ownerConfirmation.reason}. This is your statement, not an insurer-imported record.</p>}
          <label>Amount paid by first insurer (CAD)<input inputMode="decimal" value={ownerAmount} onChange={e => { setOwnerAmount(e.target.value); setOwnerReviewed(false); }} placeholder="Leave unknown blank; enter 0 only if confirmed" /></label>
          <label>Reason for the confirmed response<input value={ownerReason} onChange={e => { setOwnerReason(e.target.value); setOwnerReviewed(false); }} maxLength={500} /></label>
          <label className="prepare-check"><input type="checkbox" checked={ownerReviewed} onChange={e => setOwnerReviewed(e.target.checked)} />I received this adjudication for this exact invoice and confirm the stated amount and reason.</label>
          <button type="button" className="button secondary" disabled={busy || !ownerReviewed || !/^\d+(?:\.\d{1,2})?$/.test(ownerAmount) || !ownerReason.trim() || !dossier.fields.invoiceNumber || !dossier.fields.serviceDate || dossier.fields.originalAmount == null} onClick={() => void run(async () => {
            const result = await claimAction<{ preparation: ClaimPreparation }>(config, "confirm-adjudication", { expenseId, insurer: dossier.otherInsurer, amount: Number(ownerAmount), reason: ownerReason.trim(), confirmed: true,
              expectedInvoiceNumber: dossier.fields.invoiceNumber, expectedServiceDate: dossier.fields.serviceDate, expectedAmount: dossier.fields.originalAmount, expectedRevision: dossier.coordination?.ownerConfirmationRevision ?? 0 });
            setDossier(result.preparation); setOwnerReviewed(false); setMessage("Your adjudication confirmation was saved privately. No insurer statement was created and no claim was submitted.");
          })}>Save owner-confirmed response</button>
          {dossier.coordination.ownerConfirmation && <button type="button" className="text-action" disabled={busy} onClick={() => void run(async () => {
            const result = await claimAction<{ preparation: ClaimPreparation }>(config, "confirm-adjudication", { expenseId, insurer: dossier.otherInsurer, remove: true, reason: "Owner cleared the confirmation", confirmed: true,
              expectedInvoiceNumber: dossier.fields.invoiceNumber, expectedServiceDate: dossier.fields.serviceDate, expectedAmount: dossier.fields.originalAmount, expectedRevision: dossier.coordination?.ownerConfirmationRevision });
            setDossier(result.preparation); setOwnerAmount(""); setOwnerReason(""); setOwnerReviewed(false);
          })}>Clear owner-confirmed response</button>}
        </details>}
        <dl className="claim-preparation-facts">{Object.entries(dossier.fields).map(([key, value]) => <div key={key}><dt>{({ patient: "Patient", provider: "Clinic / provider", practitioner: "Practitioner", serviceDate: "Service date", originalAmount: "Original expense", service: "Invoice service", invoiceNumber: "Invoice number", otherInsurance: "Submitted to other insurer", otherInsurancePaid: `Paid by ${dossier.otherInsurer === "desjardins" ? "Desjardins" : "Blue Cross"}` } as Record<string, string>)[key]}</dt><dd>{value == null ? "To confirm" : typeof value === "number" ? `${value.toFixed(2)} ${dossier.currency || "(currency to confirm)"}` : String(value)}</dd></div>)}</dl>
        <section aria-label="Original receipts"><strong>Original receipt</strong>{dossier.attachments.length ? dossier.attachments.map((a, i) => <div key={`${a.documentId}:${a.attachmentId}`}><span>{a.name}{dossier.attachments.filter(b => b.name === a.name).length > 1 ? ` · source ${i + 1}` : ""}</span><div><button type="button" className="text-action" disabled={busy} onClick={() => void run(() => viewWorkerAttachment(config, receiptSource(a), 0))}>Review PDF</button><button type="button" className="text-action" disabled={busy} onClick={() => void run(() => downloadWorkerAttachment(config, receiptSource(a), 0))}>Download receipt</button></div></div>) : <p>No original PDF is indexed. Find the original receipt before uploading documents.</p>}</section>
        <Notice error={dossier.duplicate.status !== "not-verified"}>{dossier.duplicate.status === "recorded" ? "This insurer has already processed or recorded this expense. Review the existing claim instead of submitting it again." : dossier.duplicate.status === "possible" ? "A same-day insurer record may be this expense. Resolve that possible duplicate first." : "No duplicate was identified in saved records. Check the insurer's current history, including pending claims, before continuing."}</Notice>
        {!!dossier.missing.length && <p>Missing source fields: {dossier.missing.join(", ")}. Confirm these from the invoice.</p>}
        {dossier.conflicts.filter(c => c !== dossier.coordination?.message).map(c => <p key={c}>{c}</p>)}
        {!!dossier.reviewableWarnings?.length && <label className="prepare-check"><input type="checkbox" checked={warningsReviewed} disabled={!!sessionId || busy} onChange={e => setWarningsReviewed(e.target.checked)} />I reviewed the original PDF and confirmed the gross expense and other-insurer payment shown above. The conflicting extracted copy remains unchanged in FamilyHub.</label>}
        <details><summary>Source emails and duplicate-check details</summary><p>{dossier.duplicate.scope}</p>{dossier.sourceEmails.map(s => <p key={s.messageId}><a href={`https://mail.google.com/mail/u/?authuser=${encodeURIComponent(s.account)}#all/${encodeURIComponent(s.messageId)}`} target="_blank" rel="noreferrer">Source email · {s.account}</a></p>)}{dossier.duplicate.records.map(r => <p key={r.id}>{r.reference || "Recorded claim"} · {r.service || "Service to confirm"} · {r.status}</p>)}</details>
        {!sessionId && <>
          {insurer === "blue-cross" && <><label>Nature of illness / injury<input value={reason} placeholder="Enter your answer for this claim" onChange={e => setReason(e.target.value)} maxLength={500} /></label><p className="privacy-note">Your answer is used only for this claim. FamilyHub does not infer it from the receipt or reuse it on another claim.</p></>}
          <a className="button secondary" href={dossier.portalUrl} target="_blank" rel="noreferrer">Open insurer to check history</a>
          <label className="prepare-check"><input type="checkbox" disabled={dossier.blocked} checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I checked the current insurer history: this invoice has not already been claimed with this insurer.</label>
          <button type="button" className="button" disabled={busy || dossier.blocked || !reviewed || !!dossier.reviewableWarnings?.length && !warningsReviewed} onClick={() => void run(async () => {
            const opened = await claimAction<{ sessionId: string; step?: ClaimStep }>(config, "open", { expenseId, insurer, historyReviewed: reviewed, warningsReviewed }); setSessionId(opened.sessionId);
            if (opened.step) acceptStep(opened.step);
            setMessage(opened.step?.status === "fields"
              ? "The claim form is open on your PC. Review the suggested values below, then select Fill reviewed fields."
              : opened.step?.status === "login-required"
                ? "Complete sign-in in the preparation window on your PC, then select Read current form fields."
                : "The preparation window is open on your PC. Open the claim form there, then select Read current form fields.");
          })}>Open preparation window on PC</button>
        </>}
        {!!sessionId && <>
          <button type="button" className="button secondary" disabled={busy} onClick={() => void run(inspect)}>Read current form fields</button>
          {verification && <section aria-label="Verified portal answers">
            <Notice error={!verification.readyForManualNext || pendingFields || !step}>{!step ? "Do not choose Next yet. Read the refreshed form before continuing." : pendingFields ? "Do not choose Next yet. Review the remaining portal fields below and validate the next fill." : verification.readyForManualNext ? "Every approved answer matches the portal. Complete any manual fields before choosing Next yourself." : "Do not choose Next yet. Correct or re-read the unverified answers or upload below."}</Notice>
            {verification.fields.map(f => <Notice key={f.key} error={f.status !== "match"}>{f.status === "match" ? "✓ Verified match" : f.status === "mismatch" ? "Mismatch" : f.status === "not-filled" ? "Not filled yet" : "Unreadable / changed field"}: {f.label}. Approved: {f.optionLabel || f.value}. {f.actual != null && f.status !== "match" ? `Portal: ${f.actual || "blank"}.` : ""}</Notice>)}
            {verification.attachment && <Notice error={verification.attachment.status !== "verified"}>{verification.attachment.status === "verified" ? "✓ Upload success observed" : verification.attachment.status === "failed" ? "Upload failed" : "Upload unverified"}: {verification.attachment.name}. File selection alone does not verify upload.</Notice>}
            <p className="privacy-note">{verification.scope}</p>
            <button type="button" className="button secondary" disabled={busy} onClick={() => void run(async () => { setVerification(undefined); setVerification(await claimAction<ClaimVerification>(config, "verify", { sessionId })); })}>Re-read filled answers to verify</button>
          </section>}
          {step?.status === "login-required" && <p>Complete sign-in in the insurer window, then read the form fields again.</p>}
          {step?.status === "navigate" && <p>Open a new claim in the insurer window. FamilyHub only reads visible labelled fields.</p>}
          {step?.status === "review" && <Notice>Final review reached. Check all information in the insurer window. FamilyHub stops here; only you can submit.</Notice>}
          {step?.status === "complete" && <Notice>The portal shows a processed or submitted claim. Refresh Blue Cross from Sources &amp; sync to preview its result in FamilyHub.</Notice>}
          {(step?.status === "fields" || step?.status === "review" && step.fields.some(f => f.type === "file")) && <>
            <p>Check each value before filling. The service options below come from this insurer’s current form; uncertain mappings are left for you to select.</p>
            {step.fields.filter(f => f.type !== "file" && f.kind).map(f => <div key={f.key}><label>{f.label}{["select", "combo", "provider"].includes(f.type) ? <select value={values[f.key] || ""} onChange={e => { setValues(v => ({ ...v, [f.key]: e.target.value })); setAnswersReviewed(false); }}><option value="">Choose / leave unchanged</option>{f.options.filter(o => o.value).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select> : <input type={f.type === "date" ? "date" : "text"} value={values[f.key] || ""} onChange={e => { setValues(v => ({ ...v, [f.key]: e.target.value })); setAnswersReviewed(false); }} />}</label>{f.suggestionReason && <p className="privacy-note">{f.suggestionReason}</p>}</div>)}
            {step.fields.filter(f => !f.kind && f.type !== "file").map(f => <p key={f.key}>{f.label}: complete this directly in the portal. FamilyHub leaves it unchanged.</p>)}
            {step.fields.filter(f => f.type === "file").length === 1 && <label>Invoice PDF<select value={attachment} onChange={e => { setAttachment(e.target.value); setUploadConfirmed(false); setAnswersReviewed(false); }}><option value="">Choose / do not upload</option>{dossier.attachments.map(a => <option key={`${a.documentId}:${a.attachmentId}`} value={`${a.documentId}:${a.attachmentId}`}>{a.name}</option>)}</select></label>}
            {step.serviceChoices?.warning && <Notice error>{step.serviceChoices.warning}</Notice>}
            {step.serviceChoices?.available && step.fields.some(f => ["service", "benefit"].includes(f.kind || "")) && <>
              <label className="prepare-check"><input type="checkbox" checked={rememberServiceChoices} disabled={!step.serviceChoices.scopeComplete} onChange={e => setRememberServiceChoices(e.target.checked)} />Remember confirmed service choices privately for this insurer, clinic and invoice service. Amounts and insurance answers are never remembered.</label>
              {!step.serviceChoices.scopeComplete && <p>Confirm the clinic and invoice service before saving a choice.</p>}
              <button type="button" className="text-action" disabled={busy} onClick={() => void run(async () => { acceptStep(await claimAction<ClaimStep>(config, "forget-service-choices", { sessionId })); setMessage("Saved service choices cleared for this insurer, clinic and invoice service."); })}>Reset saved service choices for this service</button>
              {step.fields.some(f => ["service", "benefit"].includes(f.kind || "") && !f.suggested && f.options.length) && <button type="button" className="button secondary" disabled={busy} onClick={() => void run(async () => { acceptStep(await claimAction<ClaimStep>(config, "suggest-service", { sessionId, revision: step.revision })); })}>Suggest service from invoice with Codex</button>}
            </>}
            {attachment && insurer === "blue-cross" && <label className="prepare-check"><input type="checkbox" checked={uploadConfirmed} onChange={e => setUploadConfirmed(e.target.checked)} />Upload this selected original PDF to Blue Cross. It becomes a permanent claims record and cannot be removed.</label>}
            <label className="prepare-check"><input type="checkbox" checked={answersReviewed} onChange={e => setAnswersReviewed(e.target.checked)} />I reviewed every proposed answer and the selected document for this step. Fill only these reviewed values.</label>
            <button type="button" className="button" disabled={busy || !answersReviewed || !Object.values(values).some(Boolean) && !attachment || !!attachment && insurer === "blue-cross" && !uploadConfirmed} onClick={() => void run(async () => {
              const result = await claimAction<{ message: string; verification?: ClaimVerification }>(config, "fill", { sessionId, revision: step.revision, values, attachment: attachment || null, uploadConfirmed, answersReviewed, rememberServiceChoices: !!step.serviceChoices?.scopeComplete && rememberServiceChoices });
              setMessage(result.message); setVerification(result.verification); setStep(undefined); setValues({}); setAttachment(""); setUploadConfirmed(false); setAnswersReviewed(false);
              try {
                const next = await claimAction<ClaimStep>(config, "inspect", { sessionId });
                acceptStep(next, true);
                if (next.status === "fields" && next.fields.some(f => f.type !== "file")) setMessage("The portal refreshed. Review the remaining answers below, then select Valider et préremplir again. Existing portal values are preserved.");
              } catch {
                setMessage("The reviewed fill finished, but the refreshed form could not be read. Select Read current form fields before continuing; do not repeat the previous fill.");
              }
            })}>Valider et préremplir{attachment ? " et joindre le PDF" : ""}</button>
          </>}
          <p className="privacy-note">Review the filled fields in the insurer window. Click Next yourself, then read the next step here. Closing this panel does not close that window. The preparation session expires after 30 minutes.</p>
          <button type="button" className="text-action" disabled={busy} onClick={() => void run(async () => { await claimAction(config, "close", { sessionId }); setSessionId(""); setStep(undefined); setMessage("Preparation window closed. No claim was submitted by FamilyHub."); })}>Close preparation window</button>
        </>}
      </>}
    </div>
  </Sheet>;
}
