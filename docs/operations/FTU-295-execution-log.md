# FTU-295 Execution Log

Status: `Done` (with follow-up hardening tasks)
Date: 2026-03-27
Owner: Hugo Gonçalves

## Phase 1 - Verified (Sentry side)

- Organization: `futuru-testnet`
- Region URL: `https://us.sentry.io`
- Project: `javascript-react`
- Production synthetic issue detected:
  - Issue: `JAVASCRIPT-REACT-2`
  - URL: `https://futuru-testnet.sentry.io/issues/JAVASCRIPT-REACT-2`
  - Error: `FTU241_SYNTH_1774607284763`
  - Environment: `production`
  - Release: `4bd885268762464a69c5b1f469cdd172c2510236`
  - Event IDs:
    - `6de9d9f228b4487fa2cba446467a05dd`
    - `738e5ffef8b3442fa5195bb5273886eb`

Discovery link (last 24h issue events):

- https://futuru-testnet.sentry.io/explore/discover/homepage/?dataset=errors&queryDataset=error-events&query=issue%3AJAVASCRIPT-REACT-2&project=4511115287789568&field=id&field=timestamp&field=environment&field=release&sort=-timestamp&statsPeriod=24h&yAxis=count%28%29

## Phase 2 - Delivered (WhatsApp route via Z-API bridge)

Implemented in repository:

- Bridge endpoint: `api/sentry-whatsapp-webhook.js`
- Route: `POST /api/sentry-whatsapp-webhook`
- Provider integration: Z-API `send-text` endpoint
- Secret validation: `SENTRY_TO_WHATSAPP_SECRET` (header/query/body)
- Destinations: `WHATSAPP_ALERT_DESTINATIONS` (comma-separated)

Operational steps executed:

1. Set Vercel env vars:
   - `SENTRY_TO_WHATSAPP_SECRET`
   - `WHATSAPP_ALERT_DESTINATIONS`
   - `ZAPI_INSTANCE_ID`
   - `ZAPI_INSTANCE_TOKEN`
   - `ZAPI_CLIENT_TOKEN` (optional)
2. Configure Sentry Service Hook (`event.alert`) to:
   - `https://<domain>/api/sentry-whatsapp-webhook?secret=<SENTRY_TO_WHATSAPP_SECRET>`
3. Confirm alert rules route to service hook for:
   - Error rate spike
   - New regression
   - Release health drop
4. Trigger controlled alert and verify bridge/provider response.

## Phase 3 - Follow-up hardening

Post-closure reliability and operations hardening are tracked in dedicated tasks:

- `FTU-349` - reliable Sentry service hook triggering (Done, PR #1 merged on 2026-03-27)
- `FTU-350` - deploy canary E2E for alerting (In Progress)
- `FTU-352` - operational observability in webhook bridge (Done)
- `FTU-353` - secret rotation and post-rotation validation (Done)

Delivered in `FTU-349`:

- Refactor of webhook parsing/normalization for multiple payload formats.
- Destination normalization hardening.
- Dedicated unit tests for bridge parsing and metadata extraction.
- Pull request: https://github.com/Futuru-prediction/quality-dashboard/pull/1

## Evidence checklist to close FTU-295 / FTU-247

- [x] Sentry rule screenshot/link
- [x] Sentry alert link showing production + release
- [x] Service hook screenshot/link
- [x] Bridge delivery log/screenshot
- [x] Provider response with `messageId` from Z-API
- [x] Final Linear comment posted with execution outcome

## References

- Playbook: `docs/operations/FTU-247-whatsapp-closure-playbook.md`
- Parent closure notes: `docs/operations/sentry-task-closure-2026-03-27.md`
