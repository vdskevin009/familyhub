import { spawn } from "node:child_process";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

/** Email prompts/results stay in memory: no persisted Codex session or raw stderr log. */
export async function privateCodex(prompt: string, schema: unknown, work: string): Promise<string> {
  await mkdir(work, { recursive: true });
  const schemaPath = join(work, `schema-${randomUUID()}.json`);
  await writeFile(schemaPath, JSON.stringify(schema), "utf8");
  try {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(process.env.FAMILYHUB_CODEX_PATH || "codex", ["exec", "--ephemeral", "--json",
        "--skip-git-repo-check", "--sandbox", "read-only", "--cd", work,
        "-c", 'approval_policy="never"', "-c", "features.shell_tool=false", "-c", "mcp_servers={}",
        "-c", "features.apps=false", "-c", 'history.persistence="none"',
        "-c", 'web_search="disabled"',
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
