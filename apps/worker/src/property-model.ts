export type Evidence<T> = { value: T | null; sourceUrl: string | null; checkedAt: string | null; note: string };
export type PropertyObservation = {
  id: string; listingId: string; observedAt: string; address: string; url: string;
  status: 'active' | 'sold' | 'withdrawn' | 'unavailable' | 'unknown';
  primaryPhoto?: { url: string; sourceUrl: string; attribution: string; checkedAt: string } | null;
  statusEvidence: Evidence<string>;
  monthlyStrataFeeCad?: Evidence<number>;
  priceCad: Evidence<number>; bedrooms: Evidence<number>; lowerLonsdale: Evidence<boolean>;
  separateEntrances: Evidence<boolean>;
  airbnb: { status: 'unknown' | 'conditional' | 'prohibited'; evidence: { url: string; checkedAt: string; note: string }[] };
};
export const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
export function text(v: unknown, max = 1000): v is string { return typeof v === 'string' && v.length > 0 && v.length <= max; }
function url(v: unknown): v is string { try { const u = new URL(String(v)); return typeof v === 'string' && v.length < 2000 && u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } }
function evidence(v: unknown, kind: 'number' | 'boolean' | 'string', at: string): boolean {
  if (!v || typeof v !== 'object') return false;
  const e = v as Evidence<unknown>;
  if (typeof e.note !== 'string' || e.note.length > 1000) return false;
  if (e.value === null) return e.sourceUrl === null && e.checkedAt === null;
  return typeof e.value === kind && (kind !== 'number' || (Number.isFinite(e.value) && Number(e.value) >= 0)) && url(e.sourceUrl) && date(e.checkedAt) && Date.parse(e.checkedAt) <= Date.parse(at);
}
export function validateProperty(input: unknown): PropertyObservation {
  if (!input || typeof input !== 'object') throw Error('Invalid property observation');
  const p = input as PropertyObservation;
  if (!text(p.id, 160) || !text(p.listingId, 160) || !date(p.observedAt) || !text(p.address, 300) || !url(p.url) || !['active','sold','withdrawn','unavailable','unknown'].includes(p.status)) throw Error('Invalid property identity/date');
  if (!evidence(p.statusEvidence,'string',p.observedAt) || (p.status === 'unknown' ? p.statusEvidence.value !== null : p.statusEvidence.value !== p.status)) throw Error('Listing status requires explicit dated source; disappearance is unknown');
  if (!evidence(p.priceCad, 'number', p.observedAt) || !evidence(p.bedrooms, 'number', p.observedAt) || !evidence(p.lowerLonsdale, 'boolean', p.observedAt) || !evidence(p.separateEntrances, 'boolean', p.observedAt)) throw Error('Property facts require dated source evidence');
  if (p.priceCad.value !== null && p.priceCad.value <= 0 || p.bedrooms.value !== null && !Number.isInteger(p.bedrooms.value)) throw Error('Invalid property amount/count');
  if (!p.airbnb || !['unknown','conditional','prohibited'].includes(p.airbnb.status) || !Array.isArray(p.airbnb.evidence) || p.airbnb.evidence.length > 20 || p.airbnb.evidence.some(e => !url(e.url) || !date(e.checkedAt) || Date.parse(e.checkedAt) > Date.parse(p.observedAt) || !text(e.note)) || p.airbnb.status !== 'unknown' && p.airbnb.evidence.length === 0) throw Error('Airbnb assessment requires evidence; no blanket permission');
  if (p.primaryPhoto != null && (!url(p.primaryPhoto.url) || !url(p.primaryPhoto.sourceUrl) || !text(p.primaryPhoto.attribution,300) || !date(p.primaryPhoto.checkedAt) || Date.parse(p.primaryPhoto.checkedAt)>Date.parse(p.observedAt))) throw Error("Invalid attributed listing photo");
  if(p.monthlyStrataFeeCad!==undefined && !evidence(p.monthlyStrataFeeCad,"number",p.observedAt)) throw Error("Strata fees require dated source evidence");
  // Whitelist the payload: never persist arbitrary imported private context.
  const fact = <T>(e: Evidence<T>): Evidence<T> => ({value:e.value,sourceUrl:e.sourceUrl,checkedAt:e.checkedAt,note:e.note});
  return {id:p.id,listingId:p.listingId,observedAt:p.observedAt,address:p.address,url:p.url,status:p.status,statusEvidence:fact(p.statusEvidence),primaryPhoto:p.primaryPhoto == null ? null : {url:p.primaryPhoto.url,sourceUrl:p.primaryPhoto.sourceUrl,attribution:p.primaryPhoto.attribution,checkedAt:p.primaryPhoto.checkedAt},monthlyStrataFeeCad:p.monthlyStrataFeeCad===undefined?{value:null,sourceUrl:null,checkedAt:null,note:"Not collected"}:fact(p.monthlyStrataFeeCad),priceCad:fact(p.priceCad),bedrooms:fact(p.bedrooms),lowerLonsdale:fact(p.lowerLonsdale),separateEntrances:fact(p.separateEntrances),airbnb:{status:p.airbnb.status,evidence:p.airbnb.evidence.map(e=>({url:e.url,checkedAt:e.checkedAt,note:e.note}))}};
}
export function propertyCard(input: unknown, now = new Date()) {
  const p = validateProperty(input);
  const checks = [
    {id:'budget', evidence:p.priceCad, pass:p.priceCad.value === null ? null : p.priceCad.value <= 1_700_000},
    {id:'bedrooms', evidence:p.bedrooms, pass:p.bedrooms.value === null ? null : p.bedrooms.value >= 3},
    {id:'neighbourhood', evidence:p.lowerLonsdale, pass:p.lowerLonsdale.value},
    {id:'entrances', evidence:p.separateEntrances, pass:p.separateEntrances.value}
  ].map(c => ({...c, status:c.pass === null ? 'unknown' : c.pass ? 'pass' : 'fail'}));
  const known = checks.filter(c=>c.pass !== null).length;
  const age = now.getTime() - Date.parse(p.observedAt);
  const statusAge = p.statusEvidence.checkedAt === null ? Infinity : now.getTime() - Date.parse(p.statusEvidence.checkedAt);
  const stale = age < 0 || age > 48 * 60 * 60 * 1000 || statusAge < 0 || statusAge > 48 * 60 * 60 * 1000;
  return {...p, criteria:checks, evidenceCoveragePercent:known*25,
    matchPercent:known === 4 ? checks.filter(c=>c.pass).length*25 : null,
    eligibility:checks.some(c=>c.pass === false) ? 'does-not-match' : known < 4 ? 'needs-verification' : 'matches',
    stale, available:p.status === 'active' && !stale,
    opportunity:{status:'insufficient-evidence',score:null,reason:'Verified sold comparables and documented adjustments required; asking prices are not valuations.'}};
}
