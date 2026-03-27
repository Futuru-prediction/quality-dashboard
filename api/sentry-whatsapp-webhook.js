/**
 * Sentry Service Hook (event.alert) -> WhatsApp via Z-API bridge.
 *
 * Expected Vercel env vars:
 * - SENTRY_TO_WHATSAPP_SECRET
 * - ZAPI_INSTANCE_ID
 * - ZAPI_INSTANCE_TOKEN
 * - ZAPI_CLIENT_TOKEN (optional if disabled in Z-API account)
 * - WHATSAPP_ALERT_DESTINATIONS (comma-separated numbers/group IDs)
 */

import {
  buildAlertMessage,
  extractAlertMetadata,
  parseIncomingPayload,
  splitDestinations,
} from "../src/lib/sentryWhatsappBridge.js";

const ZAPI_BASE_URL = "https://api.z-api.io";
const DEFAULT_PROVIDER_TIMEOUT_MS = 8000;
const MIN_PROVIDER_TIMEOUT_MS = 500;
const MAX_PROVIDER_TIMEOUT_MS = 60000;

function createRequestId(req) {
  const externalId = req.headers["x-request-id"];
  if (typeof externalId === "string" && externalId.trim()) return externalId.trim();
  return `s2w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function logBridgeEvent(level, payload) {
  const logger = level === "error" ? console.error : console.log;
  logger(JSON.stringify({ scope: "sentry-whatsapp-bridge", ...payload }));
}

function resolveProviderTimeoutMs() {
  const rawTimeout = Number(process.env.SENTRY_TO_WHATSAPP_TIMEOUT_MS);
  if (!Number.isFinite(rawTimeout)) return DEFAULT_PROVIDER_TIMEOUT_MS;
  return Math.min(MAX_PROVIDER_TIMEOUT_MS, Math.max(MIN_PROVIDER_TIMEOUT_MS, Math.floor(rawTimeout)));
}

function createTimeoutSignal(timeoutMs) {
  if (typeof AbortController === "undefined") {
    return { signal: undefined, clear: () => {} };
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutHandle),
  };
}

function isAbortError(error) {
  return (
    error?.name === "AbortError" ||
    (typeof error?.message === "string" &&
      error.message.toLowerCase().includes("abort"))
  );
}

async function sendZApiTextMessage({
  instanceId,
  instanceToken,
  clientToken,
  phone,
  message,
  timeoutMs,
}) {
  const endpoint = `${ZAPI_BASE_URL}/instances/${instanceId}/token/${instanceToken}/send-text`;
  const headers = {
    "Content-Type": "application/json",
  };

  if (clientToken) headers["Client-Token"] = clientToken;

  const timeout = createTimeoutSignal(timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ phone, message }),
      signal: timeout.signal,
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      payload,
      errorType: null,
    };
  } catch (error) {
    const aborted = isAbortError(error);
    return {
      ok: false,
      status: aborted ? 504 : 502,
      payload: {
        error: aborted ? "provider_timeout" : "provider_unreachable",
        detail:
          error instanceof Error && typeof error.message === "string"
            ? error.message
            : String(error || "unknown_error"),
      },
      errorType: aborted ? "timeout" : "network",
    };
  } finally {
    timeout.clear();
  }
}

export default async function handler(req, res) {
  const requestId = createRequestId(req);
  const sentryResource = req.headers["sentry-hook-resource"] || null;
  const sentryTimestamp = req.headers["sentry-hook-timestamp"] || null;

  if (req.method !== "POST") {
    logBridgeEvent("info", {
      event: "request_rejected_method",
      requestId,
      method: req.method,
      sentryResource,
    });
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed", requestId });
  }

  const bridgeSecret = process.env.SENTRY_TO_WHATSAPP_SECRET;
  const providedSecret =
    req.headers["x-bridge-secret"] ||
    req.query?.secret ||
    req.body?.secret ||
    null;

  if (!bridgeSecret) {
    logBridgeEvent("error", {
      event: "missing_env_secret",
      requestId,
      sentryResource,
    });
    return res.status(500).json({
      ok: false,
      error: "missing_env",
      detail: "SENTRY_TO_WHATSAPP_SECRET",
      requestId,
    });
  }

  if (providedSecret !== bridgeSecret) {
    logBridgeEvent("info", {
      event: "request_rejected_secret",
      requestId,
      sentryResource,
    });
    return res.status(401).json({ ok: false, error: "unauthorized", requestId });
  }

  if (sentryResource && sentryResource !== "event.alert") {
    logBridgeEvent("info", {
      event: "request_rejected_resource",
      requestId,
      sentryResource,
    });
    return res.status(400).json({
      ok: false,
      error: "invalid_sentry_resource",
      detail: sentryResource,
      requestId,
    });
  }

  const instanceId = process.env.ZAPI_INSTANCE_ID;
  const instanceToken = process.env.ZAPI_INSTANCE_TOKEN;
  const clientToken = process.env.ZAPI_CLIENT_TOKEN || "";
  const destinations = splitDestinations(process.env.WHATSAPP_ALERT_DESTINATIONS);
  const providerTimeoutMs = resolveProviderTimeoutMs();

  if (!instanceId || !instanceToken || destinations.length === 0) {
    const missingDetail = [
      !instanceId ? "ZAPI_INSTANCE_ID" : null,
      !instanceToken ? "ZAPI_INSTANCE_TOKEN" : null,
      destinations.length === 0 ? "WHATSAPP_ALERT_DESTINATIONS" : null,
    ].filter(Boolean);

    logBridgeEvent("error", {
      event: "missing_env_provider",
      requestId,
      sentryResource,
      missingDetail,
    });

    return res.status(500).json({
      ok: false,
      error: "missing_env",
      detail: missingDetail,
      requestId,
    });
  }

  const payload = parseIncomingPayload(req.body);
  const metadata = extractAlertMetadata(payload);
  const { rule, environment, release } = metadata;

  logBridgeEvent("info", {
    event: "request_accepted",
    requestId,
    sentryResource,
    sentryTimestamp,
    rule,
    environment,
    release,
    destinationCount: destinations.length,
    providerTimeoutMs,
  });

  const message = buildAlertMessage(payload);

  const results = [];
  for (const phone of destinations) {
    // Sequential sends keep provider rate behavior predictable for small fan-out.
    const sendResult = await sendZApiTextMessage({
      instanceId,
      instanceToken,
      clientToken,
      phone,
      message,
      timeoutMs: providerTimeoutMs,
    });
    results.push({ phone, ...sendResult });

    logBridgeEvent(sendResult.ok ? "info" : "error", {
      event: "provider_send_result",
      requestId,
      phone,
      providerStatus: sendResult.status,
      providerOk: sendResult.ok,
      providerErrorType: sendResult.errorType,
      providerMessageId:
        sendResult.payload?.messageId || sendResult.payload?.id || null,
    });
  }

  const hasFailures = results.some((result) => !result.ok);
  const statusCode = hasFailures ? 502 : 200;

  logBridgeEvent(hasFailures ? "error" : "info", {
    event: "request_completed",
    requestId,
    sentCount: results.filter((result) => result.ok).length,
    totalCount: results.length,
    statusCode,
    ...metadata,
  });

  return res.status(statusCode).json({
    ok: !hasFailures,
    requestId,
    sentCount: results.filter((result) => result.ok).length,
    totalCount: results.length,
    results,
    meta: {
      ...metadata,
      sentryResource,
      sentryTimestamp,
    },
  });
}
