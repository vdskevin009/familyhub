import type { Monitoring } from "../../worker/src/household-alerts";
import type { NotificationEvent } from "../../worker/src/notification-model";
import { mortgageEnglish } from "./mortgage-copy";

type Copy = Pick<NotificationEvent, "title" | "detail" | "links">;
type Event = Pick<NotificationEvent, "kind" | "target"> & Copy;
const days = (value: string) => `${value} day${value === "1" ? "" : "s"}`;

// Only match complete known worker templates. Source facts and names captured by
// templates pass through verbatim, and all matching happens after readback.
export function notificationHistoryCopy({ kind, target, title, detail, links }: Event): Copy {
  const copy = (title: string, detail: string, label?: [string, string]): Copy => ({
    title, detail, links: label && links ? links.map(link => link.label === label[0] ? { ...link, label: label[1] } : link) : links
  });
  switch (kind) {
    case "open-claim":
      if (target.view === "reimbursements" && title === "Dossier de remboursement à vérifier" && detail === "Dossier ouvert depuis au moins 14 jours avec solde potentiel. Vérifier si la demande a été transmise et si une réponse manque. La date d’ouverture ne prouve pas l’envoi à l’assureur.")
        return copy("Reimbursement claim to review", "This claim has been open for at least 14 days and has a potential balance. Check whether it was submitted and whether a response is missing. The opening date does not establish submission to the insurer.");
      break;
    case "new-property":
      if (target.view === "property" && title === "Nouveau bien correspondant au projet" && detail === "Prix affiché dans le budget, au moins trois chambres, secteur recherché et deux entrées documentées. Vérifier le plan et les coûts avant une visite.")
        return copy("New property matching your search", "Asking price within budget, at least three bedrooms, in the target area, with two documented entrances. Check the floor plan and costs before viewing.", ["Annonce et prix relevé", "Listing and observed price"]);
      break;
    case "new-vehicle":
      if (target.view === "vehicle" && title === "Nouvelle auto à examiner" && detail === "SUV d’occasion AWD dans le budget. Prix avant taxes au moins 10 % sous chacune des trois annonces locales de référence ou plus, de même année et version, à 10 000 km près. Vérifier NIV, frais et inspection.") {
        const translated = copy("New vehicle listing to review", "Used AWD SUV within budget. The pre-tax price is at least 10% below each of three or more local comparable listings for the same model year and trim, within 10,000 km. Check the VIN, fees and inspection.", ["Annonce et prix relevé", "Listing and observed price"]);
        return { ...translated, links: translated.links?.map(link => {
          const comparable = /^Référence affichée · ([\d.]+ CAD · \d{4}-\d{2}-\d{2})$/.exec(link.label);
          return comparable ? { ...link, label: `Comparable listing · ${comparable[1]}` } : link;
        }) };
      }
      break;
    case "collection": {
      if (target.view !== "reimbursements") break;
      if (title === "Test de notification" && detail === "Test demandé depuis un appareil associé. L’acceptation par le service Push ne prouve pas sa réception sur le téléphone.")
        return copy("Notification test", "A paired device requested this test. Acceptance by the push service does not prove the phone received it.");
      const match = /^(.+) : (collecte à vérifier|données anciennes)$/s.exec(title);
      if (!target.sources || !match) break;
      if (match[2] === "collecte à vérifier" && detail === "La dernière tentative est bloquée ou incomplète. Consultez son état avant de relancer. Aucun nouvel accès ni remboursement n’est présumé.")
        return copy(`${match[1]}: collection needs review`, "The last attempt is blocked or incomplete. Check its status before retrying. No new access or reimbursement is assumed.");
      if (match[2] === "données anciennes" && detail === "Aucune réussite enregistrée depuis plus de 7 jours. Ce seuil de fraîcheur ne prouve pas qu’une collecte planifiée a échoué.")
        return copy(`${match[1]}: data out of date`, "No successful collection was recorded in the last 7 days. This does not prove that a scheduled collection failed.");
      break;
    }
    case "reimbursement": {
      if (target.view !== "reimbursements" || !["Remboursement enregistré", "Remboursement partiel enregistré"].includes(title)) break;
      const m = /^Un relevé associé indique (.+)\. Il s’agit du paiement documenté par l’assureur, pas d’une confirmation du dépôt bancaire\.$/s.exec(detail);
      if (m) return copy(title === "Remboursement enregistré" ? "Reimbursement recorded" : "Partial reimbursement recorded", `A matched statement shows ${m[1]}. The insurer documented the payment, but this does not confirm a bank deposit.`);
      break;
    }
    case "unmatched":
      if (target.view === "reimbursements" && target.queue === "unmatched" && title === "Paiement à rapprocher" && detail === "Un relevé d’assurance n’est pas associé avec certitude à une dépense. Vérifiez la source avant de confirmer un rapprochement.")
        return copy("Payment needs matching", "An insurance statement could not be reliably matched to an expense. Check the source before confirming a match.");
      break;
    case "deadline": {
      const labels = { Renouvellement: "Renewal", "Fin d’engagement": "Commitment ends", "Fin de promotion": "Promotion ends" };
      const label = target.view === "savings" && /^(Renouvellement|Fin d’engagement|Fin de promotion) : (.+)$/s.exec(title);
      const english = label ? `${labels[label[1] as keyof typeof labels]}: ${label[2]}` : target.view === "finances" && target.tab === "investments" && title === "Placement : échéance enregistrée" ? "Investment maturity recorded" : null;
      const m = /^Date enregistrée : (\d{4}-\d{2}-\d{2})\. (?:Aujourd’hui|Dans (\d+) jour\(s\))\. Vérifiez les conditions et la source avant toute décision\.$/.exec(detail);
      if (english && m) return copy(english, `Recorded date: ${m[1]}. ${m[2] ? `In ${days(m[2])}.` : "Today."} Check the terms and source before deciding.`);
      break;
    }
    case "price": {
      if (target.view !== "finances" || title !== "Prélèvement récurrent à vérifier") break;
      const m = /^(.+) : (.+?) après (.+?)\. Une hausse de paiement ne prouve pas une hausse de tarif : vérifiez taxes, période et ajustements\.$/s.exec(detail);
      if (m) return copy("Recurring payment needs review", `${m[1]}: ${m[2]}, previously ${m[3]}. A higher payment does not prove a rate increase. Check taxes, the billing period and adjustments.`);
      break;
    }
    case "weekly": {
      if (target.view !== "finances" || title !== "Votre semaine de dépenses importées") break;
      const m = /^Du (\d{4}-\d{2}-\d{2}) au (\d{4}-\d{2}-\d{2}) : (.+?) de consommation nette observée, après remboursements et hors transferts, paiements de carte et placements classés\. (\d+) opération\(s\) non confirmée\(s\)\. Couverture limitée aux sources importées; ce n'est pas un total garanti du foyer\.$/s.exec(detail);
      if (m) return copy("Your weekly imported spending", `${m[1]} to ${m[2]}: ${m[3]} of observed net spending after refunds, excluding transfers, card payments and classified investments. ${m[4]} unconfirmed transaction${m[4] === "1" ? "" : "s"}. Only imported sources are covered; this may not reflect total household spending.`);
      break;
    }
    case "grocery": {
      if (target.view !== "groceries" || title !== "Baisse de prix sur un produit acheté régulièrement") break;
      const m = /^(.+) : (.+?) pour (\d+) format\(s\), contre (.+?) sur le reçu du (\d{4}-\d{2}-\d{2})\. Écart produits observé : (.+?) ; hors frais, taxes et déplacement, sans gain net ni besoin de rachat présumé\. Vérifiez le prix local et les conditions avant le prochain achat\.$/s.exec(detail);
      if (m) return copy("Price drop on a regularly purchased item", `${m[1]}: ${m[2]} for ${m[3]} pack${m[3] === "1" ? "" : "s"}, compared with ${m[4]} on the receipt dated ${m[5]}. Observed difference for the items: ${m[6]}, excluding fees, taxes and travel. No net saving or need to buy again is assumed. Check the local price and terms before buying.`, ["Voir le prix marchand daté", "View dated retailer price"]);
      break;
    }
    case "claim-deadline": {
      if (target.view !== "reimbursements" || title !== "Réclamation : date limite documentée à vérifier") break;
      const m = /^Date limite enregistrée : (\d{4}-\d{2}-\d{2}), dans (\d+) jour\(s\)\. Un dossier ouvert attend cette prochaine demande\. Vérifiez la règle et la pièce source, puis préparez la demande ; aucune soumission ni admissibilité n’est présumée\. Preuve revue : ([\s\S]*)$/.exec(detail);
      if (m) return copy("Claim: review the documented deadline", `Recorded deadline: ${m[1]}, in ${days(m[2])}. An open claim is awaiting this next submission. Check the rule and source document before preparing the claim. No submission or eligibility is assumed. Reviewed evidence: ${m[3]}`);
      break;
    }
    case "policy": {
      if (target.view !== "mortgage" || title !== "La Banque du Canada a modifié son taux directeur") break;
      const m = /^Annonce du (\d{4}-\d{2}-\d{2}) : ([\d.-]+) % → ([\d.-]+) % \(([+-]?[\d.]+) point\), effet le (\d{4}-\d{2}-\d{2})\. (.+) Prochaine action : revoir les options variables avec le prime et le rabais contractuels documentés\. Les devis historiques restent inchangés ; un taux directeur n’est pas un taux préférentiel ni une offre personnelle\.$/.exec(detail);
      const impact = m && policyImpact(m[6]);
      if (m && impact) return copy("Bank of Canada policy rate changed", `Announcement on ${m[1]}: ${m[2]}% → ${m[3]}% (${m[4]} percentage points), effective ${m[5]}. ${impact} Review variable options using the documented prime rate and contractual discount. Past quotes are unchanged. The policy rate is not a prime rate or a personal offer.`, ["Décision officielle et date d’effet", "Official decision and effective date"]);
      break;
    }
    case "mortgage": {
      if (target.view !== "mortgage" || !mortgageSignalTitles.has(title)) break;
      const prefix = /^(Le gain net estimé dépasse votre seuil de [\d.]+ \$ jusqu’à l’échéance actuelle\.|Validité documentée jusqu’au \d{4}-\d{2}-\d{2}\.|.+ : baisse de \d+\.\d+ point depuis le \d{4}-\d{2}-\d{2}\.|Des devis existent, mais aucun gain net fiable ne peut encore être calculé\.)([\s\S]*)$/.exec(detail);
      if (prefix) {
        const tail = prefix[2].replace(/^ (Vérifier les conditions et décider avant le \d{4}-\d{2}-\d{2}\.|Faire confirmer l’admissibilité et les coûts avant de comparer un changement de prêt\.)(?= |$)/, (_, action: string) => " " + mortgageEnglish(action));
        const rate = /^(.+) : baisse de (\d+\.\d+) point depuis le (\d{4}-\d{2}-\d{2})\.$/.exec(prefix[1]);
        const saved = rate ? `${rate[1]}: down ${rate[2]} percentage points since ${rate[3]}.` : mortgageEnglish(prefix[1]);
        return copy(mortgageEnglish(title), saved + tail);
      }
      break;
    }
  }
  return copy(title, detail);
}
const mortgageSignalTitles = new Set(["Offre confirmée à examiner", "Opportunité à examiner", "Proposition intéressante proche de son échéance", "Taux public comparable en baisse", "Données nécessaires à la décision"]);
function policyImpact(detail: string): string | undefined {
  const fixed = /^Votre prêt enregistré reste fixe à ([\d.]+) % jusqu’au (\d{4}-\d{2}-\d{2}) : aucun changement immédiat de son taux contractuel\.$/.exec(detail);
  if (fixed) return `Your saved mortgage remains fixed at ${fixed[1]}% until ${fixed[2]}. There is no immediate change to its contractual rate.`;
  if (detail === "Votre prêt est enregistré comme variable : vérifiez le prime du prêteur, le rabais et le mode de paiement ; aucun nouveau taux ni paiement n’est déduit.") return "Your mortgage is recorded as variable. Check the lender’s prime rate, discount and payment arrangement. No new rate or payment is inferred.";
  if (detail === "Le type et l’échéance du prêt doivent être confirmés pour préciser l’impact personnel ; aucun taux contractuel n’est recalculé.") return "Confirm your mortgage type and maturity date to understand the impact. No contractual rate has been recalculated.";
}

/** Legacy monitoring text is separate from notification history and has a category discriminator. */
export function notificationMonitoringDetail({ category, detail }: Monitoring): string {
  switch (category) {
    case "policy": {
      if (detail === "Source officielle non vérifiée récemment ; aucune nouvelle décision supposée.") return "The official source has not been checked recently. No new decision is assumed.";
      const m = /^Source officielle vérifiée le (\d{4}-\d{2}-\d{2}) ; première lecture silencieuse, changements suivants dédupliqués\.$/.exec(detail);
      if (m) return `Checked the official source on ${m[1]}. The first check does not send an alert and subsequent changes are deduplicated.`;
      break;
    }
    case "renewal": {
      if (detail === "Contrats indisponibles ; anciens rappels conservés.") return "Contracts are unavailable. Previous reminders are retained.";
      const m = /^(\d+\/\d+) contrat\(s\) avec une échéance renseignée\. Seules les dates documentées et non contradictoires déclenchent un rappel à 30, 7 et 1 jour ; autres dates à compléter\.$/.exec(detail);
      if (m) return `${m[1]} contracts have a recorded due date. Only documented, consistent dates trigger reminders at 30, 7 and 1 day before they are due. Complete any missing dates.`;
      break;
    }
    case "gic": {
      if (detail === "Sources de placement indisponibles.") return "Investment sources are unavailable.";
      const m = /^(\d+) GIC daté\(s\) ; sources du (\S+)\. Vérifiez les instructions de renouvellement ; aucune nouvelle offre ni rendement supposé\.$/.exec(detail);
      if (m) return `${m[1]} GIC${m[1] === "1" ? "" : "s"} with recorded dates. Sources as of ${m[2]}. Check renewal instructions; no new offer or return is assumed.`;
      break;
    }
    case "grocery": {
      if (detail === "Il faut deux reçus finaux payés et revus en 90 jours, un achat récent, le même produit et un prix public local approuvé, disponible et encore valable. Aucune économie supposée.") return "Requires two reviewed final paid receipts within 90 days, a recent purchase, the same product and an approved public local price that is in stock and still valid. No savings are assumed.";
      const m = /^(\d+) comparaison\(s\) étayée\(s\), (\d+) baisse\(s\) atteignant les seuils 15 % et 2 unités monétaires sur les formats achetables\. Hors frais, taxes et déplacement\.$/.exec(detail);
      if (m) return `${m[1]} supported comparison${m[1] === "1" ? "" : "s"} and ${m[2]} price drop${m[2] === "1" ? "" : "s"} meeting both thresholds: 15% and 2 currency units on available pack sizes. Excludes fees, taxes and travel.`;
      break;
    }
    case "claim-deadline": {
      if (detail === "Preuves de délais indisponibles ; aucun délai déduit.") return "Deadline evidence is unavailable. No deadline is inferred.";
      const m = /^(\d+\/\d+) dossier\(s\) ouvert\(s\) à soumettre avec une règle liée à sa pièce\. Sans règle explicitement revue et source actuelle, aucune échéance n’est inventée\.$/.exec(detail);
      if (m) return `${m[1]} open claims awaiting submission have a rule linked to their source document. No deadline is inferred without an explicitly reviewed rule and a current source.`;
      break;
    }
  }
  return detail;
}
