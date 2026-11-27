import { useState } from 'react';
import type { PropertyCard } from '../property-api';
import { evaluateSales, newSale, type Sale } from '../opportunity-analysis';

const cad = (n: number) => new Intl.NumberFormat('fr-CA', {style:'currency',currency:'CAD',maximumFractionDigits:0}).format(n);

export function ComparableSales({card, at}: {card: PropertyCard; at:number}) {
  const [rows,setRows] = useState<Sale[]>([]);
  const [area,setArea] = useState('');
  const [source,setSource] = useState('');
  const result = evaluateSales(card,rows,at,area,source);
  function edit(index:number, patch: Partial<Sale>) {
    setRows(previous => previous.map((row,i) => i === index ? {...row,...patch} : row));
  }
  return <details className="decision-sales">
    <summary>Examiner des comparables documentés</summary>
    <p>Utilisez des ventes conclues en dollars canadiens. Cette grille de travail reste sur cet écran et s’efface à la fermeture de la fiche.</p>
    <label>Surface habitable du bien (pi²)<input type="number" min="1" value={area} onChange={e=>setArea(e.target.value)}/></label>
    <label>Source publique de la surface du bien<input type="url" value={source} onChange={e=>setSource(e.target.value)}/></label>
    {rows.map((row,i)=><fieldset key={i}><legend>Référence {i+1}</legend>
      <label>Type de prix<select value={row.kind} onChange={e=>edit(i,{kind:e.target.value as Sale['kind']})}><option value="asking">Affiché</option><option value="sold">Vendu</option></select></label>
      <label>Adresse avec numéro de lot ou d’unité<input value={row.address} onChange={e=>edit(i,{address:e.target.value})}/></label>
      <label>Prix documenté (CAD)<input type="number" min="0.01" step="0.01" value={row.amount} onChange={e=>edit(i,{amount:e.target.value})}/></label>
      <label>Surface habitable (pi²)<input type="number" min="1" value={row.area} onChange={e=>edit(i,{area:e.target.value})}/></label>
      <label>Source publique du prix et des caractéristiques<input type="url" value={row.source} onChange={e=>edit(i,{source:e.target.value})}/></label>
      <label>{row.kind==='sold'?'Date de la vente':'Date du prix affiché'}<input type="date" value={row.eventDate} onChange={e=>edit(i,{eventDate:e.target.value})}/></label>
      <label>Date de consultation de la source<input type="date" value={row.checkedDate} onChange={e=>edit(i,{checkedDate:e.target.value})}/></label>
      <label>Caractéristiques et différences relevées<input value={row.rationale} onChange={e=>edit(i,{rationale:e.target.value})}/></label>
      <label className="decision-check"><input type="checkbox" checked={row.comparable} onChange={e=>edit(i,{comparable:e.target.checked})}/>J’ai vérifié le même secteur, type, régime de propriété et nombre de chambres, un état comparable et une vente indépendante sans ajustement important.</label>
      <strong>{result.rows[i].reason || 'Vente retenue selon votre vérification'}</strong>
      <button type="button" onClick={()=>setRows(previous=>previous.filter((_,j)=>i!==j))}>Retirer la référence {i+1}</button>
    </fieldset>)}
    {rows.length<6&&<button type="button" onClick={()=>setRows(previous=>[...previous,newSale()])}>Ajouter une référence</button>}
    <div role="status"><strong>{result.verdict}</strong>{rows.length>0 && <p>{result.count} vente(s) retenue(s) sur {rows.length} référence(s).</p>}
      {result.range&&<p>{result.count} ventes retenues · {cad(result.range.low)} à {cad(result.range.high)}. Position descriptive fondée sur vos vérifications.</p>}
    </div>
    <details><summary>Règles de lecture</summary><p>Au moins trois ventes distinctes des 180 derniers jours, surfaces à ±10 %, et prix le plus élevé au plus 20 % au-dessus du plus bas. Ces seuils de tri sont propres à FamilyHub. Un écart de tenure, d’état ou une cotisation spéciale peut invalider la comparaison. Une expertise reste nécessaire pour ajuster les valeurs.</p></details>
  </details>;
}
