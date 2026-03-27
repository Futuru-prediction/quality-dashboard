# FTU-247 - WhatsApp Closure Playbook

Objective: close `FTU-247` using WhatsApp as the notification channel for Sentry alerts, with auditable evidence in Linear.

## Scope and decision

- Preferred channel for this closure: `WhatsApp`
- Selected provider: `Z-API` ([z-api.io](https://www.z-api.io/))
- Sentry does not provide native WhatsApp alert routing in this setup; use service hook webhook + external bridge.
- This playbook closes FTU-247 only after end-to-end evidence is attached.

References:

- Sentry service hooks (webhook option): https://docs.sentry.io/api/projects/register-a-new-service-hook/
- Canary execution playbook: `docs/operations/sentry-whatsapp-canary.md`

## Prerequisites

1. Access to Sentry org/project used by `quality-dashboard`.
2. Access to the WhatsApp destination (group or number) and Z-API credentials.
3. Production release pipeline healthy (`.github/workflows/deploy.yml`).
4. A known test trigger path (forced error boundary, synthetic exception, or controlled failing route).

## Required configuration checklist

1. Use the bridge endpoint already implemented in this repo:
   - `POST /api/sentry-whatsapp-webhook`
   - File: `api/sentry-whatsapp-webhook.js`
2. Configure environment variables in Vercel:
   - `SENTRY_TO_WHATSAPP_SECRET`
   - `WHATSAPP_ALERT_DESTINATIONS` (comma-separated)
   - `ZAPI_INSTANCE_ID`
   - `ZAPI_INSTANCE_TOKEN`
   - `ZAPI_CLIENT_TOKEN` (optional)
3. Configure Sentry service hook for alert events (`event.alert`) pointing to:
   - `https://<domain>/api/sentry-whatsapp-webhook?secret=<SENTRY_TO_WHATSAPP_SECRET>`
4. Protect the bridge endpoint:
   - keep shared secret required
   - accept only `POST`
   - reject unsupported Sentry resource types
5. Create (or confirm) these alert rules in Sentry:
   - Error rate spike (production)
   - New regression after deploy
   - Release health drop
6. Ensure production-only paging behavior:
   - `environment=production` for paging route
   - staging/preview route to non-paging recipient/group
7. Confirm owner/fallback mapping is explicit in payload/routing metadata:
   - Primary: frontend owner
   - Secondary: infra owner
   - Fallback: on-call

## Quick bridge validation (before Sentry)

Run a local smoke test against the deployed endpoint:

```bash
curl -X POST "https://<domain>/api/sentry-whatsapp-webhook?secret=<secret>" \
  -H "Content-Type: application/json" \
  -H "sentry-hook-resource: event.alert" \
  -d '{
    "action":"triggered",
    "data":{
      "triggered_rule":"FTU test rule",
      "event":{
        "title":"FTU test alert",
        "level":"error",
        "environment":"production",
        "release":"test-release-sha",
        "web_url":"https://futuru-testnet.sentry.io/issues/JAVASCRIPT-REACT-2"
      }
    }
  }'
```

Expected result: HTTP `200` with `ok: true` and `sentCount > 0`.

## Evidence run (must be executed)

1. Deploy current `main` to production.
2. Trigger one controlled Sentry event in a safe window.
3. Confirm alert appears in Sentry with:
   - environment
   - release SHA
   - issue link
4. Confirm corresponding WhatsApp message lands in expected destination.
5. Confirm routing mentions/tagging for owner and fallback.
6. Capture evidence artifacts:
   - Sentry alert screenshot/link
   - WhatsApp message screenshot/link
   - rule configuration screenshot/link
   - service hook / bridge configuration screenshot/link

## FTU-247 closure gate

Close only if all are true:

- Alert rule exists and is active.
- Test event generated a real alert.
- WhatsApp received alert in correct destination.
- Owner/fallback routing was visible.
- Evidence is attached in Linear comment.

## Linear comment template (copy/paste)

```md
FTU-247 evidence run completed on YYYY-MM-DD.

Channel decision:
- Notification channel: WhatsApp
- Production destination: <group/number>
- Non-prod destination: <group/number>

Rules validated:
1. Error rate spike (production)
2. New regression after deploy
3. Release health drop

End-to-end evidence:
- Sentry alert link: <paste URL>
- Sentry rule link: <paste URL>
- Service hook link/screenshot: <paste URL or attachment>
- Bridge log/screenshot: <paste URL or attachment>
- WhatsApp message link/screenshot: <paste URL or attachment>
- Release SHA observed: `<paste sha>`
- Environment observed: `production`

Routing verification:
- Primary owner notified: <name/team>
- Secondary owner notified: <name/team>
- Fallback path confirmed: <on-call reference>

Result:
- [ ] All checks passed -> set FTU-247 to Done
- [ ] Any check failed -> keep In Review and list gaps below

Gaps (if any):
- <gap 1>
- <gap 2>
```
