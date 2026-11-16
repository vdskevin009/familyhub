import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
/** New reviewed scopes bind optional inference policy bytes. Legacy absence stays exact. */
export async function assertInferencePolicyPin(directory:string,expected?:string){
 if(expected!==undefined&&!/^[a-f0-9]{64}$/.test(expected))throw Error('Invalid inference policy pin');
 let actual:string|undefined;
 try{actual=createHash('sha256').update(await readFile(join(directory,'contributions','inference-policy.json'))).digest('hex')}
 catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 if(actual!==expected)throw Error('Inference policy changed or is not bound to reviewed scope');
}
