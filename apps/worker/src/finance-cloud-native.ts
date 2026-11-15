/** CSV interpretation is explicit; original bytes remain the authoritative lossless artifact. */
export function parseNativeFinanceCsv(text:string):Record<string,any>[] {
 const records:string[][]=[];let row:string[]=[],cell='',quoted=false,afterQuote=false;
 const fail=()=>{throw Error('Native finance export is invalid or unsupported.');};
 if(text.charCodeAt(0)===0xfeff)text=text.slice(1);
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++}else{quoted=false;afterQuote=true}}else cell+=c;continue}
  if(afterQuote&&!['\r','\n',','].includes(c))fail();
  if(c==='"'){if(cell||afterQuote)fail();quoted=true}else if(c===','){row.push(cell);cell='';afterQuote=false}else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);records.push(row);row=[];cell='';afterQuote=false}else cell+=c;
 }
 if(quoted)fail();if(cell||row.length||afterQuote){row.push(cell);records.push(row)}
 const header=records.shift();if(!header?.length||header.some(h=>!h)||new Set(header).size!==header.length||records.length>30000)fail();
 return records.map(cells=>{if(cells.length!==header!.length)fail();const r:Record<string,any>=Object.fromEntries(header!.map((h,i)=>[h,cells[i]]));
  if(!['item_id','account_id','transaction_id','date','amount','iso_currency_code','pending'].every(k=>typeof r[k]==='string'&&r[k]))fail();
  for(const k of ['amount','normalized_amount'])if(r[k]!==undefined){if(r[k]==='')delete r[k];else{if(!/^-?\d+(?:\.\d+)?$/.test(r[k]))fail();r[k]=Number(r[k]);if(!Number.isFinite(r[k]))fail()}}
  if(!['true','false'].includes(r.pending.toLowerCase()))fail();r.pending=r.pending.toLowerCase()==='true';
  if(r.pending_transaction_id==='')r.pending_transaction_id=null;
  const category:Record<string,any>={};for(const k of ['primary','detailed','confidence_level']){const field='personal_finance_category_'+k;if(Object.hasOwn(r,field))category[k]=r[field]||null;}
  if(Object.keys(category).length)r.personal_finance_category=category;
  return r;
 });
}
