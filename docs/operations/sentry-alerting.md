# FTU-247 - Sentry alerting, ownership, and Slack routing

Operational runbook for alerting on `quality-dashboard`.

This document is aligned with the current repo workflow:

- Production deploys run from `.github/workflows/deploy.yml`
- The workflow deploys from `main` to the Vercel production environment
- Sentry releases are named from `github.sha`
- Current local app env vars remain `VITE_GITHUB_TOKEN` and `VITE_LINEAR_TOKEN`
- Optional browser Sentry env vars are `VITE_SENTRY_DSN`, `VITE_SENTRY_ENVIRONMENT`, and `VITE_SENTRY_RELEASE`

For provisioning and secret placement, keep using [docs/provisioning/sentry.md](../provisioning/sentry.md).

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
| Error rate spike | Broad browser/runtime failures | Production error rate above baseline, or a sustained spike over a 5-minute window | Frontend owner, with Slack notification |
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
| Slack or routing failures | Infra owner | Frontend owner | On-call fallback |

Recommended ownership fields:

- `team=frontend` for browser app code and product-facing regressions
- `team=infra` for deployment, environment, release, and routing issues
- `fallback=on-call` for anything unassigned after the first response window

Recommended triage rule:

- The frontend owner is the first responder for product-impacting browser issues.
- The infra owner owns Vercel, GitHub Actions, Sentry routing, and environment drift.
- The on-call fallback is the escalation path when the primary owner does not acknowledge within the agreed window.

## Slack integration and routing

Use Slack as the notification surface, not as the alert source of truth.

### Setup steps

1. In Sentry, install or enable the Slack integration for the organization that owns `quality-dashboard`.
2. Connect the team Slack workspace and authorize the channels that should receive alerts.
3. Create a dedicated channel for production quality alerts, for example `#quality-alerts`.
4. Add a smaller team channel if you want non-paging visibility, for example `#frontend-quality`.
5. Map production alerts to `#quality-alerts`.
6. Map lower-severity preview or staging alerts to a quieter channel or suppress them entirely.
7. Verify that messages include release, environment, issue title, and direct links back to Sentry.

### Routing rules

- Production error spikes: send to `#quality-alerts`.
- New regressions: send to `#quality-alerts` and tag the frontend owner.
- Release health failures: send to `#quality-alerts`, then escalate to on-call if unacked.
- Non-production noise: send to the team-only channel or keep as digest-only.

### Message content to require

Every Slack alert should include:

- Environment
- Sentry release SHA
- Issue or release title
- First-seen time
- Direct link to the issue
- Direct link to the release health view
- Primary owner or owner tag

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
- Slack routing is tested end to end before enabling production paging.
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
4. Review Slack routing and confirm alerts landed in the right channel.
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
- Slack routing is documented with a production channel and a quieter non-production path.
- An anti-noise checklist exists and is usable before paging is enabled.
- A weekly review cadence is documented.

## Evidence steps

Use these steps to prove the setup works:

1. Confirm GitHub Actions on `main` runs the deploy workflow in `.github/workflows/deploy.yml`.
2. Confirm the workflow sets the Sentry release from `github.sha`.
3. Confirm the Vercel production deploy uses the same production environment name as the workflow.
4. Trigger or simulate a controlled Sentry test issue in production or a safe non-paging environment.
5. Verify the alert lands in the correct Slack channel.
6. Verify the Slack message includes the release SHA, environment, and direct Sentry link.
7. Verify the alert routes to the documented owner and fallback path.
8. Record the outcome in the weekly review notes.

## Notes

- Keep browser bundle Sentry settings out of git and out of `NEXT_PUBLIC_*`.
- Keep `docs/provisioning/sentry.md` as the provisioning and secret reference.
- If environments change in the workflow, update this runbook in the same change.
