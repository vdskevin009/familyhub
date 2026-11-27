import assert from "node:assert/strict";
import test from "node:test";
import type { NotificationEvent } from "../../worker/src/notification-model";
import { notificationHistoryCopy, notificationMonitoringDetail } from "../src/notification-history-copy";

const event = (kind: NotificationEvent["kind"], target: NotificationEvent["target"], title: string, detail: string) => ({
  id: "synthetic-history-id", evidenceVersion: "synthetic-evidence", sourceDate: "2026-11-24", createdAt: "2026-11-25T10:00:00Z",
  kind, target, title, detail, active: false, baseline: true
}) satisfies NotificationEvent;

test("historical contract reminder translates the exact template, not the contract name or record", () => {
  const row = event("deadline", { view: "savings", recordId: "fixture-contract" }, "Renouvellement : Forfait été", "Date enregistrée : 2026-11-26. Dans 1 jour(s). Vérifiez les conditions et la source avant toute décision.");
  const before = JSON.stringify(row);
  assert.deepEqual(notificationHistoryCopy(row), {
    title: "Renewal: Forfait été", detail: "Recorded date: 2026-11-26. In 1 day. Check the terms and source before deciding.", links: undefined
  });
  assert.equal(JSON.stringify(row), before);
  const unknown = { ...row, detail: "Forfait marqué « Renouvellement » dans l’entente." };
  assert.equal(notificationHistoryCopy(unknown).title, unknown.title);
  assert.equal(notificationHistoryCopy(unknown).detail, unknown.detail);
});

test("new English and unsupported user copy remain verbatim, including French source notes", () => {
  const row = event("grocery", { view: "groceries" }, "Price drop on a regularly purchased item", "Pâté de campagne. Détails chez le marchand.");
  assert.equal(notificationHistoryCopy(row).detail, row.detail);
  const note = "Vérifiez les conditions et la source avant toute décision.\nDossier d’Août.";
  const legacy = event("claim-deadline", { view: "reimbursements", recordId: "fixture-claim" }, "Réclamation : date limite documentée à vérifier", "Date limite enregistrée : 2026-11-28, dans 2 jour(s). Un dossier ouvert attend cette prochaine demande. Vérifiez la règle et la pièce source, puis préparez la demande ; aucune soumission ni admissibilité n’est présumée. Preuve revue : " + note);
  assert.match(notificationHistoryCopy(legacy).detail, /^Recorded deadline: 2026-11-28, in 2 days\./);
  assert.ok(notificationHistoryCopy(legacy).detail.endsWith(note));
});

test("official policy details preserve rate facts and every URL; unknown link labels are unchanged", () => {
  const row = {
    ...event("policy", { view: "mortgage" }, "La Banque du Canada a modifié son taux directeur", "Annonce du 2026-11-25 : 2.25 % → 2 % (-0.25 point), effet le 2026-11-26. Votre prêt enregistré reste fixe à 3.55 % jusqu’au 2027-01-01 : aucun changement immédiat de son taux contractuel. Prochaine action : revoir les options variables avec le prime et le rabais contractuels documentés. Les devis historiques restent inchangés ; un taux directeur n’est pas un taux préférentiel ni une offre personnelle."),
    links: [{ label: "Décision officielle et date d’effet", url: "https://example.test/policy" }, { label: "Texte d’origine", url: "https://example.test/source" }]
  };
  const copy = notificationHistoryCopy(row);
  assert.equal(copy.title, "Bank of Canada policy rate changed");
  assert.match(copy.detail, /2\.25% → 2% \(-0\.25 percentage points\).*fixed at 3\.55% until 2027-01-01/);
  assert.deepEqual(copy.links, [{ label: "Official decision and effective date", url: row.links[0].url }, row.links[1]]);
  assert.equal(row.links[0].label, "Décision officielle et date d’effet");
});

test("collection and grocery translation preserve source names (including punctuation and accents)", () => {
  const collection = event("collection", { view: "reimbursements", sources: true }, "Pôle : Service local : collecte à vérifier", "La dernière tentative est bloquée ou incomplète. Consultez son état avant de relancer. Aucun nouvel accès ni remboursement n’est présumé.");
  assert.equal(notificationHistoryCopy(collection).title, "Pôle : Service local: collection needs review");
  const grocery = event("grocery", { view: "groceries", tab: "tickets" }, "Baisse de prix sur un produit acheté régulièrement", "Œufs : frais : 4,00 $ pour 1 format(s), contre 6,50 $ sur le reçu du 2026-11-25. Écart produits observé : 2,50 $ ; hors frais, taxes et déplacement, sans gain net ni besoin de rachat présumé. Vérifiez le prix local et les conditions avant le prochain achat.");
  assert.match(notificationHistoryCopy(grocery).detail, /^Œufs : frais: 4,00 \$ for 1 pack, compared with 6,50 \$/);
  const wrongKind = { ...collection, kind: "price" as const };
  assert.equal(notificationHistoryCopy(wrongKind).title, collection.title);
});

test("monitoring and mortgage only translate known generated text", () => {
  assert.equal(notificationMonitoringDetail({ category: "gic", status: "unavailable", detail: "Sources de placement indisponibles." }), "Investment sources are unavailable.");
  const note = "Source : conditions de taux et date d’effet.";
  assert.equal(notificationMonitoringDetail({ category: "policy", status: "watching", detail: note }), note);
  const mortgage = event("mortgage", { view: "mortgage" }, "Taux public comparable en baisse", "Financement Démo : baisse de 0.25 point depuis le 2026-11-21. Faire confirmer l’admissibilité et les coûts avant de comparer un changement de prêt. " + note);
  assert.match(notificationHistoryCopy(mortgage).detail, /^Financement Démo: down 0\.25 percentage points since 2026-11-21\./);
  assert.ok(notificationHistoryCopy(mortgage).detail.endsWith(note));
});

import { invoiceClassificationCopy } from "../src/invoice-classification-copy";

test("only exact historical invoice reasons render in English; unsourced notes stay unchanged", () => {
  assert.equal(invoiceClassificationCopy("Décision répétée appliquée automatiquement."), "A repeated decision was applied automatically.");
  const custom = "Décision répétée, mais ajoutée par le cabinet." ;
  assert.equal(invoiceClassificationCopy(custom), custom);
});

test("saved actionable-project notices use English without changing listing links, dates or source labels", () => {
  const row = {
    ...event("new-vehicle", { view: "vehicle", recordId: "fixture-vehicle" }, "Nouvelle auto à examiner", "SUV d’occasion AWD dans le budget. Prix avant taxes au moins 10 % sous chacune des trois annonces locales de référence ou plus, de même année et version, à 10 000 km près. Vérifier NIV, frais et inspection."),
    links: [{ label: "Référence affichée · 26000 CAD · 2026-11-24", url: "https://example.test/peer" }, { label: "Détails du véhicule", url: "https://example.test/source" }]
  };
  const before = structuredClone(row), copy = notificationHistoryCopy(row);
  assert.equal(copy.title, "New vehicle listing to review");
  assert.equal(copy.links?.[0].label, "Comparable listing · 26000 CAD · 2026-11-24");
  assert.equal(copy.links?.[0].url, row.links[0].url);
  assert.strictEqual(copy.links?.[1], row.links[1]);
  assert.deepEqual(row, before);
  assert.equal(notificationHistoryCopy({ ...row, detail: "Un texte libre en français." }).title, row.title);
});
