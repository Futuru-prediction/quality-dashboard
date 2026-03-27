import * as Sentry from "@sentry/react";

const sentryDsn = import.meta.env.VITE_SENTRY_DSN?.trim();
const sentryEnvironment =
  import.meta.env.VITE_SENTRY_ENVIRONMENT?.trim() || import.meta.env.MODE;
const sentryRelease =
  import.meta.env.VITE_SENTRY_RELEASE?.trim() ||
  import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA?.trim();

let isInitialized = false;

export function initSentry() {
  if (isInitialized) return;
  isInitialized = true;

  if (!sentryDsn) return;

  Sentry.init({
    dsn: sentryDsn,
    environment: sentryEnvironment,
    release: sentryRelease || undefined,
    integrations: Sentry.getDefaultIntegrations({}),
  });
}
