import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { discoverPrivateIsolation, privateIsolationMetadata, privateFilesystemOverrides, verifyPrivateEffectiveConfig,
  verifyPrivateFilesystemConfig, privateAnalysisEventReader } from "./private-codex-isolation.js";

export class PrivateCodexAnalysisError extends Error {
  constructor(readonly diagnostics: Record<string, boolean | number | string | string[] | null>) { super("Private Codex analysis failed; review or retry locally."); }
}

/** Resolve the existing SDK's native CLI even when Task Scheduler has no Codex on PATH. */
export function privateCodexBinary(): string {
  if (process.env.FAMILYHUB_CODEX_PATH) return process.env.FAMILYHUB_CODEX_PATH;
  const platforms: Record<string, string> = { 'win32-x64': 'x86_64-pc-windows-msvc', 'win32-arm64': 'aarch64-pc-windows-msvc',
    'linux-x64': 'x86_64-unknown-linux-musl', 'linux-arm64': 'aarch64-unknown-linux-musl',
    'darwin-x64': 'x86_64-apple-darwin', 'darwin-arm64': 'aarch64-apple-darwin' };
  const triple = platforms[`${process.platform}-${process.arch}`];
  if (!triple) throw new Error("Private Codex platform unavailable.");
  try {
    const sdkRequire = createRequire(import.meta.resolve("@openai/codex-sdk"));
    const cliRequire = createRequire(sdkRequire.resolve("@openai/codex/package.json"));
    const platformPackage = cliRequire.resolve(`@openai/codex-${process.platform}-${process.arch}/package.json`);
    const root = join(dirname(platformPackage), "vendor", triple);
    const name = process.platform === "win32" ? "codex.exe" : "codex";
    const binary = [join(root, "bin", name), join(root, "codex", name)].find(existsSync);
    if (binary) return binary;
  } catch { /* Never expose private environment values or raw resolver errors. */ }
  throw new Error("Private Codex CLI unavailable. Install worker dependencies or configure FAMILYHUB_CODEX_PATH.");
}

/** Email prompts/results stay in memory: no persisted Codex session or raw stderr log. */
export async function privateCodex(prompt: string, schema: unknown, work: string, images: string[] = []): Promise<string> {
  const deadline = AbortSignal.timeout(PRIVATE_TOTAL_TIMEOUT_MS);
  await mkdir(work, { recursive: true });
  const schemaPath = join(work, `schema-${randomUUID()}.json`);
  await writeFile(schemaPath, JSON.stringify(schema), "utf8");
  try {
    const binary = privateCodexBinary();
    const isolation = await discoverPrivateIsolation(binary, work, deadline);
    const profile = `familyhub-private-${randomUUID()}`, inputs = [schemaPath, ...images];
    const overrides = [...isolation.overrides, ...privateFilesystemOverrides(profile, inputs)];
    const effective = await privateIsolationMetadata(binary, work, true, overrides, deadline);
    verifyPrivateEffectiveConfig(effective); verifyPrivateFilesystemConfig(effective, profile, inputs);
    const result = await (async () => {
      const modelDeadline = AbortSignal.any([deadline, AbortSignal.timeout(PRIVATE_EXECUTION_TIMEOUT_MS)]);
      const child = spawn(binary, ["exec", "--ephemeral", "--json", "--strict-config",
        "--skip-git-repo-check", "--cd", work,
        ...overrides.flatMap(value => ["-c", value]),
        ...images.flatMap(path => ["--image", path]),
        "--output-schema", schemaPath, "-"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
        });
      return collectPrivateProcess(child, privateAnalysisEventReader({ effective, profile, inputs }), prompt, modelDeadline);
    })();
    const after = await discoverPrivateIsolation(binary, work, deadline);
    if (after.revision !== isolation.revision || JSON.stringify(after.overrides) !== JSON.stringify(isolation.overrides)) throw new Error("Private analysis configuration changed.");
    return result;
  } finally { await unlink(schemaPath).catch(() => {}); }
}

export const PRIVATE_EXECUTION_TIMEOUT_MS = 240_000;
export const PRIVATE_TOTAL_TIMEOUT_MS = 300_000;
/** Own-child close is the settlement boundary, including aborts and invalid output. */
export function collectPrivateProcess(child: ChildProcessWithoutNullStreams, reader: ReturnType<typeof privateAnalysisEventReader>, prompt: string, modelDeadline: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
      let failed = false, stderr = "";
      const stop = () => { failed = true; child.kill(); };
      modelDeadline.addEventListener("abort", stop, { once: true });
      if (modelDeadline.aborted) stop();
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-16_000); });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        try { if (!failed) reader.feed(chunk); } catch { failed = true; child.kill(); }
      });
      child.on("error", () => { failed = true; });
      child.stdin.on("error", stop);
      child.on("close", code => { modelDeadline.removeEventListener("abort", stop); try { if (failed || modelDeadline.aborted) throw new Error(); resolve(reader.finish(code)); }
        catch { reject(new PrivateCodexAnalysisError({ ...reader.diagnostics(), timedOut: modelDeadline.aborted, exitCode: code,
          accessDenied: /permission denied|access denied|refusing to run unsandboxed|approval required/i.test(stderr),
          sandboxUnsupported: /cannot enforce|sandbox.*not supported|sandbox.*unavailable|package identity/i.test(stderr),
          inputReadFailed: /failed to (?:read|load).*(?:image|AGENTS|schema)/i.test(stderr),
          serviceFailed: /(?:connection|transport|websocket).*(?:failed|error)|(?:status|HTTP)[ :]+(?:401|403|429|5\d\d)\b/i.test(stderr),
        })); } });
      if (!modelDeadline.aborted) { try { child.stdin.end(prompt); } catch { stop(); } }
  });
}
