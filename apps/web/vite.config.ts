import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
function releaseIdentity() {
  try { return process.env.GITHUB_SHA || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); }
  catch { return "unknown"; }
}
export default defineConfig({
  plugins: [react(), { name: "familyhub-release", generateBundle() {
    this.emitFile({ type: "asset", fileName: "release.json", source: JSON.stringify({ schema: 1, revision: releaseIdentity(), builtAt: new Date().toISOString(), product: "familyhub", capabilities: ["proactive-home-v1", "mobile-five-nav-v1"] }) });
  } }],
  base: "/familyhub/",
  build: { outDir: "dist", sourcemap: true }
});
