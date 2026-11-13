import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";

// Source-only hardening: capability removal alone does not isolate filesystem reads.
// MXC root-deny/exact-input-read and network-disabled enforcement was verified with
// disposable synthetic canaries. Never fall back to a less restrictive backend.

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const invalid = () => new Error("Private analysis isolation could not be verified.");
function check(v: unknown): asserts v { if (!v) throw invalid(); }
// Verified against official rust-v0.159.2 config.schema.json. These settings only remove capabilities.
export const privateDisabledFeatures = ["apps", "plugins", "shell_tool", "unified_exec", "browser_use", "browser_use_external",
  "computer_use", "hooks", "plugin_hooks", "memories", "multi_agent", "multi_agent_v2",
  "code_mode", "code_mode_host", "code_mode_only", "js_repl", "view_image", "image_generation", "deferred_executor",
  "request_permissions_tool", "exec_permission_approvals", "request_rule", "tool_suggest", "skill_search", "skill_mcp_dependency_install",
  "send_message_to_user_async", "send_async_message", "sleep_tool", "token_budget", "current_time_reminder", "standalone_web_search"] as const;
// Official rust-v0.159.2 features/src/{legacy.rs,lib.rs}: aliases are applied in
// sorted-key order, not universally canonical-first. Reject inherited alias true
// rather than assume canonical false defeats it or change the user's config.
export const privateLegacyAliases = { codex_hooks: "hooks", memory_tool: "memories",
  collab: "multi_agent", imagegenext: "image_generation", request_permissions: "exec_permission_approvals" } as const;
function verifyLegacyAliases(features: unknown): void {
  if (features == null) return;
  check(object(features));
  for (const alias of Object.keys(privateLegacyAliases)) check(features[alias] == null || features[alias] === false);
}
export const privateBaseOverrides = ['approval_policy="never"', 'history.persistence="none"', 'web_search="disabled"',
  "agents.enabled=false", "tools.update_plan.enabled=false", ...privateDisabledFeatures.map(name => `features.${name}=false`)];

/** No Gmail dependency, credential inspection, global writes or disabling of inherited security policies. */
export function privateIsolationPlan(configRead: unknown, inventory: unknown): { overrides: string[]; revision: string } {
  check(object(configRead) && object(configRead.config) && Array.isArray(configRead.layers) && configRead.layers.length > 0
    && object(inventory) && Array.isArray(inventory.installed));
  const c = configRead.config;
  verifyLegacyAliases(c.features);
  check(object(c.mcp_servers) && object(c.plugins) && object(c.apps));
  // A saved custom permission selection may contain additional user restrictions.
  // Do not replace one without a separately reviewed intersection strategy.
  check(c.default_permissions == null);
  const plugins = new Set(Object.keys(c.plugins)), versions: unknown[] = [];
  const names = new Set<string>();
  for (const entry of inventory.installed) {
    check(object(entry) && typeof entry.pluginId === "string" && !names.has(entry.pluginId) && entry.installed === true
      && typeof entry.enabled === "boolean" && typeof entry.version === "string");
    names.add(entry.pluginId); plugins.add(entry.pluginId); versions.push([entry.pluginId, entry.version, entry.enabled]);
  }
  const key = (name: string) => { check(name.length > 0 && name.length <= 300 && !/[\r\n\0]/.test(name)); return JSON.stringify(name); };
  const disable = (section: string, keys: string[]) => `${section}={${keys.sort().map(name => `${key(name)}={enabled=false}`).join(",")}}`;
  const overrides = [...privateBaseOverrides, disable("mcp_servers", Object.keys(c.mcp_servers)), disable("plugins", [...plugins]),
    disable("apps", [...new Set([...Object.keys(c.apps), "_default"])])];
  const layers = configRead.layers.map(layer => { check(object(layer) && object(layer.name) && typeof layer.version === "string"); return [layer.name, layer.version]; });
  return { overrides, revision: JSON.stringify({ layers, plugins: versions.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) }) };
}

export function privateFilesystemOverrides(profile: string, inputs: readonly string[]): string[] {
  check(/^familyhub-private-[a-f0-9-]{36}$/.test(profile) && inputs.length >= 1 && inputs.length <= 30);
  check(new Set(inputs).size === inputs.length && inputs.every(path => typeof path === "string" && isAbsolute(path) && path.length <= 2000 && !/[\r\n\0*?]/.test(path)));
  return ['windows.sandbox="mxc"', `default_permissions=${JSON.stringify(profile)}`,
    `permissions={${JSON.stringify(profile)}={filesystem={":root"="deny",${inputs.map(path => `${JSON.stringify(path)}="read"`).join(",")}},network={enabled=false}}}`];
}

export function verifyPrivateFilesystemConfig(value: unknown, profile: string, inputs: readonly string[]): void {
  check(object(value) && object(value.config)); const c = value.config;
  check(object(c.windows) && c.windows.sandbox === "mxc" && c.default_permissions === profile && object(c.permissions));
  const selected = c.permissions[profile];
  check(object(selected) && selected.extends == null && object(selected.filesystem) && object(selected.network) && selected.network.enabled === false);
  const fs = selected.filesystem; check(fs[":root"] === "deny" && inputs.every(path => fs[path] === "read"));
  check(Object.keys(fs).every(key => key === ":root" || (key === "glob_scan_max_depth" && fs[key] == null) || inputs.includes(key)));
}

export function verifyPrivateEffectiveConfig(value: unknown): void {
  check(object(value) && object(value.config)); const c = value.config;
  verifyLegacyAliases(c.features);
  check(object(c.features) && privateDisabledFeatures.every(name => c.features && object(c.features) && c.features[name] === false));
  check(c.approval_policy === "never" && c.web_search === "disabled" && object(c.history) && c.history.persistence === "none"
    && object(c.agents) && c.agents.enabled === false);
  // config/read omits update_plan from its tools projection in 0.159.2; the supported override is still supplied.
  for (const section of ["mcp_servers", "plugins", "apps"]) {
    check(object(c[section]) && Object.values(c[section]).every(v => object(v) && v.enabled === false));
  }
  check(object(c.apps) && object(c.apps._default) && c.apps._default.enabled === false);
}

/** Official config/read or plugin inventory only. Output stays in memory and errors never contain config values. */
export async function privateIsolationMetadata(binary: string, cwd: string, config: boolean, overrides: readonly string[], signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted(); const deadline = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [...(config ? ["app-server", "--stdio"] : ["plugin", "list", "--json"]),
      ...overrides.flatMap(v => ["-c", v])], { cwd, windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    let buffer = "", count = 0, result: unknown, failed = false;
    const stop = () => { failed = true; child.kill(); };
    const send = (v: unknown) => child.stdin.write(JSON.stringify(v) + "\n");
    deadline.addEventListener("abort", stop, { once: true }); if (deadline.aborted) stop();
    child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk: string) => {
      try {
        count += Buffer.byteLength(chunk); check(count <= 8_000_000); buffer += chunk;
        if (!config) return;
        let end: number; while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (!line.trim()) continue;
          const event: unknown = JSON.parse(line); check(object(event) && !event.error);
          if (event.id === 1) { send({ method: "initialized" }); send({ method: "config/read", id: 2, params: { includeLayers: true } }); }
          if (event.id === 2) { check(object(event.result) && result === undefined); result = event.result; child.stdin.end(); }
        }
      } catch { stop(); }
    });
    child.stdin.on("error", stop); child.on("error", stop);
    child.on("close", code => {
      deadline.removeEventListener("abort", stop);
      try { check(!failed && !deadline.aborted && code === 0); if (!config) result = JSON.parse(buffer); check(result); resolve(result); }
      catch { reject(invalid()); }
    });
    if (config) send({ method: "initialize", id: 1, params: { clientInfo: { name: "familyhub_private_isolation", version: "1.0.0" } } });
    else child.stdin.end();
  });
}

export async function discoverPrivateIsolation(binary: string, cwd: string, signal: AbortSignal) {
  const results = await Promise.allSettled([
    privateIsolationMetadata(binary, cwd, true, privateBaseOverrides, signal),
    privateIsolationMetadata(binary, cwd, false, privateBaseOverrides, signal),
  ]);
  check(results[0].status === "fulfilled" && results[1].status === "fulfilled");
  return privateIsolationPlan(results[0].value, results[1].value);
}

/** Defense in depth only: event rejection is not a substitute for removing tool exposure before the prompt. */
export const disabledCodeModeWarning = "Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`.";
export function privateAnalysisEventReader(verified?: { effective: unknown; profile: string; inputs: readonly string[] }) {
  if (verified) { verifyPrivateEffectiveConfig(verified.effective); verifyPrivateFilesystemConfig(verified.effective, verified.profile, verified.inputs); }
  let threadStarted = false, contentSeen = false, startupWarningAccepted = false;
  let buffer = "", total = 0, result = "", completed = false;
  let turnStarted = false, rejectedEvent = false;
  const eventTypes = new Set<string>(), itemTypes = new Set<string>();
  const knownEvents = ["thread.started", "turn.started", "turn.completed", "turn.failed", "item.started", "item.updated", "item.completed", "error"];
  const knownItems = ["agent_message", "reasoning", "todo_list", "error", "mcp_tool_call", "command_execution", "file_change", "web_search"];
  const knownCodes = ["server_error", "invalid_request_error", "authentication_error", "permission_denied", "rate_limit_exceeded", "timeout", "model_not_found", "insufficient_quota", "unauthorized", "forbidden"];
  let errorCode: string | number | null = null, httpStatus: number | null = null;
  const captureCode = (v: unknown) => {
    if (!object(v)) return;
    if ((typeof v.code === "number" && Number.isSafeInteger(v.code)) || (typeof v.code === "string" && knownCodes.includes(v.code))) errorCode = v.code;
    for (const key of ["status", "status_code", "http_status_code"]) {
      const status = v[key]; if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) httpStatus = status;
    }
  };
  return {
    feed(chunk: string) {
      total += Buffer.byteLength(chunk); check(total <= 2_000_000); buffer += chunk;
      let end: number; while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (!line.trim()) continue;
        const event: unknown = JSON.parse(line); check(object(event));
        check(!completed);
        eventTypes.add(knownEvents.includes(String(event.type)) ? String(event.type) : "unknown");
        captureCode(event); captureCode(event.error);
        if (!["thread.started", "turn.started", "turn.completed", "item.started", "item.updated", "item.completed"].includes(String(event.type))) { rejectedEvent = true; throw invalid(); }
        if (event.type === "thread.started") { check(!threadStarted && !turnStarted && !contentSeen); threadStarted = true; }
        if (event.type === "turn.started") { check(threadStarted && !turnStarted); turnStarted = true; }
        if (typeof event.type === "string" && event.type.startsWith("item.")) {
          itemTypes.add(object(event.item) && knownItems.includes(String(event.item.type)) ? String(event.item.type) : "unknown");
          captureCode(event.item);
          // 0.159.2 encodes this nonfatal Warning notification as an ErrorItem.
          // Only the exact disabled-host warning is safe, before any turn/content.
          if (verified && event.type === "item.completed" && object(event.item) && event.item.type === "error"
            && event.item.message === disabledCodeModeWarning
            && Object.keys(event).every(key => ["type", "item"].includes(key))
            && Object.keys(event.item).every(key => ["id", "type", "message"].includes(key))
            && (event.item.id === undefined || typeof event.item.id === "string") && threadStarted && !turnStarted && !completed
            && !contentSeen && !startupWarningAccepted && errorCode === null && httpStatus === null) {
            startupWarningAccepted = true; continue;
          }
          check(threadStarted && turnStarted);
          contentSeen = true;
          if (!object(event.item) || !["agent_message", "reasoning", "todo_list"].includes(String(event.item.type))) { rejectedEvent = true; throw invalid(); }
          if (event.item.type === "todo_list") check(Array.isArray(event.item.items) && event.item.items.length <= 100
            && event.item.items.every(item => object(item) && typeof item.text === "string" && typeof item.completed === "boolean"));
          if (event.type === "item.completed" && event.item.type === "agent_message") { check(typeof event.item.text === "string"); result = event.item.text; }
        }
        if (event.type === "turn.completed") { check(threadStarted && turnStarted && !completed); completed = true; }
      }
    },
    finish(code: number | null) { check(code === 0 && !buffer.trim() && completed && result); return result; },
    diagnostics() { return { outputBytes: total, turnStarted, agentMessage: !!result, turnCompleted: completed, rejectedEvent,
      startupWarningAccepted, eventTypes: [...eventTypes], itemTypes: [...itemTypes], errorCode, httpStatus }; },
  };
}
