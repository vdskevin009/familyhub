import { spawn } from "node:child_process";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

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
  await mkdir(work, { recursive: true });
  const schemaPath = join(work, `schema-${randomUUID()}.json`);
  await writeFile(schemaPath, JSON.stringify(schema), "utf8");
  try {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(privateCodexBinary(), ["exec", "--ephemeral", "--json",
        "--skip-git-repo-check", "--sandbox", "read-only", "--cd", work,
        "-c", 'approval_policy="never"', "-c", "features.shell_tool=false", "-c", "mcp_servers={}",
        "-c", "features.apps=false", "-c", 'history.persistence="none"',
        "-c", 'web_search="disabled"',
        ...images.flatMap(path => ["--image", path]),
        "--output-schema", schemaPath, "-"], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"],
        signal: AbortSignal.timeout(90_000) });
      let buffer = "", result = "", failed = false;
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        if (buffer.length > 2_000_000) { failed = true; child.kill(); return; }
        let end: number;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          try {
            const event = JSON.parse(line);
            if (event.type === "item.completed" && event.item?.type === "agent_message") result = event.item.text;
            if (event.type === "turn.failed" || event.type === "error") failed = true;
          } catch { /* Never forward raw CLI output containing private data. */ }
        }
      });
      child.on("error", () => reject(new Error("Private Codex analysis unavailable.")));
      child.stdin.on("error", () => { /* Close/error event reports a generic failure. */ });
      child.on("close", code => code === 0 && result && !failed ? resolve(result)
        : reject(new Error("Private Codex analysis failed; review or retry locally.")));
      child.stdin.end(prompt);
    });
  } finally { await unlink(schemaPath).catch(() => {}); }
}
