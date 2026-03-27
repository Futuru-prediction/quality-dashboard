# Sentry Task Closure Check - 2026-03-27

Scope: verify if `FTU-244`, `FTU-246`, `FTU-247`, and `FTU-249` can be closed based on repository evidence and local validation.

## Validation summary

- `npm run lint`: pass
- `npm run test`: pass (9/9)
- `npm run build`: pass

## Decision by issue

| Issue | Title | Decision | Rationale |
|---|---|---|---|
| FTU-244 | Error Boundary global + captura contextual | Close | Global boundary is mounted in app bootstrap, fallback UI exists, route/component context tags are attached before capture, and controlled failure hook exists for validation. |
| FTU-246 | Sanitização de PII e filtros | Close | Browser SDK applies recursive sanitization for event + breadcrumb payloads, strips user PII fields, redacts sensitive keys/tokens, normalizes URLs, and drops known noisy errors. |
| FTU-247 | Alertas + ownership + chat routing | Keep open (`In Review`) | Runbook is complete, but this repository cannot prove end-to-end operational evidence (real alert firing and chat delivery) without direct Sentry/chat runtime validation artifacts. |
| FTU-249 | Documentação setup + playbook Sentry | Close | Setup/provisioning and operational runbook are documented with env mapping, release/source map flow, privacy policy, ownership, anti-noise checklist, and weekly review cadence. |

## Evidence mapping

- `FTU-244`
  - App is wrapped with global boundary: `src/main.jsx`
  - Fallback + contextual capture: `src/components/ErrorBoundary.jsx`
  - Controlled validation toggle: `src/App.jsx` (`FTU_FORCE_ERROR_BOUNDARY`)

- `FTU-246`
  - SDK init + `beforeSend` and `beforeBreadcrumb`: `src/sentry.js`
  - Recursive sanitizer, redaction, URL normalization, ignore noise patterns: `src/sentry.js`
  - Privacy policy documentation: `docs/provisioning/sentry.md`

- `FTU-247`
  - Alerting/ownership/chat runbook: `docs/operations/sentry-alerting.md`
  - WhatsApp (Z-API) closure playbook + evidence template: `docs/operations/FTU-247-whatsapp-closure-playbook.md`
  - Missing hard evidence in repo: alert test event delivery log and chat-channel receipt proof

- `FTU-249`
  - Setup + secrets + environment mapping + guardrails: `docs/provisioning/sentry.md`
  - Triage and operations playbook: `docs/operations/sentry-alerting.md`
