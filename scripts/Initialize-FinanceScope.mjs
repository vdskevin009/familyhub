/** Local policy preparation only; no source calls or admission. */
import {initializeFinanceScope} from '../apps/worker/src/finance-scope-initializer.ts';
const args=process.argv.slice(2);if(args.length!==2)throw Error('Explicit dataDir and reviewedPolicyFile required.');
try{console.log(JSON.stringify(await initializeFinanceScope(...args)))}catch{console.error(JSON.stringify({status:'blocked-local-scope-review-required'}));process.exitCode=1}
