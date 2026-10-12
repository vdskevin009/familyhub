import { publicSourceUrl } from "../../worker/src/grocery-planning";

/** Labels the recorded URL; never turns a search into an invented product page. */
export function grocerySourceLink(value: string) {
  let href: string;
  try { href = publicSourceUrl(value); } catch { return null; }
  if (!href) return null;
  const url = new URL(href), host = url.hostname.toLowerCase(), path = url.pathname;
  const product = (host === "www.walmart.ca" || host === "walmart.ca") && /^\/(?:en|fr)\/ip\/[^/]+/i.test(path)
    || (host === "www.realcanadiansuperstore.ca" || host === "realcanadiansuperstore.ca") && /\/p\/\d+(?:_|\/|$)/i.test(path)
    || host === "sameday.costco.ca" && /^\/store\/costco-canada\/products\/\d+/i.test(path);
  const search = /\/(?:search|results)\/?$/i.test(path) || path === "/s" && url.searchParams.has("k");
  return { href, label: product ? "Ouvrir le produit" : search ? "Ouvrir la recherche" : "Voir la source" };
}
