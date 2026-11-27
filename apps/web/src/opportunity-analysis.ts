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
  if (['sold', 'withdrawn', 'unavailable'].includes(card.status)) return 'Set this listing aside';
  if (!activeOffer(card, at)) return 'Recheck availability';
  if (card.criteria.some(c => c.id !== 'budget' && c.pass === false)) return 'Does not match your project';
  if (!currentFact(card.priceCad, at)) return 'Recheck asking price';
  if (card.criteria.some(c => c.pass === false)) return 'Does not match your project';
  if (card.criteria.some(c => c.pass === null)) return 'Criteria need evidence';
  return 'Plan a viewing';
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
    if (s.kind !== 'sold') reason = 'Asking price only';
    else if (!addresses[i] || !links[i] || !/^\d+([.]\d{1,2})?$/.test(s.amount) || !(amount > 0 && Number.isSafeInteger(Math.round(amount * 100)))) reason = 'Missing identity, price or source';
    else if (addresses[i] === key(subject.address) || links[i] === linkKey(subject.url)) reason = 'The subject property itself';
    else if (addresses.indexOf(addresses[i]) !== addresses.lastIndexOf(addresses[i]) || links.indexOf(links[i]) !== links.lastIndexOf(links[i])) reason = 'Repeated identity or source';
    else if (!(event <= checked && checked <= today && today - event <= 180 * day)) reason = 'Dates missing, inconsistent or more than 180 days since sale';
    else if (!sourceKey(areaSource) || !(Number(subjectArea) > 0 && Number.isFinite(Number(subjectArea))) || !(Number(s.area) > 0 && Number.isFinite(Number(s.area))) || Math.abs(Number(s.area) - Number(subjectArea)) > Number(subjectArea) * 0.10) reason = 'Missing living area or difference greater than 10%';
    else if (!s.comparable || s.rationale.trim().length < 8) reason = 'Comparability not established';
    return {reason, amount};
  });
  const accepted = rows.filter(r => !r.reason).map(r => r.amount);
  const low = Math.min(...accepted), high = Math.max(...accepted);
  const ready = activeOffer(subject, at) && currentFact(subject.priceCad, at);
  let verdict: string;
  if (!ready) verdict = 'Refresh the listing status and asking price before comparing.';
  else if (accepted.length < 3) verdict = 'At least three distinct comparable sales are required.';
  else if (high / low > 1.2) verdict = 'Sale prices vary too widely to assess this asking price.';
  else if (subject.priceCad.value! < low) verdict = 'Asking price below the selected sales';
  else if (subject.priceCad.value! > high) verdict = 'Asking price above the selected sales';
  else verdict = 'Asking price within the selected sales range';
  return {rows, count:accepted.length, verdict, range: ready && accepted.length >= 3 && high / low <= 1.2 ? {low,high} : null};
}
