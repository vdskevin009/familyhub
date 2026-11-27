import type { Evidence } from '../../worker/src/property-model';
import type { PropertyCard } from './property-api';
import type { VehicleCard } from './vehicle-api';

const day = 86_400_000;
const offerWindow = 2 * day;
type Card = PropertyCard | VehicleCard;
type Fact = Evidence<unknown>;

export function currentFact(fact: Fact, at: number) {
  const age = at - Date.parse(fact.checkedAt ?? '');
  return fact.value !== null && !!fact.sourceUrl && age >= 0 && age <= offerWindow;
}

export function activeOffer(card: Card, at: number) {
  const age = at - Date.parse(card.observedAt);
  return age >= 0 && age <= offerWindow && card.status === 'active' && currentFact(card.statusEvidence, at);
}

export function projectDecision(card: Card, at: number) {
  if (['sold', 'withdrawn', 'unavailable'].includes(card.status)) return 'Annonce à écarter pour le moment';
  if (!activeOffer(card, at)) return 'Disponibilité à reconfirmer';
  if (card.criteria.some(c => c.id !== 'budget' && c.pass === false)) return 'Écart avec le projet';
  if (!currentFact(card.priceCad, at)) return 'Prix demandé à reconfirmer';
  if (card.criteria.some(c => c.pass === false)) return 'Écart avec le projet';
  if (card.criteria.some(c => c.pass === null)) return 'Critères à documenter';
  return 'Visite à préparer';
}

function key(value: string) { return value.trim().toLowerCase().replace(/\s+/g, ' '); }
function linkKey(value: string) {
  // Query parameters may identify the listing. Strip only tracking and fragments.
  const url = new URL(value);
  url.hash = '';
  for (const k of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(k)) url.searchParams.delete(k);
  url.searchParams.sort();
  return url.href.replace(/\/$/, '');
}

export function vehicleAsks(subject: VehicleCard, pool: VehicleCard[], at: number) {
  const matchFields = ['make', 'model', 'trim', 'year', 'awd'] as const;
  function hasFacts(card: VehicleCard) {
    return activeOffer(card, at) && currentFact(card.priceCad, at) &&
      currentFact(card.mileageKm, at) && card.greaterVancouver.value === true &&
      card.used.value === true && matchFields.every(field => card[field].value !== null);
  }
  if (!hasFacts(subject)) return [];
  // A syndicated copy is not an independent observation. Exclude ambiguous links entirely.
  const urls = pool.map(card => linkKey(card.url));
  const sameListing = linkKey(subject.url);
  return pool.filter((card, i) => hasFacts(card) && card.listingId !== subject.listingId &&
    urls[i] !== sameListing && urls.indexOf(urls[i]) === urls.lastIndexOf(urls[i]) &&
    matchFields.every(field => key(String(card[field].value)) === key(String(subject[field].value))) &&
    Math.abs(card.mileageKm.value! - subject.mileageKm.value!) <= 10_000);
}

export type Sale = {
  address: string; kind: 'asking' | 'sold'; amount: string; source: string;
  eventDate: string; checkedDate: string; comparable: boolean; area: string; rationale: string;
};
export const newSale = (): Sale => ({address:'', kind:'asking', amount:'', source:'', eventDate:'', checkedDate:'', comparable:false, area:'', rationale:''});
const civilDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const ms = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms : NaN;
};
export function localDay(at: number) {
  return new Intl.DateTimeFormat('en-CA', {timeZone:'America/Vancouver',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
}
function sourceKey(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? linkKey(url.href) : '';
  } catch { return ''; }
}

export function evaluateSales(subject: PropertyCard, sales: Sale[], at: number, subjectArea: string, areaSource: string) {
  const today = civilDate(localDay(at));
  const addresses = sales.map(s => key(s.address));
  const links = sales.map(s => sourceKey(s.source));
  const rows = sales.map((s, i) => {
    const event = civilDate(s.eventDate), checked = civilDate(s.checkedDate);
    const amount = Number(s.amount);
    let reason = '';
    if (s.kind !== 'sold') reason = 'Prix affiché uniquement';
    else if (!addresses[i] || !links[i] || !/^\d+([.]\d{1,2})?$/.test(s.amount) || !(amount > 0 && Number.isSafeInteger(Math.round(amount * 100)))) reason = 'Identité, prix ou source à compléter';
    else if (addresses[i] === key(subject.address) || links[i] === linkKey(subject.url)) reason = 'Bien étudié lui-même';
    else if (addresses.indexOf(addresses[i]) !== addresses.lastIndexOf(addresses[i]) || links.indexOf(links[i]) !== links.lastIndexOf(links[i])) reason = 'Identité ou source répétée';
    else if (!(event <= checked && checked <= today && today - event <= 180 * day)) reason = 'Dates absentes, incohérentes ou vente de plus de 180 jours';
    else if (!sourceKey(areaSource) || !(Number(subjectArea) > 0 && Number.isFinite(Number(subjectArea))) || !(Number(s.area) > 0 && Number.isFinite(Number(s.area))) || Math.abs(Number(s.area) - Number(subjectArea)) > Number(subjectArea) * 0.10) reason = 'Surfaces habitables à documenter ou écart supérieur à 10 %';
    else if (!s.comparable || s.rationale.trim().length < 8) reason = 'Comparabilité à documenter';
    return {reason, amount};
  });
  const accepted = rows.filter(r => !r.reason).map(r => r.amount);
  const low = Math.min(...accepted), high = Math.max(...accepted);
  const ready = activeOffer(subject, at) && currentFact(subject.priceCad, at);
  let verdict: string;
  if (!ready) verdict = 'Actualiser le statut et le prix demandé avant la comparaison.';
  else if (accepted.length < 3) verdict = 'Trois ventes distinctes et comparables sont nécessaires.';
  else if (high / low > 1.2) verdict = 'Ventes trop dispersées pour situer le prix demandé.';
  else if (subject.priceCad.value! < low) verdict = 'Prix demandé sous les ventes retenues';
  else if (subject.priceCad.value! > high) verdict = 'Prix demandé au-dessus des ventes retenues';
  else verdict = 'Prix demandé dans la fourchette des ventes retenues';
  return {rows, count:accepted.length, verdict, range: ready && accepted.length >= 3 && high / low <= 1.2 ? {low,high} : null};
}
