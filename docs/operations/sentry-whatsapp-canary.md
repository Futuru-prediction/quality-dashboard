# Sentry -> WhatsApp Canary (Per Deploy)

Purpose: verify on every production deploy that the alerting chain is alive:

`Sentry rule` -> `Service Hook (event.alert)` -> `bridge endpoint` -> `Z-API` -> `WhatsApp destination`.

## Trigger convention

Use a unique marker to avoid ambiguity:

- Error message prefix: `FTU247_E2E_CANARY_`
- Full value example: `FTU247_E2E_CANARY_2026-03-27T20:15:00Z`

## Canary checklist

1. Ensure service hook URL is active in Sentry:
   - `https://quality-dashboard-three.vercel.app/api/sentry-whatsapp-webhook?secret=<SECRET>`
2. Ensure alert rule includes canary condition:
   - message contains `FTU247_E2E_CANARY`
3. Trigger synthetic error in production browser console:

```js
setTimeout(() => { throw new Error("FTU247_E2E_CANARY_" + Date.now()) }, 0);
```

4. Confirm event in Sentry for project `javascript-react`.
5. Confirm bridge response/log entry with matching `requestId`.
6. Confirm Z-API returned `messageId`.
7. Confirm message reached WhatsApp destination.

## Pass/fail criteria

- Pass: event observed in Sentry + bridge `200` + provider success + WhatsApp message received.
- Fail: any hop missing or delayed beyond SLA window (recommended 5 minutes).

## Record template

Copy this block to the issue/comment tracking the run:

```md
Canary run timestamp: <UTC timestamp>
Release SHA: <sha>
Sentry event URL: <url>
Bridge requestId: <requestId>
Bridge status: <status>
Provider status: <status>
Provider messageId: <messageId>
WhatsApp receipt: <screenshot/link>
Result: PASS | FAIL
```
