# FTU-241 - Sentry provisioning and secrets

This repo is a Vite frontend deployed on Vercel and built in GitHub Actions. The Sentry SDK bootstrap and sourcemap upload flow are now wired in the project, and this doc is the operational checklist for provisioning and secrets.

## Provisioning checklist

1. Create one Sentry organization for `quality-dashboard`.
2. Create one Sentry project for the browser app.
3. Register these environments in Sentry:
   - `development`
   - `staging`
   - `production`
4. Decide whether preview deploys map to `staging` or `development`. Keep the name consistent across Vercel and GitHub Actions.
5. Create a dedicated Sentry auth token for CI and source-map upload. Do not reuse a personal token.
6. Store the token only in secret managers. Never commit it to git or add it to `NEXT_PUBLIC_*`.
7. If you later add source-map upload, derive the release from the git SHA so CI and Vercel use the same release identifier.

## Required variables

### Local development

These live in `.env` / `.env.local` and are the only values the current app needs:

- `VITE_GITHUB_TOKEN`
- `VITE_LINEAR_TOKEN`

If Sentry is added to the browser bundle later, add:

- `VITE_SENTRY_DSN`
- `VITE_SENTRY_ENVIRONMENT`
- `VITE_SENTRY_RELEASE`

### Vercel

Keep the existing deploy variables aligned with the current workflow in [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml):

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

If the browser bundle starts reading Sentry config from Vercel environment variables, add:

- `VITE_SENTRY_DSN`
- `VITE_SENTRY_ENVIRONMENT`

### GitHub Actions

The current deploy workflow already expects the Vercel secrets above. For Sentry release or sourcemap upload, add these GitHub Actions secrets:

- `SENTRY_AUTH_TOKEN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`

## Practical environment mapping

| Environment | Sentry environment value | Where to set it |
|---|---|---|
| Development | `development` | local `.env` / `.env.local` |
| Staging | `staging` | Vercel preview or a dedicated staging project |
| Production | `production` | Vercel production environment |

## Guardrails

- Keep all secrets out of source control.
- Use placeholder values in `.env.example`.
- Prefer a single source of truth for the Sentry release name and environment labels across Vercel and GitHub Actions.
