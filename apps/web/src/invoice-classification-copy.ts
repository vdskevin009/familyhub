// Historical worker-generated reasons only; never rewrite source text, notes or stored records.
const knownReasons: ReadonlyMap<string, string> = new Map([
  ["Décision répétée appliquée automatiquement.", "A repeated decision was applied automatically."],
  ["Décision précédente proposée; confirmez-la encore pour augmenter l'autonomie.", "A previous decision is suggested. Confirm it again to allow future matches to be handled automatically."],
  ["Reçu de soins et numéro de facture confirmés par la pièce jointe; montants et remboursement à vérifier.", "The attachment confirms the healthcare receipt and invoice number. Check the amounts and reimbursement."],
]);

export function invoiceClassificationCopy(value: string): string {
  return knownReasons.get(value) ?? value;
}
