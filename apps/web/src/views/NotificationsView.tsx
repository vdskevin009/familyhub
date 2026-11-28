import { useEffect, useRef, useState } from "react";
import { Bell, CalendarClock, CheckCircle2, CircleDollarSign, Clock3, FileSearch, HeartHandshake, Home, Landmark, RefreshCw, Settings2, ShoppingBasket, Tag, TrendingUp } from "lucide-react";
import type { HubState } from "../state";
import type { AppView } from "../types";
import { notificationActionState, notificationNeedsAttention, notificationSnoozeCrossesExpiry } from "../../../worker/src/notification-model";
import { notificationHistoryCopy, notificationMonitoringDetail } from "../notification-history-copy";
import type { NotificationSnapshot } from "../../../worker/src/notification-library";
import { notificationLabels, notificationTargetHref, pushSupported, applicationServerKey } from "../notifications";
import { fetchNotifications, updateNotifications } from "../worker";
import { PageHeader, Notice, Sheet } from "../ui/primitives";
import {DeviceDeliveryCheck} from "../ui/DeviceDeliveryCheck";
import "../notifications.css";

const categoryIcons = { "open-claim": HeartHandshake, "new-property": Home, "new-vehicle": Tag, collection: RefreshCw, reimbursement: HeartHandshake, unmatched: FileSearch, price: TrendingUp, deadline: CalendarClock, weekly: CircleDollarSign, mortgage: Home, policy: Landmark, grocery: ShoppingBasket, "claim-deadline": CalendarClock };
const categoryLabels = { "open-claim": "Open claim", "new-property": "Property", "new-vehicle": "Vehicle", collection: "Collection", reimbursement: "Reimbursement", unmatched: "Matching", price: "Charge", deadline: "Deadline", weekly: "Summary", mortgage: "Mortgage", policy: "Policy rate", grocery: "Groceries", "claim-deadline": "Claim" };
const categoryQualifications = { "open-claim": "Check whether the claim was sent and review the latest statement.", "new-property": "Match based on observed listing details.", "new-vehicle": "Asking prices are comparable. Check the vehicle’s condition.", collection: "Check collection status. Previous results are retained.", reimbursement: "Insurer statement · bank deposit unconfirmed.", unmatched: "Match not confirmed.", price: "A higher payment does not confirm a rate increase.", deadline: "Recorded date · verify the terms.", weekly: "Coverage is limited to imports. Household total not established.", mortgage: "Opportunity to assess, not realized savings.", policy: "Policy rate · verify personal impact.", grocery: "Product price difference, before fees, taxes and travel. Net savings unknown." };

export default function NotificationsView({ hub, onNavigate }: { hub: HubState; onNavigate: (view: AppView) => void }) {
  const [state, setState] = useState<NotificationSnapshot | null>(null), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false), [settings, setSettings] = useState(false), [unreadOnly, setUnreadOnly] = useState(false);
  const [filter, setFilter] = useState<"attention" | "snoozed" | "history">("attention");
  const [label, setLabel] = useState("My phone"), [permission, setPermission] = useState(() => "Notification" in window ? Notification.permission : "default"), [currentEndpoint, setCurrentEndpoint] = useState("");
  const working = useRef(false), focusEvent = useRef(false), epoch = useRef(0);
  const selected = new URLSearchParams(location.search).get("notice");
  const paired = Boolean(hub.worker.Endpoint && hub.worker.ApiKey);
  async function refresh() {
    if (working.current) return;
    const requestEpoch = ++epoch.current;
    working.current = true; setBusy(true); setError("");
    try { const saved = await fetchNotifications(hub.worker); if (requestEpoch === epoch.current) setState(saved); }
    catch (e) { if (requestEpoch === epoch.current) setError((e as Error).message); }
    finally { if (requestEpoch === epoch.current) { working.current = false; setBusy(false); } }
  }
  useEffect(() => { setState(null); focusEvent.current = false; working.current = false; if (paired) void refresh(); return () => { epoch.current++; }; }, [hub.worker.Endpoint, hub.worker.ApiKey]);
  useEffect(() => {
    if (!pushSupported()) return;
    void navigator.serviceWorker.ready.then(r => r.pushManager.getSubscription()).then(s => setCurrentEndpoint(s?.endpoint ?? "")).catch(() => {});
  }, []);
  useEffect(() => {
    if (!pushSupported() || !navigator.permissions?.query) return;
    let status: PermissionStatus | undefined, disposed = false;
    const update = () => { if (!disposed && status) setPermission(Notification.permission); };
    void navigator.permissions.query({ name: "notifications" }).then(value => { if (disposed) return; status = value; update(); status.addEventListener("change", update); }).catch(() => {});
    return () => { disposed = true; status?.removeEventListener("change", update); };
  }, []);
  useEffect(() => {
    if (!selected || !state || focusEvent.current) return;
    const card = document.getElementById(`notice-${selected}`);
    if (card) { card.focus(); card.scrollIntoView({ block: "center" }); focusEvent.current = true; }
  }, [state, selected]);
  async function mutate(body: object, success = "Saved on your PC.") {
    if (!state || working.current) return;
    working.current = true; setBusy(true); setError(""); setMessage("");
    try { setState(await updateNotifications(hub.worker, { ...body, expectedRevision: state.revision })); setMessage(success); }
    catch (e) { setError((e as Error).message); }
    finally { working.current = false; setBusy(false); }
  }
  async function enroll() {
    if (!state?.publicKey || !pushSupported() || working.current) return;
    working.current = true; setBusy(true); setError(""); setMessage("");
    try {
      // Permission must be requested synchronously from this explicit button gesture.
      const allowed = await Notification.requestPermission(); setPermission(allowed);
      if (allowed !== "granted") { setMessage("Permission not granted. History is still available here."); return; }
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (subscription?.options.applicationServerKey && [...new Uint8Array(subscription.options.applicationServerKey)].join() !== [...applicationServerKey(state.publicKey)].join()) throw new Error("This device’s push key has changed. Disable this device before registering again.");
      subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(state.publicKey) });
      setCurrentEndpoint(subscription.endpoint);
      setState(await updateNotifications(hub.worker, { action: "enroll", subscription: subscription.toJSON(), label, publicKey: state.publicKey, permission: allowed, expectedRevision: state.revision }));
      setMessage("Device registered. Send a test and check that it appears on your phone.");
    } catch (e) { setError((e as Error).message); }
    finally { working.current = false; setBusy(false); }
  }
  async function disableHere() {
    if (!pushSupported() || working.current) return;
    working.current = true; setBusy(true); setError("");
    try {
      const subscription = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (subscription && !await subscription.unsubscribe()) throw new Error("Local deactivation was not confirmed.");
      setCurrentEndpoint(""); setMessage("Notifications disabled in this browser. Remove the device from the PC list as well if necessary.");
    } catch (e) { setError((e as Error).message); }
    finally { working.current = false; setBusy(false); }
  }
  const events = [...(state?.events ?? [])].reverse().filter(e => e.id === selected || (!unreadOnly || !e.readAt) && (filter === "history" || filter === "attention" && notificationNeedsAttention(e) || filter === "snoozed" && e.active && notificationActionState(e) === "snoozed"));
  const attentionCount = (state?.events ?? []).filter(e => notificationNeedsAttention(e)).length;
  return <section className="view-stack notifications-view">
    <PageHeader title="Notifications" subtitle="Actions, snoozed alerts and history">
      <button className="button secondary" disabled={!paired || busy} onClick={() => void refresh()}><RefreshCw size={16} />Refresh</button>
      <button className="button secondary" onClick={() => setSettings(true)}><Settings2 size={16} />Preferences</button>
    </PageHeader>
    {!paired && <Notice>Pair your PC to see private details.<button className="text-action" onClick={() => onNavigate("more")}>Open settings</button></Notice>}
    {error && <Notice error>{error}</Notice>}{message && <Notice>{message}</Notice>}
    {busy && !state && <p role="status">Loading history from your PC…</p>}
    {state && <>
      {state.deliveryPolicy && <div className="notification-delivery-status"><Bell size={18} aria-hidden="true" /><strong>At most one automatic alert per day</strong><span>8 a.m. to 9 p.m. · Vancouver</span></div>}
      <nav className="notification-filters" aria-label="Filter notifications">{([["attention", "Action needed"], ["snoozed", "Snoozed"], ["history", "History"]] as const).map(([value, name]) => <button type="button" className={filter === value ? "active" : ""} aria-pressed={filter === value} key={value} onClick={() => setFilter(value)}>{name}{value === "attention" && attentionCount > 0 ? ` · ${attentionCount}` : ""}</button>)}</nav>
      <div className="notification-toolbar"><label><input type="checkbox" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} />Unread only</label><small>{state.scannedAt ? `Checked on ${new Date(state.scannedAt).toLocaleString("en-CA")}` : "Initial scan pending"}</small></div>
      {state.sourceErrors.length > 0 && <Notice>Unavailable sources: {state.sourceErrors.join(", ")}. Previous results are retained.</Notice>}
      {state.monitoring && <details className="notification-monitoring"><summary>Monitored events and missing evidence</summary>{state.monitoring.map(item => <section key={item.category}><div><h3>{({ policy: "Bank of Canada", renewal: "Insurance and plans", gic: "Maturing GICs", grocery: "Regular groceries", "claim-deadline": "Claim deadlines" })[item.category]}</h3><span className={`notification-chip ${item.status === "watching" ? "" : "caution"}`}>{item.status === "watching" ? "Monitored" : item.status === "missing" ? "Incomplete" : "Unavailable"}</span></div><p>{notificationMonitoringDetail(item)}</p></section>)}</details>}
      {selected && !state.events.some(e => e.id === selected) && <Notice>This notification is no longer among the 500 retained entries. Check its section for current data.</Notice>}
      {!events.length && <div className="empty-state"><Bell size={28} /><strong>{unreadOnly ? "No unread notifications" : filter === "attention" ? "Nothing new needs action" : filter === "snoozed" ? "No snoozed notifications" : "No updates available"}</strong><p>{filter === "attention" ? "Previous results and known items remain in History." : "Your PC keeps the evidence and its status. Not every update requires action."}</p></div>}
      <ol className="notification-list">{events.map(event => {
        const display = notificationHistoryCopy(event);
        const Icon = categoryIcons[event.kind], actionState = notificationActionState(event);
        const expired = Boolean(event.expiresAt && Date.parse(event.expiresAt) <= Date.now());
        return <li key={event.id}><article id={`notice-${event.id}`} tabIndex={-1} className={`surface notification-card ${event.readAt ? "" : "unread"}`} data-kind={event.kind}>
          <div className="notification-category-icon"><Icon size={22} aria-hidden="true" /></div>
          <div className="notification-content">
            <div className="notification-meta"><span>{categoryLabels[event.kind]}</span><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString("en-CA")}</time></div>
            <h2>{display.title}</h2>
            <div className="notification-state"><span className="notification-chip">{actionState === "snoozed" ? <><Clock3 size={14} aria-hidden="true" />{`Snoozed until ${new Date(event.decision!.snoozedUntil!).toLocaleString("en-CA")}`}</> : actionState === "resolved" ? <><CheckCircle2 size={14} aria-hidden="true" />Reminder handled</> : actionState === "dismissed" ? "Reminder dismissed" : !event.active ? "No longer active" : event.actionable === false ? "Information" : "For review"}</span>{expired ? <span className="notification-chip caution">Validity period ended</span> : notificationNeedsAttention(event) && (event.priority ?? 0) >= 3 && <span className="notification-chip caution">High priority</span>}{event.readAt && <span className="notification-read-state">Read</span>}</div>
            <p className="notification-detail">{event.kind === "claim-deadline" ? display.detail : categoryQualifications[event.kind]}</p>
            {event.kind === "deadline" && event.sourceDate && <p className="notification-deadline"><CalendarClock size={15} aria-hidden="true" />Recorded date: {event.sourceDate.slice(0, 10)}</p>}
            {event.expiresAt && <p className="notification-validity"><CalendarClock size={14} aria-hidden="true" />Reminder valid until: {new Date(event.expiresAt).toLocaleDateString("en-CA")}</p>}
            {event.baseline && <span className="notification-baseline">Already known · no push notification sent</span>}
            <details className="notification-evidence"><summary>Sources and context</summary>
              {event.kind !== "claim-deadline" && <p className="notification-source-detail">{display.detail}</p>}
              {display.links?.map(link => <p key={link.url}><a href={link.url} target="_blank" rel="noreferrer">{link.label}</a></p>)}
              <p>{event.baseline ? "Already present on the first scan · no push notification sent" : "New item observed"}{!event.active && " · current sources no longer show this state"}{event.sourceDate && ` · source date: ${event.sourceDate.slice(0, 10)}`}</p>
              <p>History does not prove a device received the notification. Check delivery in Preferences.</p>
            </details>
            <div className="notification-actions"><a className="button secondary" href={notificationTargetHref(event.target)}>Open record</a>{!event.readAt && <button className="text-action" disabled={busy} onClick={() => void mutate({ action: "read", id: event.id })}>Mark as read</button>}
              {state.lifecycleSupported && actionState !== "open" && <button className="text-action" disabled={busy} onClick={() => void mutate({ action: "restore", id: event.id }, "Reminder restored without another push notification.")}>Restore reminder</button>}
            </div>
            {state.lifecycleSupported && event.active && actionState === "open" && <details className="notification-manage"><summary>Manage reminder</summary>
              {event.actionable !== false && notificationSnoozeCrossesExpiry(event, 7 * 86_400_000) && <p className="notification-snooze-warning">Snoozing for 7 days would exceed the validity period. Open the record before snoozing.</p>}
              <div className="notification-actions"><button className="button secondary" disabled={busy} onClick={() => void mutate({ action: "snooze", id: event.id, snoozedUntil: new Date(Date.now() + 3_600_000).toISOString() }, "Reminder snoozed for 1 hour. The record is unchanged.")}>Snooze for 1 hour</button><button className="button secondary" disabled={busy} onClick={() => void mutate({ action: "snooze", id: event.id, snoozedUntil: new Date(Date.now() + 7 * 86_400_000).toISOString() }, "Reminder snoozed for 7 days. The record is unchanged.")}>Snooze for 7 days</button>{event.actionable !== false && <button className="text-action" disabled={busy} onClick={() => void mutate({ action: "resolve", id: event.id }, "Reminder handled. The record and amounts are unchanged.")}>Mark as handled</button>}<button className="text-action" disabled={busy} onClick={() => void mutate({ action: "dismiss", id: event.id }, "Reminder dismissed for this evidence. The record is unchanged.")}>Dismiss</button></div>
            </details>}
          </div>
        </article></li>;
      })}</ol>
    </>}
    <Sheet open={settings} onClose={() => setSettings(false)} title="Notification preferences">
      <p>Delivery preferences and history are shared with paired devices. No emails are sent. The lock screen says only “FamilyHub — An update is available”.</p>
      {error && <Notice error>{error}</Notice>}{message && <Notice>{message}</Notice>}
      {state && <fieldset disabled={busy}><legend>Send these updates to registered devices</legend>{Object.entries(notificationLabels).filter(([key]) => Object.hasOwn(state.preferences, key) && (!state.deliveryPolicy || !["reimbursement", "weekly"].includes(key))).map(([key, text]) => <label className="notification-choice" key={key}><input type="checkbox" checked={state.preferences[key as keyof typeof state.preferences]} onChange={e => void mutate({ action: "preferences", preferences: { ...state.preferences, [key]: e.target.checked } })} />{text}</label>)}</fieldset>}
      {state?.deliveryPolicy && <Notice>At most one grouped automatic alert per day, between 8 a.m. and 9 p.m. Vancouver time, for supported actions that are still current. Recorded payments and summaries stay in the app. Read reminders do not repeat for the same milestone; a closer deadline may trigger another. Handled or dismissed reminders require new evidence. Snoozing never changes a record.</Notice>}
      <h3>This phone or browser</h3>
      {!pushSupported() ? <Notice>Web Push is unavailable here. On a supported iPhone or iPad, add FamilyHub to the Home Screen and open the installed app.</Notice> : <>
        <p>Permission: {permission === "granted" ? "granted" : permission === "denied" ? "blocked in browser settings" : "not requested"}. Your PC must stay online to send new alerts.</p>
        <DeviceDeliveryCheck snapshot={state} permission={permission} version={currentEndpoint}/>
        <label>Device name<input maxLength={60} value={label} onChange={e => setLabel(e.target.value)} /></label>
        {!state ? <Notice>Push configuration could not be verified. Reconnect your PC and refresh. No device or setting is assumed missing.</Notice> : !state.pushConfigured && <Notice>{state.pushSetupError || "Web Push is not yet configured on the PC. A protected sender identity must be approved and installed. History already works."}</Notice>}
        <button className="button" disabled={busy || !state?.pushConfigured || !label.trim() || permission === "denied"} onClick={() => void enroll()}>Enable on this device</button>
        {currentEndpoint && <button className="button secondary" disabled={busy} onClick={() => void disableHere()}>Disable in this browser</button>}
      </>}
      <h3>Registered devices</h3>
      {state && !state.devices.length && <p>No registered devices.</p>}
      {state?.devices.map(device => <section className="notification-device" key={device.id}><h4>{device.label}</h4><p>{device.enabled ? "Delivery enabled" : "Delivery disabled or subscription expired"}</p>
        {device.lastDelivery && <p>{device.lastDelivery.outcome === "accepted" ? device.lastDelivery.confirmedAt ? "Last send accepted by the push service." : "Last send accepted by the push service; receipt not confirmed." : device.lastDelivery.outcome === "expired" ? "Subscription expired. Register this device again." : device.lastDelivery.outcome === "unconfirmed" ? "Delivery uncertain; no automatic retry." : "Last send not accepted. Check the connection and registration."}{device.lastDelivery.confirmedAt && " You confirmed receipt."}</p>}
        <div className="notification-actions"><button className="button secondary" disabled={busy || !device.enabled || !state.pushConfigured} onClick={() => void mutate({ action: "test", id: device.id }, "Test processed. Check the delivery status below and the notification on your phone.")}>Send test</button><button className="text-action" disabled={busy} onClick={() => void mutate({ action: "remove", id: device.id })}>Remove this device</button>
        {device.lastDelivery?.outcome === "accepted" && !device.lastDelivery.confirmedAt && <button className="text-action" disabled={busy} onClick={() => void mutate({ action: "receipt", id: device.id, eventId: device.lastDelivery!.eventId }, "Your confirmation of receipt was saved.")}>I received the notification</button>}</div>
      </section>)}
      <p className="muted">Delivery can be delayed by the network or phone settings. An offline PC cannot send an alert or report its own outage. Old sends are not replayed after activation.</p>
    </Sheet>
  </section>;
}
