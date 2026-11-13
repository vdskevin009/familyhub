import { mailSourceReadiness } from "./mail-source-policy.js";
try { const result = await mailSourceReadiness(); console.log(JSON.stringify(result)); if (!result.ready) process.exitCode = 1; }
catch { console.error("Mail source configuration is invalid or unavailable. No source was changed."); process.exitCode = 1; }
