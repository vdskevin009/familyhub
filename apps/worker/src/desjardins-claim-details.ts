import type { ClaimPreparation } from "./claim-preparation.js";
import { calendarDate } from "./healthcare-evidence.js";
export const desjardinsDetailsPath = "/AGEA-GBIM/Reclamation/DetailFrais_ExpenseDetail.aspx";
const label = (s:string) => s.normalize("NFKC").replace(/^\s*\*/, "").replace(/\(facultatif\)$/, "").replace(/\s+/g," ").trim();
export function desjardinsDetailText(path:string, text:string, name:string, type:string) {
  if (path !== desjardinsDetailsPath) return null;
  const clean = label(text);
  if (type === "text" && clean === "Date des frais" && !name) return {kind:"serviceDate",label:"Date des frais (JJ-MM-AAAA)"};
  if (type === "select" && clean === "Type de frais" && name === "typeFrais") return {kind:"service",label:"Type de frais"};
  if (type === "text" && clean === "Coût du produit ou du service" && name === "montantService") return {kind:"originalAmount",label:"Coût total du produit ou du service",format:"decimal-comma" as const};
  if (type === "text" && clean === "Montant obtenu d’un régime privé" && name === "montantPrive") return {kind:"otherInsurancePaid",label:"Montant obtenu du régime privé",format:"decimal-comma" as const};
  if (type === "number" && clean === "Durée en minutes" && name === "uniteMesure") return {kind:"durationMinutes",label:"Durée du soin en minutes"};
  return null;
}
export function desjardinsDetailSuggestion(kind:string, dossier:ClaimPreparation, options:{value:string;label:string}[], mainText:string) {
  if (dossier.insurer !== "desjardins" || dossier.blocked) return null;
  if (kind === "serviceDate") {
    const date=calendarDate(dossier.fields.serviceDate?.slice(0,10));
    return date && /\bJJ-MM-AAAA\b/.test(mainText) ? `${date.slice(8,10)}-${date.slice(5,7)}-${date.slice(0,4)}` : null;
  }
  if (kind === "originalAmount") return dossier.fields.originalAmount == null ? null : dossier.fields.originalAmount.toFixed(2).replace(".",",");
  if (kind === "otherInsurancePaid") return dossier.fields.otherInsurancePaid == null ? null : dossier.fields.otherInsurancePaid.toFixed(2).replace(".",",");
  if (kind === "durationMinutes") {
    const match=/^Subsequent Physiotherapy Session \(([1-9]\d{0,2}) minutes\)$/i.exec(dossier.fields.service || "");
    return match && Number(match[1]) <= 240 ? match[1] : null;
  }
  if (kind === "service" && /^Subsequent Physiotherapy Session \(\d+ minutes\)$/i.test(dossier.fields.service || "")) {
    const matches=options.filter(o=>o.value&&label(o.label)==="Traitement subséquent");return matches.length===1?matches[0].value:null;
  }
  return null;
}
export function desjardinsDetailRadios(path:string) {
  return path===desjardinsDetailsPath ? [
    {name:"radioAccident",kind:"accident",label:"Frais engagés à la suite d’un accident"},
    {name:"radioRemboursementObtenu",kind:"otherInsurance",label:"Remboursement déjà demandé ou obtenu"},
    {name:"radioRemboursementGouvernement",kind:"governmentReimbursement",label:"Remboursement gouvernemental demandé ou obtenu"},
    {name:"radioRemboursementPrive",kind:"privateInsuranceClaim",label:"Autre réclamation auprès d’un régime privé"},
    {name:"radioRemboursement",kind:"reimbursementMethod",label:"Mode de remboursement"}
  ] : [];
}
export function desjardinsDetailRadioSuggestion(kind:string,dossier:ClaimPreparation,options:{value:string;label:string}[],causeUnrelated:boolean,paidReceipt:boolean) {
  if(dossier.blocked||dossier.insurer!=="desjardins")return null;
  const expected=kind==="accident"&&causeUnrelated?"Non":kind==="otherInsurance"&&dossier.fields.otherInsurance==="Yes"?"Oui"
    :kind==="privateInsuranceClaim"&&dossier.otherInsurer==="blue-cross"&&dossier.coordination?.importedStatementAvailable&&dossier.fields.otherInsurance==="Yes"?"Oui"
    :kind==="reimbursementMethod"&&paidReceipt?"Par dépôt direct dans votre compte":null;
  const matches=expected?options.filter(o=>o.value&&label(o.label)===expected):[];
  return matches.length===1?matches[0].value:null;
}
