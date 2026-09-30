# Recovering an expired insurer session

In Claims → Sources & sync, choose **Reconnect Blue Cross on PC** or **Reconnect Desjardins on PC**. The paired PC must be awake with its interactive desktop available. Complete the insurer's normal sign-in and any verification in the browser window. FamilyHub then reads claim history and prepares a preview. Review that preview before choosing Apply.

The phone can close the panel or disconnect during authentication. Reopen Sources & sync to check progress; do not start a second collector or CLI against the same browser profile. Sign-in waits up to ten minutes. If it expires or the browser closes, reconnect again. A PC worker restart interrupts the operation; it does not silently replay authentication or apply data.

Saved browser state helps while the insurer accepts it, but cannot guarantee indefinite access. This release automates the collection after user authentication. It does not store passwords, answer MFA, enable a scheduler, or promise unattended sign-in. Password-assisted sign-in would require a separately selected local credential setup and portal-specific validation. Notification email is not a replacement for source claim amounts: Pacific Blue Cross [paperless notifications](https://www.pac.bluecross.ca/member-privileges/how-tos/go-paperless/) direct members to documents in the authenticated portal.

Worker 2.14.0 is required. POST `/{bluecross|desjardins}/reconnect` with `interactive: true` returns 202; GET on the same route returns the job. Both use the existing pairing/origin controls. Status and results exclude private snapshot/backup paths. Reconnect invokes only the existing preview operation with `apply=false` and `interactive=true`.

Validation separates synthetic regression tests, release/build checks, installed-worker read-only checks, actual insurer login/MFA, and physical-phone acceptance. The latter two require the operator and remain pending until observed.
