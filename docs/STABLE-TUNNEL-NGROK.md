# Stable FamilyHub HTTPS endpoint without Tailscale

Status: **optional, owner-operated candidate**. GitHub code and CI do not create
an ngrok account, connect the PC, start a public endpoint, or prove a live
insurance collection. Existing pairing keys, private data, insurer sessions,
manual decisions, and scheduled collectors are unchanged. Track under
FH-CONNECT-001 / issue #110.

## Why this is needed

Cloudflare **Quick Tunnels** have random `trycloudflare.com` URLs after each
restart. FamilyHub saves its worker endpoint locally on the phone, so a stale
Quick Tunnel URL makes Claims, Blue Cross, and Desjardins appear offline even
when the web app itself is correctly deployed.

ngrok's **Free** account currently provides an automatically assigned
`https://<your-domain>.ngrok-free.dev` hostname (some existing accounts use
`.ngrok-free.app`). It remains fixed after the ngrok agent restarts. No paid
domain or Tailscale client is required. The free tier limits requests and
bandwidth; inspect https://ngrok.com/docs/pricing-limits before relying on it.

### Security decision — read before opting in

**ngrok Free is public internet ingress, NOT a private-network replacement.**
The ngrok operator terminates the public HTTPS connection and can process
traffic. The source repository requires a private route by default; this option
is explicitly opt-in and is **not enabled by a code merge**. A more private
alternative is a separately authenticated private HTTPS route under an
already-owned domain, where available.

If opting in, keep the worker bound to `127.0.0.1`, use the **existing secret
pairing key**, retain the precise allowed-origin list on the worker, and leave
Windows firewall port 4713 closed to inbound network access. Do not add
`0.0.0.0` worker binding or remove CORS/pairing checks. Anyone can reach the
public ngrok hostname; they must still pass worker authentication to read
private records. Never share the ngrok authtoken or pairing key via chat,
GitHub, a screenshot, or a support ticket. A secret key in localStorage is
defense in depth, not a substitute for a private route. Do not use the free
endpoint if this risk is unacceptable for the family's sensitive claims data.

## Setup on the existing Windows worker PC

Run as the **same Windows user** as the current FamilyHub worker. Use the
existing checkout and the existing private data directory (do not initialize a
new worker or generate a new pairing key).

1. Verify the existing worker is running:
   ```powershell
   Test-NetConnection 127.0.0.1 -Port 4713
   ```
   A failed test means the worker must be restored first under its current
   installation and `FAMILYHUB_WORKER_DATA`, preserving its current key,
   private insurer profiles and source data. The tunnel installer does not
   start or modify the worker.

2. Install ngrok on this PC from https://ngrok.com/download/windows:
   ```powershell
   winget install ngrok -s msstore
   ```
   Create/select a Free ngrok account. Copy its authtoken **only on this PC**
   and configure it using ngrok's local command or settings. Do not commit or
   share the token:
   ```powershell
   ngrok config add-authtoken YOUR_LOCAL_TOKEN
   ngrok config check
   ```

3. First run the tunnel *in the foreground*:
   ```powershell
   .\scripts\Run-StableTunnel.ps1
   ```
   Verify that the ngrok forwarding hostname is the account's **assigned
   dev domain**, that it points to `http://127.0.0.1:4713`, and that the
   worker remains localhost-bound. The assigned URL does not change on restart.
   If the agent was launched as a Windows task, read its local (PC-only)
   status from:
   ```powershell
   (Invoke-RestMethod http://127.0.0.1:4040/api/tunnels).tunnels |
     Select-Object name, public_url
   ```
   Do not display private API responses or tokens. If there is no active
   ngrok URL, inspect the agent on this PC.

4. In the **updated** FamilyHub PWA on the phone, open
   **Plus → Réglages et outils → Local AI**. Enter the assigned HTTPS ngrok
   domain as `Worker endpoint`, keep the existing pairing key and press
   **Test connection**. This stores the working endpoint on that phone. Only
   after the test succeeds, stop the old temporary Cloudflare Quick Tunnel.

5. After the manual test, optionally arrange for ngrok to start at Windows
   logon, using an explicit acknowledgement:
   ```powershell
   .\scripts\Install-StableTunnel.ps1 -AcknowledgePublicEndpoint
   Start-ScheduledTask -TaskName 'FamilyHub Stable HTTPS Tunnel'
   Get-ScheduledTaskInfo -TaskName 'FamilyHub Stable HTTPS Tunnel'
   ```
   The task runs only after this Windows user signs in. It does **not**
   start the FamilyHub worker. If the worker does not auto-start separately,
   the stable hostname will still exist but the app can show 502/offline.
   The task never triggers insurer collection or applies payments.
   To revoke exposure: stop and disable the scheduled task, terminate
   `ngrok`, then remove the stored phone endpoint.

## Browser transport behavior

The free ngrok tier may display an interstitial HTML warning for browser
requests. The PWA sends `ngrok-skip-browser-warning: 1` **only** to HTTPS
hostnames matching one assigned ngrok Free dev domain. All worker requests
keep `x-familyhub-key`, exact-origin validation and no automatic replay of
uncertain writes. The worker now includes the opt-out header in its
`Access-Control-Allow-Headers` preflight response. No extra credentials are
introduced. This code needs deployment to GitHub Pages **and** updating the
existing installed worker before physical-phone acceptance.

## Acceptance after installation

- The local `127.0.0.1:4713` worker is authenticated using the unchanged key.
- Phone **Test connection** succeeds using the stable domain and continues to
  succeed after stopping/restarting **only** ngrok.
- A request without the pairing key is refused with 401, and a disallowed
  browser Origin is refused (avoid publishing test keys or private responses).
- No raw claim, attachment or insurer source is published by the static PWA.
- Preview Desjardins and Blue Cross independently. A connected worker does
  not prove a complete portal read; **never auto-Apply** an incomplete or
  ambiguous collection and never re-run an uncertain claim upload.
- Check free-tier quota, history, and eventual live-phone acceptance.

## Troubleshooting

- **No localhost port 4713:** existing worker is offline; fix its Windows
  process/data-directory setup before changing the network route.
- **Local worker available, no ngrok tunnel:** configure the local ngrok
  account and start the assigned dev-domain endpoint.
- **ngrok online, phone fails:** check PWA build/worker CORS header, endpoint,
  phone pairing key, tunnel quota, and local worker response; do not
  rotate a key to fix a URL.
- **ngrok online, insurers still warn:** inspect source-specific
  `login-required`, incomplete preview, source ambiguity and lastSuccess;
  connectivity and data freshness are different conditions.
