import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

export const dataDirectory = process.env.FAMILYHUB_WORKER_DATA?.trim() || join(homedir(), ".familyhub-worker");

export async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = path + "." + randomUUID() + ".tmp";
  await writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
  await rename(tmp, path);
}

// DPAPI is scoped to this Windows user. Secrets travel over stdin/stdout pipes, never command arguments or logs.
async function dpapi(value: string, decrypt: boolean): Promise<string> {
  if (process.platform !== "win32") throw new Error("Daily Gmail authorization currently requires Windows DPAPI.");
  const script = "$ErrorActionPreference='Stop'; $s=[Console]::In.ReadToEnd(); " + (decrypt
    ? "$p=ConvertTo-SecureString $s; $b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($p); try {[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($b))} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)}"
    : "$p=ConvertTo-SecureString $s -AsPlainText -Force; [Console]::Write((ConvertFrom-SecureString $p))");
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env };
    // PowerShell 7's inherited module path can break Windows PowerShell's DPAPI cmdlets.
    for (const key of Object.keys(childEnv)) if (key.toLowerCase() === "psmodulepath") delete childEnv[key];
    const child = spawn(process.env.FAMILYHUB_POWERSHELL || "powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: childEnv, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Windows credential protection timed out.")); }, 20_000);
    child.stdout.on("data", chunk => output += chunk.toString());
    child.stderr.resume();
    child.on("error", () => { clearTimeout(timer); reject(new Error("Windows credential protection is unavailable.")); });
    child.on("close", code => { clearTimeout(timer); code === 0 ? resolve(output.trim()) : reject(new Error("Could not unlock local credentials for this Windows user.")); });
    child.stdin.on("error", () => {});
    child.stdin.end(value);
  });
}
export async function savePrivate(path: string, value: unknown): Promise<void> {
  await atomicJson(path, { encrypted: await dpapi(JSON.stringify(value), false) });
}
export async function loadPrivate<T>(path: string): Promise<T> {
  const wrapped = JSON.parse(await readFile(path, "utf8")) as { encrypted: string };
  return JSON.parse(await dpapi(wrapped.encrypted, true)) as T;
}
