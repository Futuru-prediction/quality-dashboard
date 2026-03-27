# FTU-247 - Sentry alerting, ownership, and chat routing

Operational runbook for alerting on `quality-dashboard`.

This document is aligned with the current repo workflow:

- Production deploys run from `.github/workflows/deploy.yml`
- The workflow deploys from `main` to the Vercel production environment
- Sentry releases are named from `github.sha`
- Current local app env vars remain `VITE_GITHUB_TOKEN` and `VITE_LINEAR_TOKEN`
- Optional browser Sentry env vars are `VITE_SENTRY_DSN`, `VITE_SENTRY_ENVIRONMENT`, and `VITE_SENTRY_RELEASE`

For provisioning and secret placement, keep using [docs/provisioning/sentry.md](../provisioning/sentry.md).
For execution and closure evidence specific to WhatsApp routing, use [docs/operations/FTU-247-whatsapp-closure-playbook.md](./FTU-247-whatsapp-closure-playbook.md).

## Objective

Make Sentry alerts actionable for the browser app without creating noise.

The alerting model should answer three questions quickly:

1. Is the app erroring more than normal?
2. Is a release breaking production?
3. Who owns the first response?

## Recommended alert rules

Use a small set of rules with clear routing. Prefer production-only paging and lower severity for preview or staging.

| Rule | What it catches | Suggested trigger | Route |
|---|---|---|---|
| Error rate spike | Broad browser/runtime failures | Production error rate above baseline, or a sustained spike over a 5-minute window | Frontend owner, with chat notification |
| New regression after deploy | Fresh issue introduced by a release | New issue first seen in the current `github.sha` release, especially if it has repeats or affects multiple users | Frontend owner first, infra informed if it looks platform-related |
| Release health drop | A bad release with elevated crash/error activity | Release health below the agreed threshold for the production release | Frontend owner + on-call fallback |
| High-severity issue | Failures that block the dashboard itself | Error fingerprint tied to app boot, auth, API bootstrap, or page load | Frontend owner immediately, then on-call fallback if unacknowledged |

Recommended starting thresholds:

- Error rate spike: alert when production issues exceed the normal 7-day baseline by 2x or when a single issue crosses a meaningful burst threshold within 5 minutes.
- New regression: alert on the first production occurrence of a new issue after deploy, but only page if it repeats or affects more than one user.
- Release health: alert when the current production release shows a clear degradation in crash-free or error-free sessions.
- High-severity issue: page immediately for startup failures, repeated auth failures, or a dashboard-down condition.

Practical rule design:

- Scope rules to `production` first.
- Keep `staging` and preview notifications non-paging unless they are being used as a release gate.
- Group by issue fingerprint and release so the same problem does not open multiple alerts.
- Add a minimum event threshold so one-off browser exceptions do not page the team.

## Owner mapping model

Use a simple ownership model with one primary owner and one fallback owner.

| Alert type | Primary owner | Secondary owner | Fallback |
|---|---|---|---|
| UI rendering / client runtime errors | Frontend owner | Infra owner if the failure looks deployment-related | On-call fallback |
| Auth / token / integration failures | Frontend owner | Infra owner if it is environment, secret, or release related | On-call fallback |
| Release health degradation | Frontend owner | Infra owner | On-call fallback |
| Chat routing failures | Infra owner | Frontend owner | On-call fallback |

Recommended ownership fields:

- `team=frontend` for browser app code and product-facing regressions
- `team=infra` for deployment, environment, release, and routing issues
- `fallback=on-call` for anything unassigned after the first response window

Recommended triage rule:

- The frontend owner is the first responder for product-impacting browser issues.
- The infra owner owns Vercel, GitHub Actions, Sentry routing, and environment drift.
- The on-call fallback is the escalation path when the primary owner does not acknowledge within the agreed window.

## Chat integration and routing (WhatsApp via webhook bridge)

Use WhatsApp as the notification surface for this project through a webhook bridge. Sentry sends `event.alert` payloads to the bridge, and the bridge forwards normalized messages to WhatsApp.

Current provider decision: `Z-API` ([z-api.io](https://www.z-api.io/)).

### Setup steps

1. Deploy the bridge endpoint in this repo: `POST /api/sentry-whatsapp-webhook`.
2. Configure Vercel env vars:
   - `SENTRY_TO_WHATSAPP_SECRET`
   - `WHATSAPP_ALERT_DESTINATIONS` (comma-separated)
   - `ZAPI_INSTANCE_ID`
   - `ZAPI_INSTANCE_TOKEN`
   - `ZAPI_CLIENT_TOKEN` (optional)
3. In Sentry, create a Service Hook (`event.alert`) targeting:
   - `https://<seu-dominio>/api/sentry-whatsapp-webhook?secret=<SENTRY_TO_WHATSAPP_SECRET>`
4. In Z-API, confirm instance is connected and destination format is valid (number/group ID expected by provider).
5. Configure production destination (group/number) for high-priority alerts.
6. Configure non-production destination (group/number) or suppress lower-priority alerts.
7. Verify outgoing messages include release, environment, issue title, and direct Sentry links.

### Routing rules

- Production error spikes: send to WhatsApp production destination.
- New regressions: send to production destination with owner context.
- Release health failures: send to production destination, then escalate to on-call if unacked.
- Non-production noise: send to non-production destination or keep as digest-only.

### Message content to require

Every WhatsApp alert should include:

- Environment
- Sentry release SHA
- Issue or release title
- First-seen time
- Direct link to the issue
- Direct link to the release health view
- Primary owner or owner tag

### Troubleshooting (bridge + provider)

If an alert does not reach WhatsApp, diagnose in this order:

1. Confirm Sentry actually fired the rule/event.
2. Confirm bridge endpoint was called (`POST /api/sentry-whatsapp-webhook`).
3. Confirm bridge response status and `requestId`.
4. Confirm provider response for each destination.

Bridge status quick map:

- `401 unauthorized`: secret mismatch (`SENTRY_TO_WHATSAPP_SECRET` vs request).
- `400 invalid_sentry_resource`: header `sentry-hook-resource` is not `event.alert`.
- `500 missing_env`: missing `SENTRY_TO_WHATSAPP_SECRET` or `ZAPI_*`/destinations.
- `502`: bridge called provider but at least one destination failed in Z-API.
- `200`: bridge accepted and provider returned success for all destinations.

Operational logs emitted by bridge:

- `request_accepted`
- `provider_send_result`
- `request_completed`

Each log includes `requestId`, plus rule/environment/release when available, so incidents can be traced end to end.

## Anti-noise calibration checklist

Use this checklist before turning on paging:

- Production is the only paging environment.
- Preview and staging alerts are either muted or routed to a non-paging channel.
- Thresholds are based on real baseline data, not guesses.
- Alerts are grouped by issue fingerprint and release.
- One-off client-side exceptions are filtered or downgraded.
- Known flaky browser errors are merged, ignored, or annotated.
- Alerts tied to a single user only page if they are release-blocking.
- Source maps are uploading successfully, so stack traces are readable.
- WhatsApp routing is tested end to end before enabling production paging.
- The owner map is documented and the fallback path is explicit.

Suggested calibration loop:

1. Start with wider thresholds for one week.
2. Review every alert that fired and classify it as actionable or noisy.
3. Tighten only one rule at a time.
4. Keep the production paging threshold conservative.

## Weekly review cadence

Run a 30-minute review once per week, preferably after the busiest deploy window.

Agenda:

1. Review all Sentry alerts from the last 7 days.
2. Check which alerts were actionable and which were noise.
3. Verify the current production release has no unresolved high-severity issues.
4. Review chat routing and confirm alerts landed in the right destination.
5. Confirm ownership handoff: frontend, infra, or on-call fallback.
6. Record any threshold changes, suppressions, or ownership updates.

Outputs from the review:

- Updated alert thresholds if needed
- Updated issue fingerprints or suppression rules
- Updated owner mapping if the team changed
- Any release health follow-up items

## Acceptance criteria

This work is ready when all of the following are true:

- The runbook references the current deploy workflow in `.github/workflows/deploy.yml`.
- The runbook names the current environments and secrets used by the repo.
- At least one production error-rate rule, one regression rule, and one release-health rule are defined.
- The ownership model includes frontend, infra, and on-call fallback routing.
- Chat routing is documented with a production channel and a quieter non-production path.
- An anti-noise checklist exists and is usable before paging is enabled.
- A weekly review cadence is documented.

## Evidence steps

Use these steps to prove the setup works:

1. Confirm GitHub Actions on `main` runs the deploy workflow in `.github/workflows/deploy.yml`.
2. Confirm the workflow sets the Sentry release from `github.sha`.
3. Confirm the Vercel production deploy uses the same production environment name as the workflow.
4. Trigger or simulate a controlled Sentry test issue in production or a safe non-paging environment.
5. Verify the alert lands in the correct WhatsApp destination.
6. Verify the WhatsApp message includes the release SHA, environment, and direct Sentry link.
7. Verify the alert routes to the documented owner and fallback path.
8. Record the outcome in the weekly review notes.

## Notes

- Keep browser bundle Sentry settings out of git and out of `NEXT_PUBLIC_*`.
- Keep `docs/provisioning/sentry.md` as the provisioning and secret reference.
- If environments change in the workflow, update this runbook in the same change.
