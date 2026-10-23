import { validateContact } from "./mortgage-contacts.js";
import { mkdir, readFile, open, rename, unlink, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { emptyMortgage, validateSnapshot, validateQuote, validateAssumptions, validateState, mortgageBaseline, type MortgageState } from "./mortgage-model.js";
export class MortgageConflict extends Error {}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return "["+v.map(canonical).join(",")+"]";
  if(v && typeof v === "object") return "{"+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+":"+canonical(v)).join(",")+"}";
  return JSON.stringify(v);
}
async function immutable(path: string, content: string): Promise<boolean> {
  const lock=path+".lock", started=Date.now();
  for (;;) {
    try { await mkdir(lock); break; }
    catch(e) { if((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; if(Date.now()-started>5000) throw Error("Mortgage evidence locked; check interrupted ingestion before retrying"); await new Promise(r=>setTimeout(r,20)); }
  }
  const temp=path+"."+randomUUID()+".tmp";
  try {
    try { await readFile(path); return false; } catch(e) { if((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    const file=await open(temp,"wx",0o600);
    try { await file.writeFile(content,"utf8"); await file.sync(); } finally { await file.close(); }
    await rename(temp,path); return true;
  } finally { await unlink(temp).catch(e=>{if(e.code!=="ENOENT")throw e;}); await rmdir(lock); }
}
/** Immutable per-record files. Exclusive directory locks and atomic rename protect simultaneous writers. */
export class MortgageStore {
  constructor(private directory: string) {}
  async read(): Promise<MortgageState> {
    const state = emptyMortgage();
    const { readdir } = await import("node:fs/promises");
    let files: string[]; try { files = await readdir(this.directory); } catch(e) { if((e as NodeJS.ErrnoException).code === "ENOENT") return state; throw e; }
    for(const name of files.filter(f=>/^(snapshot|quote|assumptions|contact)-[a-f0-9]{64}\.json$/.test(f)).sort()) {
      const record=JSON.parse(await readFile(join(this.directory,name),"utf8"));
      if(name.startsWith("snapshot-")) state.snapshots.push(validateSnapshot(record)); else if(name.startsWith("quote-")) state.quotes.push(validateQuote(record)); else if(name.startsWith("contact-")) state.contacts!.push(validateContact(record)); else state.assumptions.push(validateAssumptions(record));
    }
    try { state.baselineSnapshotId=JSON.parse(await readFile(join(this.directory,"baseline.json"),"utf8")).id; } catch(e) { if((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    return validateState(state);
  }
  async ingest(kind: "snapshot" | "quote" | "assumptions" | "contact", input: unknown) {
    const record = kind === "snapshot" ? validateSnapshot(input) : kind === "quote" ? validateQuote(input) : kind === "contact" ? validateContact(input) : validateAssumptions(input);
    if(kind === "quote" || kind === "contact") { const state=await this.read(); if(kind === "quote" && !state.quotes.some(q=>q.id === record.id)) state.quotes.push(validateQuote(record)); if(kind === "contact" && !state.contacts!.some(c=>c.id === record.id)) state.contacts!.push(validateContact(record)); validateState(state); }
    await mkdir(this.directory,{recursive:true});
    const name=join(this.directory,`${kind}-${createHash("sha256").update(record.id).digest("hex")}.json`), content=canonical(record);
    const added=await immutable(name,content);
    if (!added && canonical(JSON.parse(await readFile(name,"utf8")))!==content) throw new MortgageConflict("Mortgage ID conflict: existing evidence preserved");
    if (kind === "snapshot") { const s=validateSnapshot(record); if(s.localDate===mortgageBaseline && s.status==="complete") await immutable(join(this.directory,"baseline.json"),JSON.stringify({id:s.id})); }
    return {duplicate:!added};
  }
}
