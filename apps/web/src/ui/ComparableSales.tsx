import { useState } from 'react';
import type { PropertyCard } from '../property-api';
import { evaluateSales, newSale, type Sale } from '../opportunity-analysis';

const cad = (n: number) => new Intl.NumberFormat('en-CA', {style:'currency',currency:'CAD',maximumFractionDigits:0}).format(n);

export function ComparableSales({card, at}: {card: PropertyCard; at:number}) {
  const [rows,setRows] = useState<Sale[]>([]);
  const [area,setArea] = useState('');
  const [source,setSource] = useState('');
  const result = evaluateSales(card,rows,at,area,source);
  function edit(index:number, patch: Partial<Sale>) {
    setRows(previous => previous.map((row,i) => i === index ? {...row,...patch} : row));
  }
  return <details className="decision-sales">
    <summary>Review documented comparable sales</summary>
    <p>Use closed sales in Canadian dollars. This worksheet stays on this screen and is cleared when you close the record.</p>
    <label>Property living area (sq. ft.)<input type="number" min="1" value={area} onChange={e=>setArea(e.target.value)}/></label>
    <label>Public source for the property’s living area<input type="url" value={source} onChange={e=>setSource(e.target.value)}/></label>
    {rows.map((row,i)=><fieldset key={i}><legend>Reference {i+1}</legend>
      <label>Price type<select value={row.kind} onChange={e=>edit(i,{kind:e.target.value as Sale['kind']})}><option value="asking">Listed</option><option value="sold">Sold</option></select></label>
      <label>Address including lot or unit number<input value={row.address} onChange={e=>edit(i,{address:e.target.value})}/></label>
      <label>Documented price (CAD)<input type="number" min="0.01" step="0.01" value={row.amount} onChange={e=>edit(i,{amount:e.target.value})}/></label>
      <label>Living area (sq. ft.)<input type="number" min="1" value={row.area} onChange={e=>edit(i,{area:e.target.value})}/></label>
      <label>Public source for price and features<input type="url" value={row.source} onChange={e=>edit(i,{source:e.target.value})}/></label>
      <label>{row.kind==='sold'?'Sale date':'Asking price date'}<input type="date" value={row.eventDate} onChange={e=>edit(i,{eventDate:e.target.value})}/></label>
      <label>Date source was checked<input type="date" value={row.checkedDate} onChange={e=>edit(i,{checkedDate:e.target.value})}/></label>
      <label>Features and differences<input value={row.rationale} onChange={e=>edit(i,{rationale:e.target.value})}/></label>
      <label className="decision-check"><input type="checkbox" checked={row.comparable} onChange={e=>edit(i,{comparable:e.target.checked})}/>I confirmed the same area, property type, tenure and bedroom count, comparable condition, and an arm’s-length sale without material adjustments.</label>
      <strong>{result.rows[i].reason || 'Sale included based on your review'}</strong>
      <button type="button" onClick={()=>setRows(previous=>previous.filter((_,j)=>i!==j))}>Remove reference {i+1}</button>
    </fieldset>)}
    {rows.length<6&&<button type="button" onClick={()=>setRows(previous=>[...previous,newSale()])}>Add reference</button>}
    <div role="status"><strong>{result.verdict}</strong>{rows.length>0 && <p>{result.count} sales included out of {rows.length} references.</p>}
      {result.range&&<p>{result.count} sales included · {cad(result.range.low)} to {cad(result.range.high)}. Descriptive range based on your checks.</p>}
    </div>
    <details><summary>How to read this</summary><p>At least three distinct sales within 180 days, living area within ±10%, and a highest price no more than 20% above the lowest. These are FamilyHub screening thresholds. Tenure, condition or a special levy can invalidate a comparison. Adjusting values requires an appraisal.</p></details>
  </details>;
}
