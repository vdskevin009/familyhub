import { useEffect, useRef, useState } from "react";
import type { WorkerConfig } from "../types";
import { claimAction, viewWorkerAttachment, type ClaimPreparation, type ClaimStep, type ClaimVerification, type PreparedClaim } from "../worker";
import { Notice, Sheet } from "../ui/primitives";
import { claimBlockingReasons, claimMissingAmountReason } from "../claim-block-reasons";

export default function PrepareClaim({ expenseId, initialInsurer, config, onClose }: { expenseId: string; initialInsurer?: "blue-cross" | "desjardins"; config: WorkerConfig; onClose: () => void }) {
  const [insurer, setInsurer] = useState<"" | "blue-cross" | "desjardins">(initialInsurer || "");
  const [dossier, setDossier] = useState<ClaimPreparation>();
  const [sessionId, setSessionId] = useState("");
  type WindowState = { sessionId: string | null; insurer: string | null; canClose: boolean; busy: boolean; expired: boolean };
  const [windowState, setWindowState] = useState<WindowState>();
  const [restartAvailable, setRestartAvailable] = useState(false);
  async function findWindow() {
    const found = await claimAction<WindowState>(config, "window", {}); setWindowState(found);
    if (!found.sessionId && !found.busy) { setSessionId(""); setRestartAvailable(true); }
    if (!found.sessionId) setMessage(found.busy ? "Preparation is still opening. Wait, then check again." : "No preparation window is controlled by this PC worker. An active collection must finish; an interrupted lock needs local recovery.");
    return found;
  }
  const [step, setStep] = useState<ClaimStep>();
  const [verification, setVerification] = useState<ClaimVerification>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [attachment, setAttachment] = useState("");
  const [reviewed, setReviewed] = useState(false), [validated, setValidated] = useState(false);
  const [rememberServiceChoices, setRememberServiceChoices] = useState(false);
  const [illness, setIllness] = useState(""), [illnessConfirmed, setIllnessConfirmed] = useState(false);
  const [allInvoices, setAllInvoices] = useState(false);
  const [ownerAmount, setOwnerAmount] = useState(""), [ownerReason, setOwnerReason] = useState(""), [ownerReviewed, setOwnerReviewed] = useState(false);
  const [busy, setBusy] = useState(true), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [uploadWatch, setUploadWatch] = useState(0);
  useEffect(() => {
    if (!error) return;
    let active = true;
    void claimAction<WindowState>(config, "window", {}).then(found => { if (active) { setWindowState(found); if (!found.sessionId && !found.busy) { setSessionId(""); setRestartAvailable(true); } } }).catch(() => {});
    return () => { active = false; };
  }, [error, config.Endpoint, config.ApiKey]);

  const actionEpoch = useRef(0);
  const opening = useRef<{ key: string; promise: Promise<PreparedClaim> } | undefined>(undefined);
  const activeSession = useRef(""); activeSession.current = sessionId;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function accept(result: PreparedClaim) {
    actionEpoch.current++;
    setRestartAvailable(false); setWindowState(undefined);
    setDossier(result.preparation); setSessionId(result.sessionId || ""); setStep(result.step); setVerification(result.verification);
    setValues({}); setAttachment(""); setReviewed(false); setValidated(false); setMessage(result.warning || "");
    setIllness((allInvoices ? result.step.confirmedIllness?.defaultValue : result.step.confirmedIllness?.value) || ""); setIllnessConfirmed(false);
    setOwnerAmount(result.preparation.coordination?.ownerConfirmation ? String(result.preparation.coordination.ownerConfirmation.amount) : "");
    setOwnerReason(result.preparation.coordination?.ownerConfirmation?.reason || ""); setOwnerReviewed(false);
  }
  useEffect(() => {
    if (!insurer) { setBusy(false); return; }
    let active = true;
    const key = JSON.stringify([expenseId, insurer, config.Endpoint, config.ApiKey]);
    setBusy(true); setError(""); setStep(undefined); setVerification(undefined); setValidated(false);
    // StrictMode must not turn one click into two login/upload requests.
    if (opening.current?.key !== key) opening.current = { key, promise: claimAction<PreparedClaim>(config, "prepare", { expenseId, insurer, prepareAuthorized: true }) };
    opening.current.promise.then(result => { if (active) accept(result); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : "Preparation did not finish. Check the PC window; do not repeat an uncertain upload."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [expenseId, insurer, config.Endpoint, config.ApiKey]);
  useEffect(() => {
    if (busy || !sessionId || !step || !["login-required", "human-required"].includes(step.status)) return;
    const timer = window.setTimeout(() => {
      const current = () => mounted.current && activeSession.current === sessionId;
      setBusy(true); setError("");
      void claimAction<ClaimStep>(config, "inspect", { sessionId }).then(async fresh => {
        if (!current()) return;
        if (fresh.status === "fields") {
          const prepared = await claimAction<PreparedClaim>(config, "resume", { sessionId, prepareAuthorized: true });
          if (current()) accept(prepared);
        } else setStep(fresh);
      }).catch(e => {
        if (current()) { setStep(undefined); setError(e instanceof Error ? e.message : "Could not re-read sign-in. Resume preparation when ready."); }
      }).finally(() => { if (current()) setBusy(false); });
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [busy, sessionId, step, config.Endpoint, config.ApiKey]);
  useEffect(() => {
    if (busy || !sessionId || !verification || verification.receiptUploadAvailable === undefined || verification.attachment
      || !step || !["fields", "navigate"].includes(step.status)) return;
    let active = true;
    const epoch = actionEpoch.current;
    const initiated = () => mounted.current && activeSession.current === sessionId && actionEpoch.current === epoch;
    const current = () => active && initiated();
    const timer = window.setTimeout(() => {
      void claimAction<ClaimVerification>(config, "verify", { sessionId }).then(async fresh => {
        if (!current() || !fresh.receiptUploadAvailable) return;
        setBusy(true);
        try { const prepared = await claimAction<PreparedClaim>(config, "resume", { sessionId, prepareAuthorized: true }); if (initiated()) accept(prepared); }
        catch (e) { if (initiated()) { setVerification(undefined); setError(e instanceof Error ? e.message : "Receipt preparation could not be verified. Read the portal; do not repeat the upload."); } }
        finally { if (mounted.current && activeSession.current === sessionId) setBusy(false); }
      }).catch(() => { /* Read-only watch must not clear a manual answer or repeat an upload. */ })
        .finally(() => { if (current()) setUploadWatch(value => value + 1); });
    }, 5000);
    return () => { active = false; window.clearTimeout(timer); };
  }, [busy, sessionId, step, verification, uploadWatch, config.Endpoint, config.ApiKey]);
  async function run(action: () => Promise<void>) {
    actionEpoch.current++;
    setBusy(true); setError(""); setValidated(false); setReviewed(false);
    try { await action(); } catch (e) { setStep(undefined); setVerification(undefined); setError(e instanceof Error ? e.message : "Preparation failed. Re-read the portal before continuing."); }
    finally { setBusy(false); }
  }
  const answerFields = step?.fields.filter(f => f.kind && !["file", "checkbox"].includes(f.type)) || [];
  const confirmationFields = step?.fields.filter(f => f.type === "checkbox") || [];
  const chooseReceipt = step?.fields.filter(f => f.type === "file").length === 1 && !verification?.attachment;
  const summaryPage = step?.portalStage === "expense-summary";
  const pending = !!step?.fields.some(f => f.type !== "file" && !f.optional);
  const canReview = !!verification?.readyForManualNext && !!step && !pending && ["fields", "navigate"].includes(step.status);
  const labels: Record<string, string> = { patient: "Patient", provider: "Clinic / provider", practitioner: "Practitioner", serviceDate: "Service date", originalAmount: "Original expense", service: "Invoice service", invoiceNumber: "Invoice number", otherInsurance: "Other insurance", otherInsurancePaid: "Paid by other insurer" };
  return <Sheet open onClose={busy ? () => {} : onClose} title={insurer === "blue-cross" ? "Prepare Blue Cross claim" : insurer === "desjardins" ? "Prepare Desjardins claim" : "Prepare claim"} description={verification?.preparedForReview&&verification.receiptRequirement === "not-requested-before-confirmation" ? "The insurer form is ready. Review the values and confirm in Desjardins." : "The PC prepares the insurer form and original receipt. Review the actual results before continuing."}>
    <div className="prepare-claim">
      <label>Insurer<select value={insurer} disabled={busy || !!sessionId} onChange={e => setInsurer(e.target.value as typeof insurer)}><option value="" disabled>Choose insurer</option><option value="blue-cross">Blue Cross</option><option value="desjardins">Desjardins</option></select></label>
      {!insurer && <Notice>The next insurer is unknown. Choose where to prepare this invoice before opening its portal.</Notice>}
      {busy && <p role="status">Preparing and reading back the insurer form…</p>}
      {error && <Notice error>{error}</Notice>}{message && <Notice>{message}</Notice>}
      {(!!sessionId || !!windowState?.sessionId) && <details open={!verification?.preparedForReview}>
        <summary>Preparation window</summary>
        <p>Close the {windowState?.insurer === "desjardins" ? "Desjardins" : windowState?.insurer === "blue-cross" ? "Blue Cross" : "insurer"} preparation window to start again. An uploaded receipt may remain with the insurer; closing does not submit or cancel a claim.</p>
        <button type="button" className="button secondary" disabled={busy || windowState?.busy === true} onClick={() => void run(async () => {
          await claimAction(config, "close", { sessionId: windowState?.sessionId || sessionId });
          setSessionId(""); activeSession.current = ""; setStep(undefined); setVerification(undefined); setWindowState(undefined); opening.current = undefined;
          setRestartAvailable(true); setMessage("Preparation window closed and its lock released. Existing receipt-upload safeguards are preserved.");
        })}>Close preparation window</button>
      </details>}
      {(error || windowState?.busy || windowState && !windowState.sessionId) && <button type="button" className="text-action" disabled={busy} onClick={() => void run(async () => { await findWindow(); })}>Check active preparation window</button>}
      {error && windowState && !windowState.sessionId && <p>{windowState.busy ? "The PC is still opening a preparation. Check again when it finishes." : "There is no preparation window this worker can close. Let an active collection finish; an interrupted lock requires local recovery."}</p>}
      {restartAvailable && <button type="button" className="button" disabled={busy || !insurer} onClick={() => void run(async () => {
        setRestartAvailable(false); accept(await claimAction<PreparedClaim>(config, "prepare", { expenseId, insurer, prepareAuthorized: true }));
      })}>Start preparation again</button>}
      {dossier && <>
        {claimBlockingReasons(dossier).map(reason => <Notice key={reason} error>{reason}</Notice>)}
        {claimMissingAmountReason(dossier) && <Notice warning>{claimMissingAmountReason(dossier)}</Notice>}
        {dossier.coordination?.message && <Notice>{dossier.coordination.message}</Notice>}
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

        <details><summary>Invoice evidence and original receipt</summary>
          <dl className="claim-preparation-facts">{Object.entries(dossier.fields).map(([key, value]) => <div key={key}><dt>{labels[key] || key}</dt><dd>{value == null ? "Unknown — left blank" : String(value)}</dd></div>)}</dl>
          {dossier.attachments.map(a => <button key={`${a.documentId}:${a.attachmentId}`} type="button" className="text-action" disabled={busy} onClick={() => void run(() => viewWorkerAttachment(config, { Id: a.documentId, Attachments: [{ Id: a.attachmentId, FileName: a.name, MimeType: "application/pdf", Size: 0 }] }, 0))}>Review PDF · {a.name}</button>)}
          <p>{dossier.duplicate.scope}</p>
        </details>
        {dossier.conflicts.map(c => <Notice key={c} error={!dossier.reviewableWarnings?.includes(c)} warning={dossier.reviewableWarnings?.includes(c)}>{c}</Notice>)}
        {dossier.attachments.length > 1 && !verification?.receiptCopiesEquivalent && <p>Several original PDFs are indexed. Choose the correct receipt when its upload field is available.</p>}
        {!!sessionId && <>
          <button type="button" className="button secondary" disabled={busy} onClick={() => void run(async () => { accept(await claimAction<PreparedClaim>(config, "resume", { sessionId, prepareAuthorized: true })); })}>{verification?.preparedForReview ? "Recheck final review" : "Read and prepare current step"}</button>
          {step?.status === "human-required" && <Notice>Complete the verification challenge in the insurer window. Preparation resumes automatically when the form becomes available.</Notice>}
          {step?.status === "login-required" && <Notice>Sign-in needs attention on the PC{step.authReason ? ` (${step.authReason})` : ""}. Complete sign-in in that window; preparation resumes automatically.</Notice>}
          {step?.status === "navigate" && !summaryPage && <p>Open the claim form in the insurer window, then read and prepare the current step.</p>}
          {summaryPage && <Notice>The insurer expense summary is open. FamilyHub must match this summary to the invoice and the verified details before continuing. The earlier form controls are no longer on this page.</Notice>}
          {step?.status === "inspect-required" && <Notice error>The portal changed during preparation. Re-read it before continuing.</Notice>}
          {step?.status === "review" && <Notice>{verification?.receiptRequirement === "not-requested-before-confirmation"
            ? "Review the final claim in Desjardins. Confirmer accepts the terms and sends your claim. No receipt upload is offered on this screen; the original remains available in FamilyHub."
            : "Review the final claim in the insurer window. FamilyHub may attach the original receipt, but only you may accept the attestation and submit. FamilyHub validation is not required to continue there."}</Notice>}
          {step?.status === "complete" && <Notice>The portal reports completion. FamilyHub did not submit this claim.</Notice>}
          {step?.answerWarning && <Notice error>{step.answerWarning}</Notice>}
          {step?.confirmedIllness && !["review", "complete"].includes(step.status) && <details>
            <summary>Illness or injury</summary>
            <label>Reuse answer for<select value={allInvoices ? "all" : "invoice"} onChange={e => {
              const all = e.target.value === "all"; setAllInvoices(all); setIllnessConfirmed(false);
              setIllness((all ? step.confirmedIllness?.defaultValue : step.confirmedIllness?.value) || "");
            }}><option value="invoice">This invoice only</option><option value="all">All invoices — default</option></select></label>
            <label>Your answer<input value={illness} maxLength={500} onChange={e => { setIllness(e.target.value); setIllnessConfirmed(false); }} /></label>
            <p>{allInvoices ? "Saved privately as the default for all invoices and both insurers. An invoice-specific answer takes priority." : "Saved privately for this exact invoice and insurer. Clearing it also disables the default for this invoice."} An answer already entered in the portal is preserved.</p>
            {step.confirmedIllness.source === "default" && <p>This invoice currently uses your default answer.</p>}
            <label className="prepare-check"><input type="checkbox" checked={illnessConfirmed} onChange={e => setIllnessConfirmed(e.target.checked)} />{allInvoices ? "I confirm this answer should be the default for all my invoices." : "I confirm this is my answer for this invoice and want it reused during preparation."}</label>
            <button type="button" className="button secondary" disabled={busy || !illnessConfirmed || !illness.trim()} onClick={() => void run(async () => {
              await claimAction(config, "invoice-answer", { expenseId, insurer, action: "save", value: illness, confirmed: true, allInvoices,
                expectedScope: allInvoices ? step.confirmedIllness!.defaultScope : step.confirmedIllness!.scope,
                expectedRevision: allInvoices ? step.confirmedIllness!.defaultRevision : step.confirmedIllness!.revision });
              accept(await claimAction<PreparedClaim>(config, "resume", { sessionId, prepareAuthorized: true }));
            })}>{allInvoices ? "Save default and prepare" : "Save for this invoice and prepare"}</button>
            {(allInvoices ? step.confirmedIllness.defaultValue : step.confirmedIllness.value) && <button type="button" className="text-action" disabled={busy} onClick={() => void run(async () => {
              await claimAction(config, "invoice-answer", { expenseId, insurer, action: "remove", confirmed: true, allInvoices,
                expectedScope: allInvoices ? step.confirmedIllness!.defaultScope : step.confirmedIllness!.scope,
                expectedRevision: allInvoices ? step.confirmedIllness!.defaultRevision : step.confirmedIllness!.revision });
              const fresh = await claimAction<ClaimStep>(config, "inspect", { sessionId }); setStep(fresh); setIllness(""); setIllnessConfirmed(false); setVerification(undefined);
              setMessage("Saved answer cleared. The current portal value was left unchanged.");
            })}>{allInvoices ? "Clear default answer" : "Clear saved invoice answer"}</button>}
          </details>}
          {step?.confirmedPractitioner?.value && <details><summary>Practitioner confirmed for this invoice</summary>
            <p>{step.confirmedPractitioner.value}. Your invoice-specific answer; the original receipt and source records are unchanged.</p>
            <button type="button" className="text-action" disabled={busy} onClick={() => void run(async () => {
              await claimAction(config, "practitioner-answer", { expenseId, insurer, action: "remove", confirmed: true, expectedScope: step.confirmedPractitioner!.scope, expectedRevision: step.confirmedPractitioner!.revision });
              setStep(await claimAction<ClaimStep>(config, "inspect", { sessionId })); setVerification(undefined); setMessage("Saved practitioner cleared. The current portal selection was preserved.");
            })}>Clear saved practitioner for this invoice</button>
          </details>}
          {step?.serviceChoices?.scopeComplete && <button type="button" className="text-action" disabled={busy} onClick={() => void run(async () => {
            setStep(await claimAction<ClaimStep>(config, "forget-service-choices", { sessionId })); setVerification(undefined); setMessage("Saved service choices cleared. Existing portal values remain unchanged.");
          })}>Reset saved service choices for this service</button>}
          {verification && <section aria-label="Prepared portal answers">
            <strong>Actually prepared in the portal</strong>
            {verification.expenseSummary && <Notice error={!verification.expenseSummary.matches}>
              {verification.preparedForReview ? verification.receiptRequirement === "not-requested-before-confirmation"
                ? "Ready for your final review — no receipt upload is requested on this screen. Confirm in Desjardins yourself."
                : "Ready for your final review — receipt upload verified. Consent and submission remain yours." : "Current insurer summary"}
              <dl className="claim-preparation-facts">{Object.entries(verification.expenseSummary).filter(([key]) => key !== "matches").map(([key, value]) => <div key={key}><dt>{({ patient: "Patient", benefit: "Benefit", practitioner: "Practitioner", service: "Service", date: "Date", amount: "Expense", illness: "Your illness/injury answer", duration: "Duration", otherInsurancePaid: "Other-insurer payment", remaining: "Amount to claim", accident: "Accident", governmentReimbursement: "Government reimbursement", privateInsuranceClaim: "Other private claim", otherInsurance: "Prior reimbursement", reimbursementMethod: "Reimbursement method" } as Record<string, string>)[key] || key}</dt><dd>{value ?? "Not verified"}</dd></div>)}</dl>
            </Notice>}
            {(step?.status === "review" || summaryPage) && verification.fields.some(f => f.status === "unreadable") && <p>The earlier form controls are no longer on this page. Check those answers in the insurer's final claim summary.</p>}
            {verification.fields.filter(f => step?.status !== "review" && !summaryPage || f.status !== "unreadable").map(f => <Notice key={f.key} error={f.status !== "match"}>{f.label}: {f.status === "match" ? f.optionLabel || f.actual : f.actual ?? "Unreadable"}. {f.status === "match" ? "✓ Read back and matched" : `Needs attention — ${f.status}; expected ${f.optionLabel || f.value}`}</Notice>)}
            {verification.attachment && <Notice error={verification.attachment.status !== "verified"}>{verification.attachment.name}: {verification.attachment.blocked ? "Not attached — an earlier upload attempt is recorded or its guard is unavailable. Review the prior claim before authorizing recovery." : verification.attachment.selected === false ? "Not selected; no upload success observed." : verification.attachment.status === "verified" ? "✓ Upload success observed" : verification.attachment.status === "failed" ? "Upload failed" : "Selected; upload not yet verified. Do not upload again."}</Notice>}
            {verification.attachment?.blocked && <><p>The earlier file may remain in Blue Cross. Use recovery only after checking that the earlier claim was not submitted and this preparation has no receipt. This sends the original PDF once to the current preparation.</p><button type="button" className="button secondary" disabled={busy} onClick={() => void run(async () => { accept(await claimAction<PreparedClaim>(config, "retry-receipt", { sessionId, revision: verification.revision, receiptName: verification.attachment!.name, retryReviewed: true, prepareAuthorized: true })); })}>Attach receipt to this preparation</button></>}

            <p className="privacy-note">{verification.scope}</p>
          </section>}
          {step && (!!answerFields.length || !!confirmationFields.length || chooseReceipt) && <section aria-label="Uncertain or missing answers">
            <strong>Answers still needed</strong>
            {answerFields.map(f => <label key={f.key}>{f.label}{["select", "combo", "provider", "radio"].includes(f.type) ? <select value={values[f.key] || ""} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}><option value="">Choose / leave blank</option>{f.options.filter(o => o.value).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select> : <input type={f.type === "date" ? "date" : "text"} value={values[f.key] || ""} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))} />}{f.suggestionReason && <small>{f.suggestionReason}</small>}</label>)}
            {confirmationFields.map(f => <p key={f.key}>{f.label}: review the original PDF and complete this confirmation in the insurer window.</p>)}
            {chooseReceipt && <label>Original receipt<select value={attachment} onChange={e => setAttachment(e.target.value)}><option value="">Choose / leave unchanged</option>{dossier.attachments.map(a => <option key={`${a.documentId}:${a.attachmentId}`} value={`${a.documentId}:${a.attachmentId}`}>{a.name}</option>)}</select></label>}
            {step.fields.some(f => ["service", "benefit"].includes(f.kind || "")) && <label className="prepare-check"><input type="checkbox" checked={rememberServiceChoices} onChange={e => setRememberServiceChoices(e.target.checked)} />Remember my service choice privately for this insurer, clinic and invoice service.</label>}
            {(!!answerFields.length || chooseReceipt) && <button type="button" className="button" disabled={busy || !Object.values(values).some(Boolean) && !attachment} onClick={() => void run(async () => { accept(await claimAction<PreparedClaim>(config, "correct", { sessionId, revision: step.revision, values, attachment: attachment || null, prepareAuthorized: true, rememberServiceChoices })); })}>Prepare these answers{attachment ? " and attach receipt" : ""}</button>}
          </section>}
          {step?.fields.filter(f => !f.kind && f.type !== "file").map(f => <p key={f.key}>{f.label}: {f.optional ? "optional; leave blank if it does not apply, or complete it in the insurer window." : "complete this directly in the insurer window."}</p>)}
          {verification && step?.status !== "review" && step?.status !== "complete" && !summaryPage && <>
            <label className="prepare-check"><input type="checkbox" checked={reviewed} disabled={busy || !canReview} onChange={e => { setReviewed(e.target.checked); setValidated(false); }} />I checked the prepared values, remaining manual fields, original receipt and current insurer history, including pending claims.</label>
            <button type="button" className="button" disabled={busy || !reviewed || !canReview} onClick={() => void run(async () => {
              const fresh = await claimAction<{ step: ClaimStep; verification: ClaimVerification }>(config, "validate", { sessionId, revision: verification.revision, answersReviewed: true });
              setStep(fresh.step); setVerification(fresh.verification); setReviewed(fresh.verification.readyForManualNext); setValidated(fresh.verification.readyForManualNext);
            })}>Validate prepared step</button>
            {validated && <Notice>Prepared values rechecked. {insurer === "blue-cross" ? "Use Read and prepare current step to continue the verified preparation." : "You may choose Next in the insurer window, then prepare its next step here."} Final attestation and submission remain yours.</Notice>}
          </>}
          <p className="privacy-note">Preparation may attach the original receipt to the insurer record. Known Blue Cross preparation steps may advance after verified read-back. Final consent and submission remain yours. Closing this panel keeps the PC window open for up to 30 minutes.</p>

        </>}
      </>}
    </div>
  </Sheet>;
}
