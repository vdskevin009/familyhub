import type { FinanceState } from "../../../worker/src/finance-model";
export const displayFinanceCapture = (value: string) => new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short",
}).format(new Date(value));
export function FinanceCollectionNote({ state }: { state: FinanceState }) {
    const collection = state.imports.at(-1)?.collection;
    return <p className="finance-collection-note">{collection ? <>Last saved collection: <time dateTime={collection.retrievedAt}>{displayFinanceCapture(collection.retrievedAt)}</time> · {collection.accountIds.length} {collection.accountIds.length === 1 ? "account" : "accounts"} out of {state.data?.accounts.length}. </> : <>The date and time of the last collection are unavailable. </>}Other accounts and sections may still show older sources. A collection does not prove that bank data is current or complete.</p>;
}
