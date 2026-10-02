import { useEffect, useState } from "react";
import type { WorkerConfig } from "../types";
import { claimAction, viewWorkerAttachment, downloadWorkerAttachment, type ClaimPreparation, type ClaimStep } from "../worker";
import { Notice, Sheet } from "../ui/primitives";

export default function PrepareClaim({ expenseId, config, onClose, initialInsurer = "blue-cross" }: { expenseId: string; config: WorkerConfig; onClose: () => void; initialInsurer?: "blue-cross" | "desjardins" }) {
  const [insurer, setInsurer] = useState<"blue-cross" | "desjardins">(initialInsurer);
  const [dossier, setDossier] = useState<ClaimPreparation>();
  const [reviewed, setReviewed] = useState(false);
  const [warningsReviewed, setWarningsReviewed] = useState(false), [uploadConfirmed, setUploadConfirmed] = useState(false);
  const [reason, setReason] = useState(() => { try { return localStorage.getItem("familyhub.claim-reason.v1") || ""; } catch { return ""; } });
  const [rememberReason, setRememberReason] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [step, setStep] = useState<ClaimStep>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [attachment, setAttachment] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    setDossier(undefined); setReviewed(false); setWarningsReviewed(false); setStep(undefined); setValues({}); setAttachment(""); setUploadConfirmed(false); setMessage(""); setError(""); setBusy(true);
    claimAction<ClaimPreparation>(config, "preview", { expenseId, insurer }).then(value => { if (active) setDossier(value); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : "Preparation failed."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [expenseId, insurer, config.Endpoint, config.ApiKey]);
  async function run(action: () => Promise<void>) { setBusy(true); setError(""); setMessage(""); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Preparation failed."); } finally { setBusy(false); } }
  async function inspect() {
    const next = await claimAction<ClaimStep>(config, "inspect", { sessionId });
    setStep(next); setValues(Object.fromEntries(next.fields.filter(f => f.suggested != null || f.kind === "natureOfIllness" && reason).map(f => [f.key, f.suggested ?? reason]))); setAttachment(""); setUploadConfirmed(false);
  }
  function receiptSource(a: ClaimPreparation["attachments"][number]) { return { Id: a.documentId, Attachments: [{ Id: a.attachmentId, FileName: a.name, MimeType: "application/pdf", Size: 0 }] }; }
  return <Sheet open onClose={onClose} title={insurer === "blue-cross" ? "Prepare Blue Cross claim" : "Prepare Desjardins claim"} description="Review the receipt and amounts, then fill the insurer form on your PC.">
    <div className="prepare-claim">
      <label>Insurer<select value={insurer} disabled={busy || !!sessionId} onChange={e => setInsurer(e.target.value as typeof insurer)}><option value="blue-cross">Blue Cross</option><option value="desjardins">Desjardins</option></select></label>
      {error && <Notice error>{error}</Notice>}{message && <Notice>{message}</Notice>}
      {busy && <p role="status">Checking…</p>}
      {dossier && <>
        <dl className="claim-preparation-facts">{Object.entries(dossier.fields).map(([key, value]) => <div key={key}><dt>{({ patient: "Patient", provider: "Clinic / provider", practitioner: "Practitioner", serviceDate: "Service date", originalAmount: "Original expense", service: "Invoice service", invoiceNumber: "Invoice number", otherInsurance: "Submitted to other insurer", otherInsurancePaid: `Paid by ${dossier.otherInsurer === "desjardins" ? "Desjardins" : "Blue Cross"}` } as Record<string, string>)[key]}</dt><dd>{value == null ? "To confirm" : typeof value === "number" ? `${value.toFixed(2)} ${dossier.currency || "(currency to confirm)"}` : String(value)}</dd></div>)}</dl>
        <section aria-label="Original receipts"><strong>Original receipt</strong>{dossier.attachments.length ? dossier.attachments.map((a, i) => <div key={`${a.documentId}:${a.attachmentId}`}><span>{a.name}{dossier.attachments.filter(b => b.name === a.name).length > 1 ? ` · source ${i + 1}` : ""}</span><div><button type="button" className="text-action" disabled={busy} onClick={() => void run(() => viewWorkerAttachment(config, receiptSource(a), 0))}>Review PDF</button><button type="button" className="text-action" disabled={busy} onClick={() => void run(() => downloadWorkerAttachment(config, receiptSource(a), 0))}>Download receipt</button></div></div>) : <p>No original PDF is indexed. Find the original receipt before uploading documents.</p>}</section>
        <Notice error={dossier.blocked}>{dossier.duplicate.status === "recorded" ? "This insurer has already processed or recorded this expense. Review the existing claim instead of submitting it again." : dossier.duplicate.status === "possible" ? "A same-day insurer record may be this expense. Resolve that possible duplicate first." : "No duplicate was identified in saved records. Check the insurer’s current history, including pending claims, before continuing."}</Notice>
        {!!dossier.missing.length && <p>Missing source fields: {dossier.missing.join(", ")}. Confirm these from the invoice.</p>}
        {dossier.conflicts.map(c => <p key={c}>{c}</p>)}
        {!!dossier.reviewableWarnings?.length && <label className="prepare-check"><input type="checkbox" checked={warningsReviewed} disabled={!!sessionId || busy} onChange={e => setWarningsReviewed(e.target.checked)} />I reviewed the original PDF and confirmed the gross expense and other-insurer payment shown above. The conflicting extracted copy remains unchanged in FamilyHub.</label>}
        <details><summary>Source emails and duplicate-check details</summary><p>{dossier.duplicate.scope}</p>{dossier.sourceEmails.map(s => <p key={s.messageId}><a href={`https://mail.google.com/mail/u/?authuser=${encodeURIComponent(s.account)}#all/${encodeURIComponent(s.messageId)}`} target="_blank" rel="noreferrer">Source email · {s.account}</a></p>)}{dossier.duplicate.records.map(r => <p key={r.id}>{r.reference || "Recorded claim"} · {r.service || "Service to confirm"} · {r.status}</p>)}</details>
        {!sessionId && <>
          {insurer === "blue-cross" && <><label>Nature of illness / injury<input value={reason} placeholder="Enter your answer, for example Back pain" onChange={e => setReason(e.target.value)} maxLength={500} /></label><label className="prepare-check"><input type="checkbox" checked={rememberReason} onChange={e => setRememberReason(e.target.checked)} />Remember this answer on this device for review on future claims.</label></>}
          <a className="button secondary" href={dossier.portalUrl} target="_blank" rel="noreferrer">Open insurer to check history</a>
          <label className="prepare-check"><input type="checkbox" disabled={dossier.blocked} checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I checked the current insurer history: this invoice has not already been claimed with this insurer.</label>
          <button type="button" className="button" disabled={busy || dossier.blocked || !reviewed || !!dossier.reviewableWarnings?.length && !warningsReviewed} onClick={() => void run(async () => {
            if (rememberReason) { try { localStorage.setItem("familyhub.claim-reason.v1", reason); } catch { /* Optional device preference. */ } }
            const opened = await claimAction<{ sessionId: string }>(config, "open", { expenseId, insurer, historyReviewed: reviewed, warningsReviewed }); setSessionId(opened.sessionId);
            setMessage("A preparation window opened on the PC running FamilyHub. Sign in if needed and navigate to the claim form, then inspect its fields here.");
          })}>Open preparation window on PC</button>
        </>}
        {!!sessionId && <>
          <button type="button" className="button secondary" disabled={busy} onClick={() => void run(inspect)}>Read current form fields</button>
          {step?.status === "login-required" && <p>Complete sign-in in the insurer window, then read the form fields again.</p>}
          {step?.status === "navigate" && <p>Open a new claim in the insurer window. FamilyHub only reads visible labelled fields.</p>}
          {step?.status === "review" && <Notice>Final review reached. Check all information in the insurer window. FamilyHub stops here; only you can submit.</Notice>}
          {step?.status === "complete" && <Notice>The portal shows a processed or submitted claim. Refresh {insurer === "blue-cross" ? "Blue Cross" : "Desjardins"} from Sources &amp; sync to preview its result in FamilyHub.</Notice>}
          {(step?.status === "fields" || step?.status === "review" && step.fields.some(f => f.type === "file")) && <>
            <p>Check each value before filling. The service options below come from this insurer’s current form; uncertain mappings are left for you to select.</p>
            {step.fields.filter(f => f.type !== "file" && f.kind).map(f => <label key={f.key}>{f.label}{["select", "combo", "provider", "radio"].includes(f.type) ? <select value={values[f.key] || ""} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}><option value="">Choose / leave unchanged</option>{f.options.filter(o => o.value).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select> : <input type={f.type === "date" ? "date" : "text"} value={values[f.key] || ""} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))} />}</label>)}
            {step.fields.some(f => !f.kind && f.type !== "file") && <p>Some fields need to be completed directly in the portal; FamilyHub will leave them unchanged.</p>}
            {step.fields.filter(f => f.type === "file").length === 1 && <label>Invoice PDF<select value={attachment} onChange={e => setAttachment(e.target.value)}><option value="">Choose / do not upload</option>{dossier.attachments.map(a => <option key={`${a.documentId}:${a.attachmentId}`} value={`${a.documentId}:${a.attachmentId}`}>{a.name}</option>)}</select></label>}
            {attachment && <label className="prepare-check"><input type="checkbox" checked={uploadConfirmed} onChange={e => setUploadConfirmed(e.target.checked)} />{insurer === "blue-cross" ? "Upload this selected original PDF to Blue Cross. It becomes a permanent claims record and cannot be removed." : "Send this selected original PDF to Desjardins for this claim. I reviewed its document-retention notice in the portal."}</label>}
            <button type="button" className="button" disabled={busy || !Object.values(values).some(Boolean) && !attachment || !!attachment && !uploadConfirmed} onClick={() => void run(async () => {
              const result = await claimAction<{ message: string }>(config, "fill", { sessionId, revision: step.revision, values, attachment: attachment || null, uploadConfirmed });
              setMessage(result.message); setStep(undefined); setValues({}); setAttachment("");
            })}>Fill reviewed fields{attachment ? " and attach PDF" : ""}</button>
          </>}
          <p className="privacy-note">Review the filled fields in the insurer window. Click Next yourself, then read the next step here. Closing this panel does not close that window. The preparation session expires after 30 minutes.</p>
          <button type="button" className="text-action" disabled={busy} onClick={() => void run(async () => { await claimAction(config, "close", { sessionId }); setSessionId(""); setStep(undefined); setMessage("Preparation window closed. No claim was submitted by FamilyHub."); })}>Close preparation window</button>
        </>}
      </>}
    </div>
  </Sheet>;
}
