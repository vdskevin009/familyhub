import { useEffect, useRef, useState } from "react";
import { Bell, RefreshCw, Settings2 } from "lucide-react";
import type { HubState } from "../state";
import type { AppView } from "../types";
import { notificationActionState, notificationNeedsAttention } from "../../../worker/src/notification-model";
import type { NotificationSnapshot } from "../../../worker/src/notification-library";
import { notificationLabels, notificationTargetHref, pushSupported, applicationServerKey } from "../notifications";
import { fetchNotifications, updateNotifications } from "../worker";
import { PageHeader, Notice, Sheet } from "../ui/primitives";
import "../notifications.css";

export default function NotificationsView({ hub, onNavigate }: { hub: HubState; onNavigate: (view: AppView) => void }) {
  const [state, setState] = useState<NotificationSnapshot | null>(null), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false), [settings, setSettings] = useState(false), [unreadOnly, setUnreadOnly] = useState(false);
  const [filter, setFilter] = useState<"attention" | "snoozed" | "history">("attention");
  const [label, setLabel] = useState("Mon téléphone"), [permission, setPermission] = useState(() => "Notification" in window ? Notification.permission : "default"), [currentEndpoint, setCurrentEndpoint] = useState("");
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
  async function mutate(body: object, success = "Enregistré sur le PC.") {
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
      if (allowed !== "granted") { setMessage("Autorisation non accordée. L’historique reste accessible ici."); return; }
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (subscription?.options.applicationServerKey && [...new Uint8Array(subscription.options.applicationServerKey)].join() !== [...applicationServerKey(state.publicKey)].join()) throw new Error("La clé Push de cet appareil a changé. Désactivez cet appareil avant de le réinscrire.");
      subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(state.publicKey) });
      setCurrentEndpoint(subscription.endpoint);
      setState(await updateNotifications(hub.worker, { action: "enroll", subscription: subscription.toJSON(), label, publicKey: state.publicKey, permission: allowed, expectedRevision: state.revision }));
      setMessage("Appareil inscrit. Envoyez un test, puis vérifiez sa réception sur le téléphone.");
    } catch (e) { setError((e as Error).message); }
    finally { working.current = false; setBusy(false); }
  }
  async function disableHere() {
    if (!pushSupported() || working.current) return;
    working.current = true; setBusy(true); setError("");
    try {
      const subscription = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (subscription && !await subscription.unsubscribe()) throw new Error("La désactivation locale n’a pas été confirmée.");
      setCurrentEndpoint(""); setMessage("Notifications désactivées dans ce navigateur. Retirez aussi l’appareil de la liste du PC si nécessaire.");
    } catch (e) { setError((e as Error).message); }
    finally { working.current = false; setBusy(false); }
  }
  const events = [...(state?.events ?? [])].reverse().filter(e => e.id === selected || (!unreadOnly || !e.readAt) && (filter === "history" || filter === "attention" && notificationNeedsAttention(e) || filter === "snoozed" && e.active && notificationActionState(e) === "snoozed"));
  const attentionCount = (state?.events ?? []).filter(e => notificationNeedsAttention(e)).length;
  return <section className="view-stack notifications-view">
    <PageHeader title="Notifications" subtitle="Les actions utiles, puis leur historique.">
      <button className="button secondary" disabled={!paired || busy} onClick={() => void refresh()}><RefreshCw size={16} />Actualiser</button>
      <button className="button secondary" onClick={() => setSettings(true)}><Settings2 size={16} />Préférences</button>
    </PageHeader>
    {!paired && <Notice>Associez votre PC pour consulter les détails privés.<button className="text-action" onClick={() => onNavigate("more")}>Ouvrir les réglages</button></Notice>}
    {error && <Notice error>{error}</Notice>}{message && <Notice>{message}</Notice>}
    {busy && !state && <p role="status">Chargement de l'historique depuis votre PC…</p>}
    {state && <>
      <nav className="notification-filters" aria-label="Filtrer les notifications">{([["attention", "À traiter"], ["snoozed", "Reportées"], ["history", "Historique"]] as const).map(([value, name]) => <button type="button" className={filter === value ? "active" : ""} aria-pressed={filter === value} key={value} onClick={() => setFilter(value)}>{name}{value === "attention" && attentionCount > 0 ? ` · ${attentionCount}` : ""}</button>)}</nav>
      <div className="notification-toolbar"><label><input type="checkbox" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} />Non lues seulement</label><small>{state.scannedAt ? `Vérifié le ${new Date(state.scannedAt).toLocaleString("fr-CA")}` : "Première analyse en attente"}</small></div>
      {state.sourceErrors.length > 0 && <Notice>Sources indisponibles : {state.sourceErrors.join(", ")}. Les anciens résultats sont conservés.</Notice>}
      {state.monitoring && <details><summary>Événements surveillés et preuves manquantes</summary>{state.monitoring.map(item => <section key={item.category}><h3>{({ policy: "Banque du Canada", renewal: "Assurance et forfaits", gic: "GIC à échéance", grocery: "Courses habituelles", "claim-deadline": "Délais de réclamation" })[item.category]}</h3><p>{item.status === "watching" ? "Surveillance des preuves enregistrées" : item.status === "missing" ? "Informations à compléter" : "Source indisponible"}. {item.detail}</p></section>)}</details>}
      {selected && !state.events.some(e => e.id === selected) && <Notice>Cette notification n’est plus dans les 500 éléments conservés. Consultez les données actuelles dans leur section.</Notice>}
      {!events.length && <div className="empty-state"><Bell size={28} /><strong>{unreadOnly ? "Aucune notification non lue" : filter === "attention" ? "Rien de nouveau à traiter" : filter === "snoozed" ? "Aucune notification reportée" : "Aucune mise à jour disponible"}</strong><p>{filter === "attention" ? "Les résultats et les éléments déjà connus restent dans Historique." : "Le PC conserve les preuves et leur état. Une mise à jour ne signifie pas toujours une action à faire."}</p></div>}
      <ol className="notification-list">{events.map(event => <li key={event.id}><article id={`notice-${event.id}`} tabIndex={-1} className={`surface notification-card ${event.readAt ? "" : "unread"}`}>
        <div className="notification-meta"><span>{notificationLabels[event.kind]}</span><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString("fr-CA")}</time></div>
        <div className="notification-state">{notificationActionState(event) === "snoozed" ? `Reportée au ${new Date(event.decision!.snoozedUntil!).toLocaleDateString("fr-CA")}` : notificationActionState(event) === "resolved" ? "Rappel traité" : notificationActionState(event) === "dismissed" ? "Rappel écarté" : !event.active ? "État terminé" : event.actionable === false ? "Information" : "À consulter"}</div>
        <h2>{event.title}</h2><p>{event.detail}</p>
        {event.links?.map(link => <p key={link.url}><a href={link.url} target="_blank" rel="noreferrer">{link.label}</a></p>)}
        <small>{event.baseline ? "Déjà présent lors du premier passage · aucun Push envoyé" : "Nouvel élément observé"}{!event.active && " · cet état n’est plus observé dans les sources actuelles"}{event.sourceDate && ` · date source : ${event.sourceDate.slice(0, 10)}`}</small>
        <div className="notification-actions"><a className="button secondary" href={notificationTargetHref(event.target)}>Ouvrir le dossier</a>{!event.readAt && <button className="text-action" disabled={busy} onClick={() => void mutate({ action: "read", id: event.id })}>Marquer comme lu</button>}
          {state.lifecycleSupported && event.active && notificationActionState(event) === "open" && <><button className="text-action" disabled={busy} onClick={() => void mutate({ action: "snooze", id: event.id, snoozedUntil: new Date(Date.now() + 7 * 86_400_000).toISOString() }, "Rappel reporté de 7 jours. Le dossier reste inchangé.")}>Reporter 7 jours</button>{event.actionable !== false && <button className="text-action" disabled={busy} onClick={() => void mutate({ action: "resolve", id: event.id }, "Rappel traité. Le dossier et les montants restent inchangés.")}>Marquer traité</button>}<button className="text-action" disabled={busy} onClick={() => void mutate({ action: "dismiss", id: event.id }, "Rappel écarté pour ces preuves. Le dossier reste inchangé.")}>Écarter</button></>}
          {state.lifecycleSupported && notificationActionState(event) !== "open" && <button className="text-action" disabled={busy} onClick={() => void mutate({ action: "restore", id: event.id }, "Rappel rétabli, sans nouvel envoi Push.")}>Rétablir le rappel</button>}
        </div>
      </article></li>)}</ol>
    </>}
    <Sheet open={settings} onClose={() => setSettings(false)} title="Préférences de notification">
      <p>Les préférences d’envoi et l’historique sont partagés avec vos appareils associés. Aucun courriel n’est envoyé. L’écran verrouillé affiche uniquement « FamilyHub — Une mise à jour est disponible ».</p>
      {error && <Notice error>{error}</Notice>}{message && <Notice>{message}</Notice>}
      {state && <fieldset disabled={busy}><legend>Envoyer ces mises à jour aux appareils inscrits</legend>{Object.entries(notificationLabels).filter(([key]) => Object.hasOwn(state.preferences, key) && (!state.deliveryPolicy || !["reimbursement", "weekly"].includes(key))).map(([key, text]) => <label className="notification-choice" key={key}><input type="checkbox" checked={state.preferences[key as keyof typeof state.preferences]} onChange={e => void mutate({ action: "preferences", preferences: { ...state.preferences, [key]: e.target.checked } })} />{text}</label>)}</fieldset>}
      {state?.deliveryPolicy && <Notice>Au maximum un avis automatique regroupé par jour, entre 8 h et 21 h (Vancouver), pour les actions étayées et encore actuelles. Paiements enregistrés et bilans restent dans l’app. Un rappel lu ne se répète pas au même jalon ; une échéance plus proche peut rappeler l’action. Les rappels traités ou écartés attendent de nouvelles preuves. Un report ne modifie aucun dossier.</Notice>}
      <h3>Ce téléphone ou navigateur</h3>
      {!pushSupported() ? <Notice>Web Push n’est pas disponible ici. Sur iPhone/iPad compatible, ajoutez FamilyHub à l’écran d’accueil puis ouvrez l’application installée.</Notice> : <>
        <p>Autorisation : {permission === "granted" ? "accordée" : permission === "denied" ? "bloquée dans les réglages du navigateur" : "à demander"}. Le PC doit rester en ligne pour envoyer les nouvelles alertes.</p>
        <label>Nom de l’appareil<input maxLength={60} value={label} onChange={e => setLabel(e.target.value)} /></label>
        {!state ? <Notice>Configuration Push non vérifiable : reconnectez le PC puis actualisez. Aucun appareil ni réglage n’est présumé absent.</Notice> : !state.pushConfigured && <Notice>{state.pushSetupError || "Web Push n'est pas encore configuré sur le PC. Une identité d'envoi protégée doit être approuvée et installée; l'historique fonctionne déjà."}</Notice>}
        <button className="button" disabled={busy || !state?.pushConfigured || !label.trim() || permission === "denied"} onClick={() => void enroll()}>Activer sur cet appareil</button>
        {currentEndpoint && <button className="button secondary" disabled={busy} onClick={() => void disableHere()}>Désactiver dans ce navigateur</button>}
      </>}
      <h3>Appareils inscrits</h3>
      {state && !state.devices.length && <p>Aucun appareil inscrit.</p>}
      {state?.devices.map(device => <section className="notification-device" key={device.id}><h4>{device.label}</h4><p>{device.enabled ? "Envoi activé" : "Envoi désactivé ou abonnement expiré"}</p>
        {device.lastDelivery && <p>{device.lastDelivery.outcome === "accepted" ? device.lastDelivery.confirmedAt ? "Dernier envoi accepté par le service Push." : "Dernier envoi accepté par le service Push; réception non prouvée." : device.lastDelivery.outcome === "expired" ? "Abonnement expiré. Réinscrivez cet appareil." : device.lastDelivery.outcome === "unconfirmed" ? "Résultat d’envoi incertain; aucun nouvel essai automatique." : "Dernier envoi non accepté. Vérifiez la connexion et l’inscription."}{device.lastDelivery.confirmedAt && " Réception confirmée par vous."}</p>}
        <div className="notification-actions"><button className="button secondary" disabled={busy || !device.enabled || !state.pushConfigured} onClick={() => void mutate({ action: "test", id: device.id }, "Test traité. Vérifiez l’état d’envoi ci-dessous et la notification sur le téléphone.")}>Envoyer un test</button><button className="text-action" disabled={busy} onClick={() => void mutate({ action: "remove", id: device.id })}>Retirer cet appareil</button>
        {device.lastDelivery?.outcome === "accepted" && !device.lastDelivery.confirmedAt && <button className="text-action" disabled={busy} onClick={() => void mutate({ action: "receipt", id: device.id, eventId: device.lastDelivery!.eventId }, "Réception confirmée par vous, enregistrée.")}>J’ai reçu la notification</button>}</div>
      </section>)}
      <p className="muted">Les livraisons peuvent être retardées par le réseau ou les réglages du téléphone. Un PC arrêté ne peut ni envoyer une alerte, ni signaler lui-même son arrêt. Aucun envoi ancien n’est rejoué après activation.</p>
    </Sheet>
  </section>;
}
