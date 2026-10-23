import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { atomicJson } from "./private-store.js";
import { insuranceRenewalOpportunityId, type OpportunityActionsSnapshot } from "./opportunity-actions.js";
import { defaultNotificationPreferences, notificationCandidates, notificationKinds, notificationDeliveryPolicy, localDate, type NotificationDecision, type Candidate, type NotificationEvent, type NotificationEvidence, type NotificationPreferences } from "./notification-model.js";
import { validateSubscription, type PushSubscriptionData, type PushOutcome, type VapidConfig } from "./notification-push.js";

type Delivery = { at: string; outcome: PushOutcome; eventId: string; confirmedAt?: string };
type Device = { id: string; label: string; subscription: PushSubscriptionData; createdAt: string; publicKey: string; enabled: boolean; lastDelivery?: Delivery };
type StoredEvent = NotificationEvent & { pendingDeviceIds?: string[] };
type Stored = { insuranceDatesInitialized?: boolean; decisions?: Record<string, NotificationDecision>; lastAutomaticPushAt?: string; schema: 1; revision: string; initialized: Candidate["source"][]; seen: string[]; events: StoredEvent[]; preferences: NotificationPreferences; devices: Device[]; scannedAt?: string; sourceErrors: string[] };
export type NotificationSnapshot = Omit<Stored, "schema" | "seen" | "initialized" | "devices" | "events"> & { events: NotificationEvent[]; devices: Omit<Device, "subscription" | "publicKey">[]; pushConfigured: boolean; publicKey: string | null; pushSetupError?: string; lifecycleSupported: true; deliveryPolicy: typeof notificationDeliveryPolicy };
export class NotificationConflict extends Error {}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const empty = (): Stored => ({ schema: 1, revision: "empty", initialized: [], seen: [], events: [], preferences: defaultNotificationPreferences(), devices: [], sourceErrors: [] });
const idPattern = /^[a-f0-9]{64}$/;
const sources = ["invoices", "collections", "contracts", "finance"];
const text = (v: unknown, max: number) => typeof v === "string" && v.length <= max;
const timestamp = (v: unknown) => typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v));
export class NotificationLibrary {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private path: string, private configuration: () => Promise<VapidConfig | null>, private send: (subscription: PushSubscriptionData, eventId: string, config: VapidConfig) => Promise<PushOutcome>, private opportunityActions?: () => Promise<OpportunityActionsSnapshot>) {}
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
      if (data.lastAutomaticPushAt !== undefined && !timestamp(data.lastAutomaticPushAt) || data.decisions !== undefined && (!data.decisions || typeof data.decisions !== "object" || Array.isArray(data.decisions) || Object.keys(data.decisions).length > 5000 || Object.entries(data.decisions).some(([id, d]) => !idPattern.test(id) || !this.validDecision(d)))) throw new Error();
      if (data.insuranceDatesInitialized !== undefined && typeof data.insuranceDatesInitialized !== "boolean") throw new Error();
      for (const event of data.events) {
        if (event.pendingDeviceIds !== undefined && (!Array.isArray(event.pendingDeviceIds) || event.pendingDeviceIds.length > 20 || event.pendingDeviceIds.some(id => !idPattern.test(id)))) throw new Error();
        if (event.groupId !== undefined && !idPattern.test(event.groupId) || event.evidenceVersion !== undefined && !idPattern.test(event.evidenceVersion) || event.actionable !== undefined && typeof event.actionable !== "boolean" || event.expiresAt !== undefined && !timestamp(event.expiresAt) || event.priority !== undefined && (!Number.isInteger(event.priority) || event.priority < 0 || event.priority > 3) || event.pushState !== undefined && !["pending", "handled", "expired"].includes(event.pushState)) throw new Error();
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
  private validDecision(d: NotificationDecision): boolean {
    return !!d && idPattern.test(d.evidenceVersion) && ["snoozed", "resolved", "dismissed"].includes(d.state) && timestamp(d.at)
      && (d.state === "snoozed" ? timestamp(d.snoozedUntil) && Date.parse(d.snoozedUntil!) > Date.parse(d.at) : d.snoozedUntil === undefined);
  }
  private decision(state: Stored, event: NotificationEvent) {
    const d = state.decisions?.[event.groupId ?? event.id];
    return d?.evidenceVersion === (event.evidenceVersion ?? event.id) ? d : undefined;
  }
  private async save(state: Stored) { state.revision = randomUUID(); await atomicJson(this.path, state); }
  private async expose(state: Stored): Promise<NotificationSnapshot> {
    const { config, error } = await this.pushConfiguration();
    return { lifecycleSupported: true, deliveryPolicy: notificationDeliveryPolicy, revision: state.revision, events: state.events.map(({ pendingDeviceIds: _recipients, ...e }) => ({ ...e, decision: this.decision(state, e) })), preferences: state.preferences, scannedAt: state.scannedAt, sourceErrors: state.sourceErrors, devices: state.devices.map(({ id, label, enabled, createdAt, lastDelivery }) => ({ id, label, enabled, createdAt, lastDelivery })), pushConfigured: Boolean(config), publicKey: config?.publicKey ?? null, ...(error ? { pushSetupError: error } : {}) };
  }
  private async pushConfiguration() {
    try { return { config: await this.configuration(), error: "" }; }
    catch { return { config: null, error: "Web Push indisponible sur ce PC. L'historique reste accessible; aucune identité d'envoi remplacée." }; }
  }
  read() { return this.serialize(async () => this.expose(await this.load())); }
  scan(evidence: NotificationEvidence, errors: string[] = [], now = new Date()) {
    return this.serialize(async () => {
      const state = await this.load(), { candidates, ready } = notificationCandidates(evidence, now);
      state.decisions ??= {};
      const seen = new Set(state.seen), initial = new Set(state.initialized), current = new Map(candidates.map(c => [hash(c.key), c]));
      const pendingDeviceIds = state.devices.filter(d => d.enabled).map(d => d.id), hasDevice = pendingDeviceIds.length > 0;
      const pendingState = (c: Candidate, baseline: boolean): NotificationEvent["pushState"] =>
        !baseline && hasDevice && state.preferences[c.kind] && c.actionable === true && c.pushEligible === true ? "pending" : "handled";
      for (const event of state.events) {
        const candidate = current.get(event.id);
        if (candidate) {
          const groupId = hash(candidate.groupKey ?? candidate.key), evidenceVersion = hash(candidate.evidenceKey ?? candidate.key);
          const legacy = !event.groupId ? state.decisions[event.id] : undefined;
          if (legacy?.evidenceVersion === event.id && !state.decisions[groupId]) state.decisions[groupId] = { ...legacy, evidenceVersion };
          if (event.evidenceVersion && event.evidenceVersion !== evidenceVersion) {
            // A material evidence change reopens attention; ordinary refresh timestamps never do.
            delete event.readAt; event.baseline = false; event.createdAt = now.toISOString();
            event.pushState = pendingState(candidate, false);
            event.pendingDeviceIds = event.pushState === "pending" ? [...pendingDeviceIds] : undefined;
          }
          Object.assign(event, { active: true, title: candidate.title, detail: candidate.detail, target: candidate.target,
            sourceDate: candidate.sourceDate, groupId, evidenceVersion, actionable: candidate.actionable,
            expiresAt: candidate.expiresAt, priority: candidate.priority });
          event.pushState ??= "handled"; // Upgrade never sends the historical backlog.
        } else if (ready.includes(event.kind === "collection" ? "collections" : ["reimbursement", "unmatched"].includes(event.kind) ? "invoices" : event.target.view === "savings" ? "contracts" : "finance")) {
          event.active = false;
          if (event.pushState === "pending") event.pushState = "expired";
        }
      }
      for (const c of candidates) {
        const id = hash(c.key);
        if (seen.has(id)) continue;
        seen.add(id);
        const { key: _key, source, groupKey, evidenceKey, baselineGroup, pushEligible: _pushEligible, ...content } = c;
        const baseline = !initial.has(source) || baselineGroup === "insurance-policy" && !state.insuranceDatesInitialized, groupId = hash(groupKey ?? c.key), evidenceVersion = hash(evidenceKey ?? c.key);
        state.events.push({ ...content, id, groupId, evidenceVersion,
          createdAt: now.toISOString(), baseline, active: true, pushState: pendingState(c, baseline),
          ...(pendingState(c, baseline) === "pending" ? { pendingDeviceIds: [...pendingDeviceIds] } : {}) });
      }
      state.seen = [...seen]; state.events = state.events.slice(-500);
      state.initialized = [...new Set([...state.initialized, ...ready])];
      if (ready.includes("contracts")) state.insuranceDatesInitialized = true;
      state.scannedAt = now.toISOString(); state.sourceErrors = [...errors];
      let actionSnapshot: OpportunityActionsSnapshot | undefined, actionReadFailed = false;
      if (this.opportunityActions) {
        try { actionSnapshot = await this.opportunityActions(); }
        catch { actionReadFailed = true; state.sourceErrors.push("suivi des actions d’accueil"); }
      }
      const insuranceRenewal = (candidate: Candidate) => candidate.source === "contracts" && candidate.kind === "deadline"
        && candidate.target.recordId && candidate.groupKey === `deadline:${candidate.target.recordId}:renewal`
        && evidence.contracts?.some(c => c.id === candidate.target.recordId && ["car-insurance", "home-insurance"].includes(c.category));
      const pending = state.events.filter(event => {
        if (event.pushState !== "pending") return false;
        if (!event.pendingDeviceIds?.length) { event.pushState = "handled"; return false; }
        const candidate = current.get(event.id);
        // A failed source read cannot resolve a card or allow an alert based on stale evidence.
        if (!candidate) return false;
        if (!event.active || event.readAt || !state.preferences[event.kind] || !candidate.pushEligible
          || !event.expiresAt || Date.parse(event.expiresAt) <= now.getTime()) { event.pushState = "expired"; return false; }
        if (insuranceRenewal(candidate)) {
          // Read the single durable Today decision, never mirror it into another write.
          // A failed read defers only these pushes; it neither closes nor loses the event.
          if (actionReadFailed) return false;
          const decision = actionSnapshot?.decisions[insuranceRenewalOpportunityId(candidate.target.recordId!)], context = decision?.context;
          if (decision && context?.kind === "insurance-renewal" && context.recordId === candidate.target.recordId && context.dueDate === candidate.evidenceKey) {
            if (decision.state === "resolved" || decision.state === "dismissed"
              || decision.state === "snoozed" && Date.parse(decision.snoozedUntil!) > now.getTime()) return false;
          }
        }
        const decision = this.decision(state, event);
        if (decision?.state === "resolved" || decision?.state === "dismissed") { event.pushState = "handled"; return false; }
        return !decision || decision.state !== "snoozed" || Date.parse(decision.snoozedUntil!) <= now.getTime();
      });
      const { config } = await this.pushConfiguration();
      const devices = config ? state.devices.filter(d => d.enabled && d.publicKey === config.publicKey && pending.some(event => event.pendingDeviceIds!.includes(d.id))) : [];
      const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: notificationDeliveryPolicy.timeZone, hour: "2-digit", hourCycle: "h23" }).format(now));
      const canDeliver = hour >= notificationDeliveryPolicy.fromHour && hour < notificationDeliveryPolicy.untilHour
        && (!state.lastAutomaticPushAt || Date.parse(state.lastAutomaticPushAt) < now.getTime() && localDate(new Date(state.lastAutomaticPushAt)) !== localDate(now));
      if (config && devices.length && pending.length && canDeliver) {
        // One generic notice covers the eligible group. Reserve the budget and every event before transport.
        const ordered = pending.slice().sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)), event = ordered[0];
        for (const item of pending) item.pushState = "handled";
        state.lastAutomaticPushAt = now.toISOString();
        await this.save(state);
        await this.deliver(state, devices, event.id, config, now, device => ordered.find(item => item.pendingDeviceIds!.includes(device.id))!.id);
      } else await this.save(state);
      return this.expose(state);
    });
  }
  private async deliver(state: Stored, devices: Device[], eventId: string, config: VapidConfig, now: Date, eventForDevice?: (device: Device) => string) {
    if (!devices.length) return;
    for (const device of devices) device.lastDelivery = { at: now.toISOString(), outcome: "unconfirmed", eventId: eventForDevice?.(device) ?? eventId };
    await this.save(state);
    // Each transport has an eight-second bound; a slow device cannot block all others serially.
    await Promise.all(devices.map(async device => {
      let outcome: PushOutcome;
      try { outcome = await this.send(device.subscription, device.lastDelivery!.eventId, config); } catch { outcome = "unconfirmed"; }
      device.lastDelivery!.outcome = outcome;
      if (outcome === "expired") device.enabled = false;
    }));
    await this.save(state);
  }
  mutate(input: unknown, now = new Date()) {
    return this.serialize(async () => {
      const state = await this.load();
      const body = input as Record<string, unknown>;
      if (!body || typeof body !== "object" || body.expectedRevision !== state.revision) throw new NotificationConflict("Les notifications ont changé. Actualisez avant de réessayer.");
      if (body.action === "preferences") {
        const value = body.preferences as NotificationPreferences;
        if (!value || notificationKinds.some(k => typeof value[k] !== "boolean") || Object.keys(value).some(k => !notificationKinds.includes(k as typeof notificationKinds[number]))) throw new Error("Préférences invalides.");
        state.preferences = { ...value };
        for (const event of state.events) if (event.pushState === "pending" && !value[event.kind]) event.pushState = "handled";
      } else if (["read", "snooze", "resolve", "dismiss", "restore"].includes(String(body.action))) {
        if (Object.keys(body).some(k => !["expectedRevision", "action", "id", "snoozedUntil"].includes(k)) || body.action !== "snooze" && body.snoozedUntil !== undefined || typeof body.id !== "string" || !idPattern.test(body.id)) throw new Error("Notification invalide.");
        const event = state.events.find(e => e.id === body.id);
        if (!event) throw new Error("Cette notification n’est plus dans l’historique.");
        if (body.action === "read") { event.readAt = now.toISOString(); event.pushState = "handled"; }
        else {
          state.decisions ??= {};
          const group = event.groupId ?? event.id, evidenceVersion = event.evidenceVersion ?? event.id;
          if (!event.active && state.decisions[group] && state.decisions[group].evidenceVersion !== evidenceVersion || state.events.some(other => other.active && other.groupId === group && other.evidenceVersion !== evidenceVersion)) throw new NotificationConflict("Les preuves ont changé. Ouvrez le rappel actuel avant de décider.");
          if (body.action === "restore") { delete state.decisions[group]; event.pushState = "handled"; }
          else {
            if (!state.decisions[group] && Object.keys(state.decisions).length >= 5000) throw new Error("La limite de décisions est atteinte. Les décisions existantes sont conservées.");
            if (body.action === "snooze" && (!timestamp(body.snoozedUntil) || Date.parse(body.snoozedUntil as string) <= now.getTime() || Date.parse(body.snoozedUntil as string) > now.getTime() + 90 * 86_400_000)) throw new Error("Choisissez un report futur, dans les 90 prochains jours.");
            state.decisions[group] = { evidenceVersion, at: now.toISOString(), state: body.action === "snooze" ? "snoozed" : body.action === "resolve" ? "resolved" : "dismissed", ...(body.action === "snooze" ? { snoozedUntil: new Date(body.snoozedUntil as string).toISOString() } : {}) };
            if (body.action !== "snooze") event.pushState = "handled";
          }
        }
      } else if (body.action === "enroll") {
        const config = await this.configuration();
        if (!config || body.publicKey !== config.publicKey) throw new Error("Configuration Web Push absente ou modifiée. Actualisez avant l’inscription.");
        if (body.permission !== "granted" || typeof body.label !== "string" || !body.label.trim() || body.label.length > 60) throw new Error("Confirmez l’autorisation et le nom de cet appareil.");
        const subscription = validateSubscription(body.subscription), id = hash(subscription.endpoint);
        const previous = state.devices.find(d => d.id === id);
        if (!previous && state.devices.length >= 20) throw new Error("Retirez un ancien appareil avant d’en ajouter un autre.");
        state.devices = [...state.devices.filter(d => d.id !== id), { id, label: body.label.trim(), subscription, enabled: true, publicKey: config.publicKey, createdAt: previous?.createdAt ?? now.toISOString(), lastDelivery: previous?.lastDelivery }];
      } else if (["disable", "remove", "test", "receipt"].includes(String(body.action))) {
        const device = state.devices.find(d => d.id === body.id);
        if (!device) throw new Error("Appareil introuvable. Actualisez cette liste.");
        if (body.action === "remove") state.devices = state.devices.filter(d => d.id !== device.id);
        if (body.action === "disable") device.enabled = false;
        if (body.action === "remove" || body.action === "disable") for (const event of state.events) {
          event.pendingDeviceIds = event.pendingDeviceIds?.filter(id => id !== device.id);
          if (event.pushState === "pending" && !event.pendingDeviceIds?.length) event.pushState = "handled";
        }
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
