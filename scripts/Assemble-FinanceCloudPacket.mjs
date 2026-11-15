/** No network. Inputs and outputs remain outside Git. */
import {assembleFinanceCloudPacket} from './finance-cloud-packet.mjs';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2);if(args.length!==5)throw Error('dataDir evidenceDir packDir admissionFile packetManifest required.');
try{const [dataArg,evidenceArg,packArg,admissionArg,packetArg]=args;console.log(JSON.stringify(await assembleFinanceCloudPacket({dataArg,evidenceArg,packArg,admissionArg,packetArg,repoArg:fileURLToPath(new URL('..',import.meta.url))})))}catch{console.error(JSON.stringify({status:'blocked-native-packet-validation',applied:false,globalComplete:false}));process.exitCode=1}
