window.portfolio = {load:key=>localStorage.getItem(key),save:(key,value)=>localStorage.setItem(key,value),download:(name,content,type)=>{const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}};
if ('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js',{updateViaCache:'none'}).catch(e=>console.warn('Offline support unavailable',e));
let installEvent;
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installEvent = event; });
window.addEventListener('appinstalled', () => { installEvent = null; });
window.familyhubInstall = { prompt: async () => {
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) return 'FamilyHub is already running as an installed app.';
  if (!installEvent) return 'In Chrome or Edge, open the browser menu → Install app or Add to Home screen. On iPhone: Safari → Share → Add to Home Screen. If installation is unavailable, finish loading online and try again.';
  const event = installEvent; installEvent = null; await event.prompt();
  const choice = await event.userChoice;
  return choice.outcome === 'accepted' ? 'Installation requested. Look for FamilyHub on your home screen.' : 'Installation dismissed. You can install later from your browser menu.';
} };

window.familyhubGmail = (() => {
  const accounts = new Map();
  let gisLoader;

  function ensureGoogleIdentity() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    if (gisLoader) return gisLoader;
    gisLoader = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-familyhub-google-identity]');
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', () => reject(new Error('Google sign-in could not be loaded.')), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.dataset.familyhubGoogleIdentity = 'true';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Google sign-in could not be loaded.'));
      document.head.appendChild(script);
    });
    return gisLoader;
  }

  function requireAccount(slot) {
    const account = accounts.get(slot);
    if (!account) throw new Error(`Reconnect ${slot}'s Gmail account first.`);
    if (account.expiresAt <= Date.now() + 30000) {
      accounts.delete(slot);
      throw new Error(`${slot}'s Gmail access expired. Reconnect the account and try again.`);
    }
    return account;
  }

  async function apiJson(url, token, init = {}) {
    const response = await fetch(url, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` }
    });
    if (response.status === 401 || response.status === 403) throw new Error('Google access expired or was denied. Reconnect this Gmail account.');
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json())?.error?.message || ''; } catch {}
      throw new Error(detail || `Google API request failed (${response.status}).`);
    }
    return response.json();
  }

  function decodeBase64Url(data) {
    if (!data) return new Uint8Array();
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function decodeText(data) {
    try { return new TextDecoder('utf-8').decode(decodeBase64Url(data)); }
    catch { return ''; }
  }

  function stripHtml(html) {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return doc.body?.textContent || '';
    } catch { return ''; }
  }

  function collectPayload(part, plain, html, attachments) {
    if (!part) return;
    const mime = (part.mimeType || '').toLowerCase();
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        id: part.body.attachmentId,
        fileName: part.filename,
        mimeType: part.mimeType || 'application/octet-stream',
        size: Number(part.body.size || 0)
      });
    }
    if (part.body?.data) {
      if (mime === 'text/plain') plain.push(decodeText(part.body.data));
      else if (mime === 'text/html') html.push(stripHtml(decodeText(part.body.data)));
    }
    for (const child of (part.parts || [])) collectPayload(child, plain, html, attachments);
  }

  function header(headers, name) {
    return (headers || []).find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
  }

  function normalizeMessage(raw) {
    const plain = [], html = [], attachments = [];
    collectPayload(raw.payload, plain, html, attachments);
    const headers = raw.payload?.headers || [];
    const body = (plain.join('\n') || html.join('\n')).replace(/\s+/g, ' ').trim().slice(0, 30000);
    const received = Number(raw.internalDate || 0);
    return {
      messageId: raw.id || '',
      threadId: raw.threadId || '',
      internetMessageId: header(headers, 'Message-ID'),
      subject: header(headers, 'Subject'),
      sender: header(headers, 'From'),
      receivedAt: received > 0 ? new Date(received).toISOString() : new Date().toISOString(),
      bodyText: body,
      attachments
    };
  }

  async function connect(clientId, slot) {
    if (!clientId || !clientId.endsWith('.apps.googleusercontent.com')) throw new Error('Enter a valid Google OAuth web client ID first.');
    await ensureGoogleIdentity();
    const tokenResponse = await new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'openid email profile https://www.googleapis.com/auth/gmail.readonly',
        callback: response => response?.error ? reject(new Error(response.error_description || response.error)) : resolve(response),
        error_callback: error => reject(new Error(error?.message || 'Google sign-in was cancelled.'))
      });
      client.requestAccessToken({ prompt: 'select_account' });
    });
    const token = tokenResponse.access_token;
    const profile = await apiJson('https://www.googleapis.com/oauth2/v3/userinfo', token);
    const expiresAt = Date.now() + Math.max(60, Number(tokenResponse.expires_in || 3600)) * 1000;
    const account = { slot, email: profile.email || '', name: profile.name || profile.email || '', token, expiresAt };
    if (!account.email) throw new Error('Google did not return an email address for this account.');
    accounts.set(slot, account);
    return { slot, email: account.email, name: account.name, expiresAt: new Date(expiresAt).toISOString() };
  }

  async function scan(slot, months) {
    const account = requireAccount(slot);
    months = Math.min(24, Math.max(1, Number(months || 18)));
    const terms = '{receipt invoice facture reçu recu reimbursement remboursement claim benefits physio physiotherapy chiropractor chiropractic osteopath dental dentist pharmacy prescription massage "physical therapy" "massage therapy" hotel flight airline airbnb travel}';
    const q = `newer_than:${months}m ${terms}`;
    const ids = [];
    let pageToken = '';
    for (let page = 0; page < 3 && ids.length < 250; page++) {
      const params = new URLSearchParams({ maxResults: '100', q });
      if (pageToken) params.set('pageToken', pageToken);
      const list = await apiJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, account.token);
      ids.push(...(list.messages || []).map(x => x.id));
      pageToken = list.nextPageToken || '';
      if (!pageToken) break;
    }

    const messages = [];
    for (let i = 0; i < ids.length; i += 8) {
      const batch = ids.slice(i, i + 8);
      const fetched = await Promise.all(batch.map(id =>
        apiJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`, account.token)
          .then(normalizeMessage)
      ));
      messages.push(...fetched);
    }
    return { email: account.email, messages };
  }

  async function downloadAttachment(slot, messageId, attachmentId, fileName, mimeType) {
    const account = requireAccount(slot);
    const data = await apiJson(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
      account.token
    );
    const blob = new Blob([decodeBase64Url(data.data || '')], { type: mimeType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || 'attachment';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function openMessage(accountEmail, internetMessageId, gmailMessageId) {
    const authUser = encodeURIComponent(accountEmail || '');
    const search = internetMessageId
      ? `rfc822msgid:${internetMessageId}`
      : gmailMessageId || '';
    const url = `https://mail.google.com/mail/u/?authuser=${authUser}#search/${encodeURIComponent(search)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function disconnect(slot) {
    accounts.delete(slot);
  }

  return { connect, scan, downloadAttachment, openMessage, disconnect };
})();
