import * as Sentry from "@sentry/react";

const sentryDsn = import.meta.env.VITE_SENTRY_DSN?.trim();
const sentryEnvironment =
  import.meta.env.VITE_SENTRY_ENVIRONMENT?.trim() || import.meta.env.MODE;
const sentryRelease =
  import.meta.env.VITE_SENTRY_RELEASE?.trim() ||
  import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA?.trim();

const REDACTED = "[Filtered]";
const EMAIL_REGEX =
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const JWT_REGEX =
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9._-]{8,}\.[A-Za-z0-9._-]{8,}\b/g;
const SENSITIVE_KEYS = new Set([
  "authorization",
  "proxyauthorization",
  "apikey",
  "xapikey",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "password",
  "passcode",
  "passwd",
  "pwd",
  "secret",
  "session",
  "cookie",
  "setcookie",
  "csrf",
  "xsrf",
  "token",
  "bearer",
  "auth",
]);
const IGNORED_ERROR_PATTERNS = [
  /^ResizeObserver loop limit exceeded\.?$/i,
  /^ResizeObserver loop completed with undelivered notifications\.?$/i,
  /^Non-Error promise rejection captured with value:/i,
  /^Script error\.?$/i,
];

let isInitialized = false;

function isSensitiveKey(key) {
  if (typeof key !== "string") return false;

  const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return SENSITIVE_KEYS.has(normalizedKey);
}

function redactUrl(value) {
  try {
    const base =
      typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const url = new URL(value, base);
    return value.startsWith("/") ? url.pathname : `${url.origin}${url.pathname}`;
  } catch {
    return value;
  }
}

function sanitizeString(value, key) {
  if (typeof value !== "string") return value;
  if (isSensitiveKey(key)) return REDACTED;

  let sanitized = value
    .replace(EMAIL_REGEX, REDACTED)
    .replace(JWT_REGEX, REDACTED);

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(sanitized) || sanitized.startsWith("/")) {
    sanitized = redactUrl(sanitized);
  }

  return sanitized;
}

function sanitizeValue(value, key, seen = new WeakSet()) {
  if (value == null) return value;

  if (typeof value === "string") {
    return sanitizeString(value, key);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);

    if (Array.isArray(value)) {
      return value.map((item) => sanitizeValue(item, key, seen));
    }

    if (value instanceof Date) {
      return value;
    }

    const sanitized = {};

    for (const [entryKey, entryValue] of Object.entries(value)) {
      if (entryValue == null) {
        sanitized[entryKey] = entryValue;
        continue;
      }

      if (entryKey === "url" || entryKey === "uri" || entryKey === "href") {
        sanitized[entryKey] =
          typeof entryValue === "string" ? redactUrl(entryValue) : entryValue;
        continue;
      }

      if (isSensitiveKey(entryKey)) {
        sanitized[entryKey] = REDACTED;
        continue;
      }

      sanitized[entryKey] = sanitizeValue(entryValue, entryKey, seen);
    }

    return sanitized;
  }

  return value;
}

function getEventErrorMessage(event, hint) {
  const originalException = hint?.originalException;

  if (typeof originalException === "string") return originalException;
  if (originalException instanceof Error) return originalException.message;
  if (originalException && typeof originalException === "object" && typeof originalException.message === "string") {
    return originalException.message;
  }

  const exceptionValue = event?.exception?.values?.[0]?.value;
  if (typeof exceptionValue === "string") return exceptionValue;

  if (typeof event?.message === "string") return event.message;

  return "";
}

function shouldIgnoreEvent(event, hint) {
  const message = getEventErrorMessage(event, hint).trim();
  if (!message) return false;

  return IGNORED_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function sanitizeEvent(event) {
  const sanitizedEvent = sanitizeValue(event);

  if (sanitizedEvent?.user && typeof sanitizedEvent.user === "object") {
    delete sanitizedEvent.user.email;
    delete sanitizedEvent.user.name;
    delete sanitizedEvent.user.username;
  }

  if (sanitizedEvent?.request && typeof sanitizedEvent.request === "object") {
    if (typeof sanitizedEvent.request.url === "string") {
      sanitizedEvent.request.url = redactUrl(sanitizedEvent.request.url);
    }

    if (sanitizedEvent.request.headers && typeof sanitizedEvent.request.headers === "object") {
      sanitizedEvent.request.headers = sanitizeValue(sanitizedEvent.request.headers);
    }
  }

  return sanitizedEvent;
}

function sanitizeBreadcrumb(breadcrumb) {
  const sanitizedBreadcrumb = sanitizeValue(breadcrumb);

  if (sanitizedBreadcrumb?.data && typeof sanitizedBreadcrumb.data === "object") {
    sanitizedBreadcrumb.data = sanitizeValue(sanitizedBreadcrumb.data);
  }

  if (typeof sanitizedBreadcrumb?.message === "string") {
    sanitizedBreadcrumb.message = sanitizeString(sanitizedBreadcrumb.message);
  }

  return sanitizedBreadcrumb;
}

export function initSentry() {
  if (isInitialized) return;
  isInitialized = true;

  if (!sentryDsn) return;

  Sentry.init({
    dsn: sentryDsn,
    environment: sentryEnvironment,
    release: sentryRelease || undefined,
    sendDefaultPii: false,
    integrations: Sentry.getDefaultIntegrations({}),
    ignoreErrors: IGNORED_ERROR_PATTERNS,
    beforeSend(event, hint) {
      try {
        if (shouldIgnoreEvent(event, hint)) return null;
        return sanitizeEvent(event);
      } catch {
        return event;
      }
    },
    beforeBreadcrumb(breadcrumb) {
      try {
        return sanitizeBreadcrumb(breadcrumb);
      } catch {
        return breadcrumb;
      }
    },
  });
}
