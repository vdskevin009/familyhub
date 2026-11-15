import type { FinanceState } from "../../../worker/src/finance-model";
export const displayFinanceCapture = (value: string) => new Intl.DateTimeFormat("fr-CA", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short",
}).format(new Date(value));
export function FinanceCollectionNote({ state }: { state: FinanceState }) {
    const collection = state.imports.at(-1)?.collection;
    return <p className="finance-collection-note">{collection ? <>Dernière collecte enregistrée : <time dateTime={collection.retrievedAt}>{displayFinanceCapture(collection.retrievedAt)}</time> · {collection.accountIds.length} {collection.accountIds.length === 1 ? "compte" : "comptes"} sur {state.data?.accounts.length}. </> : <>Date et heure de la dernière collecte non disponibles. </>}Les autres comptes et sections peuvent conserver des sources plus anciennes. La collecte ne prouve ni la fraîcheur bancaire ni une couverture complète.</p>;
}
