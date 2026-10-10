import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { atomicJson } from "./private-store.js";
import { defaultNotificationPreferences, notificationCandidates, notificationKinds, type Candidate, type NotificationEvent, type NotificationEvidence, type NotificationPreferences } from "./notification-model.js";
import { validateSubscription, type PushSubscriptionData, type PushOutcome, type VapidConfig } from "./notification-push.js";

type Delivery = { at: string; outcome: PushOutcome; eventId: string; confirmedAt?: string };
type Device = { id: string; label: string; subscription: PushSubscriptionData; createdAt: string; publicKey: string; enabled: boolean; lastDelivery?: Delivery };
type Stored = { schema: 1; revision: string; initialized: Candidate["source"][]; seen: string[]; events: NotificationEvent[]; preferences: NotificationPreferences; devices: Device[]; scannedAt?: string; sourceErrors: string[] };
export type NotificationSnapshot = Omit<Stored, "schema" | "seen" | "initialized" | "devices"> & { devices: Omit<Device, "subscription" | "publicKey">[]; pushConfigured: boolean; publicKey: string | null; pushSetupError?: string };
export class NotificationConflict extends Error {}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const empty = (): Stored => ({ schema: 1, revision: "empty", initialized: [], seen: [], events: [], preferences: defaultNotificationPreferences(), devices: [], sourceErrors: [] });
const idPattern = /^[a-f0-9]{64}$/;
const sources = ["invoices", "collections", "contracts", "finance"];
const text = (v: unknown, max: number) => typeof v === "string" && v.length <= max;
const timestamp = (v: unknown) => typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v));
export class NotificationLibrary {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private path: string, private configuration: () => Promise<VapidConfig | null>, private send: (subscription: PushSubscriptionData, eventId: string, config: VapidConfig) => Promise<PushOutcome>) {}
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.then(action, action);
    this.tail = next.catch(() => {});
    return next;
  }
  private async load(): Promise<Stored> {
    try {
      const data = JSON.parse(await readFile(this.path, "utf8")) as Stored;
      if (!data || data.schema !== 1 || !text(data.revision, 100) || !Array.isArray(data.initialized) || data.initialized.some(s => !sources.includes(s)) || !Array.isArray(data.seen) || data.seen.some(id => typeof id !== "string" || !idPattern.test(id)) || !Array.isArray(data.events) || data.events.length > 500 || !data.preferences || notificationKinds.some(k => typeof data.preferences[k] !== "boolean") || Object.keys(data.preferences).some(k => !notificationKinds.includes(k as typeof notificationKinds[number])) || !Array.isArray(data.devices) || data.devices.length > 20 || !Array.isArray(data.sourceErrors) || data.sourceErrors.some(s => !text(s, 100)) || data.scannedAt !== undefined && !timestamp(data.scannedAt)) throw new Error();
      if (new Set(data.events.map(e => e.id)).size !== data.events.length || new Set(data.devices.map(d => d.id)).size !== data.devices.length) throw new Error();
      for (const event of data.events) {
        if (!idPattern.test(event.id) || !notificationKinds.includes(event.kind) || !text(event.title, 1000) || !text(event.detail, 5000) || !timestamp(event.createdAt) || event.readAt !== undefined && !timestamp(event.readAt) || event.sourceDate !== undefined && !timestamp(event.sourceDate) || typeof event.baseline !== "boolean" || typeof event.active !== "boolean" || !["savings", "finances", "reimbursements"].includes(event.target?.view)) throw new Error();
        const target = event.target;
        if (Object.keys(target).some(k => !["view", "recordId", "queue", "tab", "accountId", "from", "to", "currency", "sources"].includes(k)) || [target.recordId, target.accountId, target.from, target.to, target.currency].some(v => v !== undefined && !text(v, 500)) || target.queue !== undefined && target.queue !== "unmatched" || target.tab !== undefined && target.tab !== "investments" || target.sources !== undefined && typeof target.sources !== "boolean") throw new Error();
      }
      for (const device of data.devices) {
        validateSubscription(device.subscription);
        if (device.id !== hash(device.subscription.endpoint) || !text(device.label, 60) || !device.label.trim() || typeof device.enabled !== "boolean" || !text(device.publicKey, 100) || !timestamp(device.createdAt)) throw new Error();
        const delivery = device.lastDelivery;
        if (delivery && (!timestamp(delivery.at) || !idPattern.test(delivery.eventId) || !["accepted", "expired", "failed", "unconfirmed"].includes(delivery.outcome) || delivery.confirmedAt !== undefined && (!timestamp(delivery.confirmedAt) || delivery.outcome !== "accepted"))) throw new Error();
      }
      return data;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty(); throw new Error("Historique de notifications illisible. Aucun fichier remplacé; vérifiez la sauvegarde privée."); }
  }
  private async save(state: Stored) { state.revision = randomUUID(); await atomicJson(this.path, state); }
  private async expose(state: Stored): Promise<NotificationSnapshot> {
    const { config, error } = await this.pushConfiguration();
    return { revision: state.revision, events: state.events, preferences: state.preferences, scannedAt: state.scannedAt, sourceErrors: state.sourceErrors, devices: state.devices.map(({ id, label, enabled, createdAt, lastDelivery }) => ({ id, label, enabled, createdAt, lastDelivery })), pushConfigured: Boolean(config), publicKey: config?.publicKey ?? null, ...(error ? { pushSetupError: error } : {}) };
  }
  private async pushConfiguration() {
    try { return { config: await this.configuration(), error: "" }; }
    catch { return { config: null, error: "Web Push indisponible sur ce PC. L'historique reste accessible; aucune identité d'envoi remplacée." }; }
  }
  read() { return this.serialize(async () => this.expose(await this.load())); }
  scan(evidence: NotificationEvidence, errors: string[] = [], now = new Date()) {
    return this.serialize(async () => {
      const state = await this.load(), { candidates, ready } = notificationCandidates(evidence, now);
      const seen = new Set(state.seen), initial = new Set(state.initialized), current = new Map(candidates.map(c => [hash(c.key), c]));
      const fresh: NotificationEvent[] = [];
      for (const event of state.events) {
        // Sources unavailable on this scan cannot resolve existing alerts.
        const candidate = current.get(event.id);
        if (candidate) { event.active = true; event.detail = candidate.detail; event.title = candidate.title; }
        else if (ready.includes(event.kind === "collection" ? "collections" : ["reimbursement", "unmatched"].includes(event.kind) ? "invoices" : event.target.view === "savings" ? "contracts" : "finance")) event.active = false;
      }
      for (const c of candidates) {
        const id = hash(c.key);
        if (seen.has(id)) continue;
        seen.add(id);
        const { key: _key, source, ...content } = c;
        const event: NotificationEvent = { ...content, id, createdAt: now.toISOString(), baseline: !initial.has(source), active: current.has(id) };
        state.events.push(event);
        if (!event.baseline && state.preferences[event.kind]) fresh.push(event);
      }
      state.seen = [...seen];
      state.events = state.events.slice(-500);
      state.initialized = [...new Set([...state.initialized, ...ready])];
      state.scannedAt = now.toISOString(); state.sourceErrors = errors;
      // Persist deduplication before any network side effect. No replay after an uncertain send.
      await this.save(state);
      const { config } = await this.pushConfiguration();
      if (config && fresh.length) {
        const event = fresh.at(-1)!; // One generic notice per device/scan, even after a large import.
        await this.deliver(state, state.devices.filter(d => d.enabled && d.publicKey === config.publicKey), event.id, config, now);
      }
      return this.expose(state);
    });
  }
  private async deliver(state: Stored, devices: Device[], eventId: string, config: VapidConfig, now: Date) {
    if (!devices.length) return;
    for (const device of devices) device.lastDelivery = { at: now.toISOString(), outcome: "unconfirmed", eventId };
    await this.save(state);
    // Each transport has an eight-second bound; a slow device cannot block all others serially.
    await Promise.all(devices.map(async device => {
      let outcome: PushOutcome;
      try { outcome = await this.send(device.subscription, eventId, config); } catch { outcome = "unconfirmed"; }
      device.lastDelivery!.outcome = outcome;
      if (outcome === "expired") device.enabled = false;
    }));
    await this.save(state);
  }
  mutate(input: unknown) {
    return this.serialize(async () => {
      const state = await this.load();
      const body = input as Record<string, unknown>;
      if (!body || typeof body !== "object" || body.expectedRevision !== state.revision) throw new NotificationConflict("Les notifications ont changé. Actualisez avant de réessayer.");
      if (body.action === "preferences") {
        const value = body.preferences as NotificationPreferences;
        if (!value || notificationKinds.some(k => typeof value[k] !== "boolean") || Object.keys(value).some(k => !notificationKinds.includes(k as typeof notificationKinds[number]))) throw new Error("Préférences invalides.");
        state.preferences = { ...value };
      } else if (body.action === "read") {
        if (typeof body.id !== "string" || !idPattern.test(body.id)) throw new Error("Notification invalide.");
        const event = state.events.find(e => e.id === body.id);
        if (!event) throw new Error("Cette notification n’est plus dans l’historique.");
        event.readAt = new Date().toISOString();
      } else if (body.action === "enroll") {
        const config = await this.configuration();
        if (!config || body.publicKey !== config.publicKey) throw new Error("Configuration Web Push absente ou modifiée. Actualisez avant l’inscription.");
        if (body.permission !== "granted" || typeof body.label !== "string" || !body.label.trim() || body.label.length > 60) throw new Error("Confirmez l’autorisation et le nom de cet appareil.");
        const subscription = validateSubscription(body.subscription), id = hash(subscription.endpoint);
        const previous = state.devices.find(d => d.id === id);
        if (!previous && state.devices.length >= 20) throw new Error("Retirez un ancien appareil avant d’en ajouter un autre.");
        state.devices = [...state.devices.filter(d => d.id !== id), { id, label: body.label.trim(), subscription, enabled: true, publicKey: config.publicKey, createdAt: previous?.createdAt ?? new Date().toISOString(), lastDelivery: previous?.lastDelivery }];
      } else if (["disable", "remove", "test", "receipt"].includes(String(body.action))) {
        const device = state.devices.find(d => d.id === body.id);
        if (!device) throw new Error("Appareil introuvable. Actualisez cette liste.");
        if (body.action === "remove") state.devices = state.devices.filter(d => d.id !== device.id);
        if (body.action === "disable") device.enabled = false;
        if (body.action === "receipt") {
          if (!device.lastDelivery || device.lastDelivery.eventId !== body.eventId || device.lastDelivery.outcome !== "accepted") throw new Error("Aucun envoi accepté à confirmer.");
          device.lastDelivery.confirmedAt = new Date().toISOString();
        }
        if (body.action === "test") {
          const config = await this.configuration();
          if (!config || !device.enabled || device.publicKey !== config.publicKey) throw new Error("Réactivez cet appareil avant un test.");
          if (device.lastDelivery && Date.now() - Date.parse(device.lastDelivery.at) < 60_000) throw new Error("Attendez une minute avant un autre test.");
          const id = hash(randomUUID());
          state.events.push({ id, kind: "collection", title: "Test de notification", detail: "Test demandé depuis un appareil associé. L’acceptation par le service Push ne prouve pas sa réception sur le téléphone.", target: { view: "reimbursements" }, createdAt: new Date().toISOString(), active: true, baseline: false });
          state.events = state.events.slice(-500);
          await this.deliver(state, [device], id, config, new Date());
        }
      } else throw new Error("Action de notification invalide.");
      await this.save(state);
      return this.expose(state);
    });
  }
}
